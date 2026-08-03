/**
 * Hand-written tests for stages/detect_compound_operators.ts. No upstream
 * busted spec exists (the reference tree has only
 * detect_compound_operators.lua), so these tests are not a port.
 *
 * One `Deno.test` block with `t.step`s, same shape as the ported stage
 * test files. The pipeline is `parse.run`/`unwrap_parens.run`/
 * `linearize.run` followed by `detectCompoundOperatorsRun`, because
 * detect_compound_operators.lua reads `chstate.lines` via `eachStatement`
 * from core_utils.ts (linearize.ts populates `chstate.lines`), and the
 * minimal upstream stage order is parse -> unwrap_parens -> linearize.
 * Warnings are sorted with `sortByLocation` from core_utils.ts before
 * comparing.
 *
 * Every warning carries `code: 33` and an `operator` field holding the
 * compound operator text (e.g. `+=`), per the warning data format in
 * detect_compound_operators.lua's `reverse_compound_operators` table.
 *
 * Expected line/column/end_column values were derived by running
 * `parse.run` -> `unwrap_parens.run` -> `linearize.run` on each source
 * and converting the `OpSet` statement node's offsets with
 * `chstate.offsetToColumn`, mirroring `chstate.warnRange`, not by
 * hand-counting characters.
 *
 * `run` from ./detect_compound_operators.ts does not exist yet (a later
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
import { run as detectCompoundOperatorsRun } from "./detect_compound_operators.ts";

function getChstateAfterDetectCompoundOperators(
  source: string,
): CheckStateInstance {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  chstate.warnings = [];
  unwrapParensRun(chstate);
  chstate.warnings = [];
  linearizeRun(chstate);
  chstate.warnings = [];
  detectCompoundOperatorsRun(chstate);
  return chstate;
}

function assertWarnings(expected: Warning[], source: string): void {
  const chstate = getChstateAfterDetectCompoundOperators(source);
  sortByLocation(chstate.warnings);
  assertEquals(chstate.warnings, expected);
}

Deno.test("compound operator detection", async (t) => {
  // Two different operators (`+=` and `//=`) in one source, so the
  // `reverse_compound_operators` lookup table is exercised beyond a
  // single entry.
  await t.step("detects compound assignment operators", () => {
    assertWarnings(
      [
        { code: 33, line: 2, column: 1, end_column: 6, operator: "+=" },
        { code: 33, line: 3, column: 1, end_column: 7, operator: "//=" },
      ],
      "local a = 1\na += 2\na //= 3\n",
    );
  });

  // Covers `..=` and a plain `= 5` assignment, which is a `Set` statement
  // and must not be reported as a compound assignment.
  await t.step("detects ..= and ignores plain assignment", () => {
    assertWarnings(
      [{ code: 33, line: 2, column: 1, end_column: 9, operator: "..=" }],
      'local s = ""\ns ..= "x"\na = 5\n',
    );
  });
});
