/**
 * Ported busted spec: .reference/luacheck/spec/unreachable_code_spec.lua
 *
 * One Deno test for the busted `describe` block, with one `t.step` per
 * busted `it` block (6 `it`s), same convention as
 * detect_uninit_accesses_test.ts/detect_globals_test.ts.
 *
 * `helper.get_stage_warnings("detect_unreachable_code", src)` runs
 * `helper.get_chstate_after_stage` (parse -> unwrap_parens -> linearize ->
 * parse_inline_options -> name_functions -> resolve_locals -> ... ->
 * detect_unreachable_code, clearing `chstate.warnings` after every
 * intermediate stage) and then sorts the target stage's own warnings by
 * location. `assertWarnings` below inlines a narrower version of that: only
 * `parse.run`/`unwrap_parens.run`/`linearize.run` (the stages
 * detect_unreachable_code.lua actually reads state from - `chstate.lines`,
 * `line.items`/`item.node`/`item.loopEnd`, and `line.walk`, all populated
 * by linearize.ts - per the model files' precedent) followed by
 * `detectUnreachableCodeRun`, since `stages/init.ts`'s registry (ticket
 * 4.8) doesn't exist yet and the other upstream stages in between
 * (parse_inline_options, name_functions, resolve_locals, and the detect_*
 * stages that run before detect_unreachable_code) don't feed anything
 * detect_unreachable_code.lua reads. Warnings are sorted with
 * `sortByLocation` from core_utils.ts before comparing, matching
 * `helper.get_stage_warnings`'s own
 * `core_utils.sort_by_location(chstate.warnings)` call.
 *
 * Every `code = "511"` (etc.) string literal in the Lua spec is ported as
 * a numeric `code: 511`, per `Warning.code: number` in check_state.ts (the
 * Lua source represents warning codes as strings; this port's `Warning`
 * interface does not). `line`, `column`, and `end_column` are already flat
 * data-format keys in the Lua source and are carried over unchanged.
 *
 * `run` from ./detect_unreachable_code.ts does not exist yet (a later
 * implementation dispatch adds it); a throwing placeholder stands in so
 * this file type-checks - `deno test` failing/erroring at the first
 * `assertWarnings` call is expected.
 */

import { assertEquals } from "@std/assert";
import { checkStateNew } from "../check_state.ts";
import type { CheckStateInstance, Warning } from "../check_state.ts";
import { sortByLocation } from "../core_utils.ts";
import { run as parseRun } from "./parse.ts";
import { run as unwrapParensRun } from "./unwrap_parens.ts";
import { run as linearizeRun } from "./linearize.ts";
import { run as detectUnreachableCodeRun } from "./detect_unreachable_code.ts";

function getChstateAfterDetectUnreachableCode(
  source: string,
): CheckStateInstance {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  chstate.warnings = [];
  unwrapParensRun(chstate);
  chstate.warnings = [];
  linearizeRun(chstate);
  chstate.warnings = [];
  detectUnreachableCodeRun(chstate);
  return chstate;
}

function assertWarnings(expected: Warning[], source: string): void {
  const chstate = getChstateAfterDetectUnreachableCode(source);
  sortByLocation(chstate.warnings);
  assertEquals(chstate.warnings, expected);
}

Deno.test("unreachable code detection", async (t) => {
  await t.step("detects unreachable code", () => {
    assertWarnings(
      [{ code: 511, line: 2, column: 1, end_column: 24 }],
      "do return end\nif ... then return 6 end\nreturn 3\n",
    );

    assertWarnings(
      [
        { code: 511, line: 7, column: 1, end_column: 11 },
        { code: 511, line: 13, column: 1, end_column: 8 },
      ],
      "if ... then\n   return 4\nelse\n   return 6\nend\n\n" +
        "if ... then\n   return 7\nelse\n   return 8\nend\n\nreturn 3\n",
    );
  });

  await t.step("detects unreachable code with literal conditions", () => {
    assertWarnings(
      [{ code: 511, line: 4, column: 1, end_column: 6 }],
      "while true do\n   (...)()\nend\nreturn\n",
    );

    assertWarnings(
      [],
      "repeat\n   if ... then\n      break\n   end\nuntil false\nreturn\n",
    );

    assertWarnings(
      [{ code: 511, line: 6, column: 1, end_column: 6 }],
      "repeat\n   if nil then\n      break\n   end\nuntil false\nreturn\n",
    );
  });

  await t.step("detects unreachable expressions", () => {
    assertWarnings(
      [{ code: 511, line: 3, column: 7, end_column: 9 }],
      "repeat\n   return\nuntil ...\n",
    );

    assertWarnings(
      [{ code: 511, line: 3, column: 8, end_column: 10 }],
      "if true then\n   (...)()\nelseif ... then\n   (...)()\nend\n",
    );
  });

  await t.step("detects unreachable functions", () => {
    assertWarnings(
      [{ code: 511, line: 3, column: 1, end_column: 16 }],
      "local f = nil\ndo return end\nfunction f() end\n",
    );
  });

  await t.step("detects unreachable code in nested function", () => {
    assertWarnings(
      [{ code: 511, line: 4, column: 7, end_column: 12 }],
      "return function()\n   return function()\n      do return end\n" +
        "      return\n   end\nend\n",
    );
  });

  await t.step(
    "detects unreachable code in unreachable nested function",
    () => {
      assertWarnings(
        [
          { code: 511, line: 4, column: 4, end_column: 20 },
          { code: 511, line: 6, column: 7, end_column: 12 },
        ],
        "return function()\n   do return end\n\n   return function()\n" +
          "      do return end\n      return\n   end\nend\n",
      );
    },
  );
});
