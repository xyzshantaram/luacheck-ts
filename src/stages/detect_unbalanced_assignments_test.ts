/**
 * Ported busted spec: .reference/luacheck/spec/unbalanced_assignments_spec.lua
 *
 * One Deno test for the busted `describe` block, with one `t.step` per
 * busted `it` block (2 `it`s), same convention as
 * detect_uninit_accesses_test.ts/detect_unreachable_code_test.ts.
 *
 * `helper.get_stage_warnings("detect_unbalanced_assignments", src)` runs
 * `helper.get_chstate_after_stage` (parse -> unwrap_parens -> linearize ->
 * parse_inline_options -> name_functions -> resolve_locals -> ... ->
 * detect_unbalanced_assignments, clearing `chstate.warnings` after every
 * intermediate stage) and then sorts the target stage's own warnings by
 * location. `assertWarnings` below inlines a narrower version of that:
 * only `parse.run`/`unwrap_parens.run`/`linearize.run` (the stages
 * detect_unbalanced_assignments.lua actually reads state from -
 * `chstate.lines`, walked by `eachStatement` from core_utils.ts, which
 * linearize.ts populates - per the model files' precedent) followed by
 * `detectUnbalancedAssignmentsRun`, since `stages/init.ts`'s registry
 * (ticket 4.8) doesn't exist yet and the other upstream stages in
 * between (parse_inline_options, name_functions, resolve_locals, and the
 * detect_* stages that run before detect_unbalanced_assignments) don't
 * feed anything detect_unbalanced_assignments.lua reads. Warnings are
 * sorted with `sortByLocation` from core_utils.ts before comparing,
 * matching `helper.get_stage_warnings`'s own
 * `core_utils.sort_by_location(chstate.warnings)` call.
 *
 * Every `code = "531"` (etc.) string literal in the Lua spec is ported as
 * a numeric `code: 531`, per `Warning.code: number` in check_state.ts (the
 * Lua source represents warning codes as strings; this port's `Warning`
 * interface does not). `line`, `column`, and `end_column` are already flat
 * data-format keys in the Lua source and are carried over unchanged.
 *
 * `run` from ./detect_unbalanced_assignments.ts does not exist yet (a
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
import { run as detectUnbalancedAssignmentsRun } from "./detect_unbalanced_assignments.ts";

function getChstateAfterDetectUnbalancedAssignments(
  source: string,
): CheckStateInstance {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  chstate.warnings = [];
  unwrapParensRun(chstate);
  chstate.warnings = [];
  linearizeRun(chstate);
  chstate.warnings = [];
  detectUnbalancedAssignmentsRun(chstate);
  return chstate;
}

function assertWarnings(expected: Warning[], source: string): void {
  const chstate = getChstateAfterDetectUnbalancedAssignments(source);
  sortByLocation(chstate.warnings);
  assertEquals(chstate.warnings, expected);
}

Deno.test("unbalanced assignment detection", async (t) => {
  await t.step("detects unbalanced assignments", () => {
    assertWarnings(
      [
        { code: 532, line: 4, column: 1, end_column: 8 },
        { code: 531, line: 5, column: 1, end_column: 14 },
      ],
      "local a, b = 4; (...)(a)\n\na, b = (...)(a, b); (...)(a, b)\n" +
        "a, b = 5; (...)(a, b)\n" +
        "a, b = 1, 2, 3; (...)(a, b)\nlocal c, d\n",
    );
  });

  await t.step(
    "detects unbalanced assignments in nested blocks and functions",
    () => {
      assertWarnings(
        [
          { code: 532, line: 6, column: 10, end_column: 17 },
          { code: 532, line: 9, column: 13, end_column: 20 },
          { code: 532, line: 14, column: 22, end_column: 29 },
          { code: 531, line: 17, column: 25, end_column: 38 },
        ],
        "do\n   local a, b, c, d\n\n   while x do\n      if y then\n" +
          "         a, b = 1\n      else\n         repeat\n" +
          "            a, b = 1\n\n            function t()\n" +
          "               for i = 1, 10 do\n" +
          "                  for _, v in ipairs(tab) do\n" +
          "                     a, b = 1\n\n                     if c then\n" +
          "                        a, b = 1, 2, 3\n                     end\n" +
          "                  end\n               end\n            end\n" +
          "         until z\n      end\n   end\nend\n",
      );
    },
  );
});
