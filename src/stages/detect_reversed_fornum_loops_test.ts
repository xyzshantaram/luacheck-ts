/**
 * Ported busted spec: .reference/luacheck/spec/reversed_fornum_loops_spec.lua
 *
 * One Deno test for the busted `describe` block, with one `t.step` per
 * busted `it` block (5 `it`s), same convention as
 * detect_uninit_accesses_test.ts/detect_unreachable_code_test.ts.
 *
 * `helper.get_stage_warnings("detect_reversed_fornum_loops", src)` runs
 * `helper.get_chstate_after_stage` (parse -> unwrap_parens -> linearize ->
 * parse_inline_options -> name_functions -> resolve_locals -> ... ->
 * detect_reversed_fornum_loops, clearing `chstate.warnings` after every
 * intermediate stage) and then sorts the target stage's own warnings by
 * location. `assertWarnings` below inlines a narrower version of that:
 * only `parse.run`/`unwrap_parens.run`/`linearize.run` (the stages
 * detect_reversed_fornum_loops.lua actually reads state from -
 * `chstate.lines`, walked by `eachStatement` from core_utils.ts, which
 * linearize.ts populates - per the model files' precedent) followed by
 * `detectReversedFornumLoopsRun`, since `stages/init.ts`'s registry
 * (ticket 4.8) doesn't exist yet and the other upstream stages in
 * between (parse_inline_options, name_functions, resolve_locals, and the
 * detect_* stages that run before detect_reversed_fornum_loops) don't
 * feed anything detect_reversed_fornum_loops.lua reads. Warnings are
 * sorted with `sortByLocation` from core_utils.ts before comparing,
 * matching `helper.get_stage_warnings`'s own
 * `core_utils.sort_by_location(chstate.warnings)` call.
 *
 * Every `code = "571"` string literal in the Lua spec is ported as a
 * numeric `code: 571`, per `Warning.code: number` in check_state.ts (the
 * Lua source represents warning codes as strings; this port's `Warning`
 * interface does not). `limit`, `line`, `column`, and `end_column` are
 * already flat data-format keys in the Lua source and are carried over
 * unchanged.
 *
 * `run` from ./detect_reversed_fornum_loops.ts does not exist yet (a
 * later implementation dispatch adds it); a throwing placeholder stands
 * in so this file type-checks - `deno test` failing/erroring at the
 * first `assertWarnings` call is expected.
 */

import { assertEquals } from "@std/assert";
import { checkStateNew } from "../check_state.ts";
import type { CheckStateInstance, Warning } from "../check_state.ts";
import { sortByLocation } from "../core_utils.ts";
import { run as parseRun } from "./parse.ts";
import { run as unwrapParensRun } from "./unwrap_parens.ts";
import { run as linearizeRun } from "./linearize.ts";
import { run as detectReversedFornumLoopsRun } from "./detect_reversed_fornum_loops.ts";

function getChstateAfterDetectReversedFornumLoops(
  source: string,
): CheckStateInstance {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  chstate.warnings = [];
  unwrapParensRun(chstate);
  chstate.warnings = [];
  linearizeRun(chstate);
  chstate.warnings = [];
  detectReversedFornumLoopsRun(chstate);
  return chstate;
}

function assertWarnings(expected: Warning[], source: string): void {
  const chstate = getChstateAfterDetectReversedFornumLoops(source);
  sortByLocation(chstate.warnings);
  assertEquals(chstate.warnings, expected);
}

Deno.test("reversed fornum loop detection", async (t) => {
  await t.step(
    "does not detect anything wrong if not going down from #(expr)",
    () => {
      assertWarnings([], "for i = -10, 1 do\n   print(i)\nend\n");
    },
  );

  await t.step(
    "does not detect anything wrong if limit may be greater than 1",
    () => {
      assertWarnings(
        [],
        "for i = #t, 2 do\n   print(i)\nend\n\n" +
          "for i = #t, x do\n   print(i)\nend\n",
      );
    },
  );

  await t.step("does not detect anything wrong if step may be negative", () => {
    assertWarnings(
      [],
      "for i = #t, 1, -1 do\n   print(i)\nend\n\n" +
        "for i = #t, 1, x do\n   print(i)\nend\n",
    );
  });

  await t.step(
    "detects reversed loops going from #(expr) to limit less than or equal to 1",
    () => {
      assertWarnings(
        [
          { code: 571, line: 1, column: 1, end_column: 16, limit: "1" },
          { code: 571, line: 5, column: 1, end_column: 23, limit: "0" },
          {
            code: 571,
            line: 9,
            column: 1,
            end_column: 32,
            limit: "-123.456",
          },
        ],
        "for i = #t, 1 do\n   print(t[i])\nend\n\n" +
          'for i = #"abcdef", 0 do\n   print(something)\nend\n\n' +
          "for i = #(...), -123.456, 567 do\n   print(something)\nend\n",
      );
    },
  );

  await t.step(
    "detects reversed loops in nested statements and functions",
    () => {
      assertWarnings(
        [
          { code: 571, line: 7, column: 13, end_column: 28, limit: "1" },
          { code: 571, line: 8, column: 16, end_column: 31, limit: "1" },
          { code: 571, line: 10, column: 22, end_column: 43, limit: "1" },
        ],
        'do\n   print("thing")\n\n   while true do\n      repeat\n' +
          "         for i, v in ipairs(t) do\n            for i = #a, 1 do\n" +
          "               for i = #b, 1 do\n                  function xyz()\n" +
          '                     for i = #"thing", 1 do\n' +
          '                        print("thing")\n                     end\n' +
          "                  end\n               end\n            end\n" +
          "         end\n      until foo\n   end\nend\n",
      );
    },
  );
});
