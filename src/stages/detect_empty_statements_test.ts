/**
 * Hand-written tests for stages/detect_empty_statements.ts. No upstream
 * busted spec exists (the reference tree has only
 * detect_empty_statements.lua), so these tests are not a port.
 *
 * One `Deno.test` block with `t.step`s, same shape as the ported stage
 * test files. The pipeline is just `parse.run` followed by
 * `detectEmptyStatementsRun`, because detect_empty_statements.lua reads
 * only the parser's report of semicolons that do not follow a statement.
 * Upstream Lua names that field `useless_semicolons`; this port kept the
 * parser's own name `hangingSemicolons` straight through `stages/parse.ts`
 * and `check_state.ts` (see `chstate.hangingSemicolons =
 * result.hangingSemicolons` in parse.ts and the `hangingSemicolons:
 * Range[]` field in check_state.ts), so this port's stage reads
 * `chstate.hangingSemicolons`. No unwrap_parens, no linearize.
 *
 * Per upstream parser.lua's `parse_block` (around line 962), a semicolon
 * counts as hanging when it does not follow a statement: a `;` that just
 * separates two real statements is not hanging, while a `;` before any
 * statement, after another `;`, or after a block's closing token is.
 *
 * Every warning carries `code: 551` and no extra fields.
 *
 * Expected line/column/end_column values were derived by running
 * `parse.run` on each source and converting each `hangingSemicolons`
 * entry's offsets with `chstate.offsetToColumn`, mirroring
 * `chstate.warnRange`, not by hand-counting characters.
 *
 * `run` from ./detect_empty_statements.ts does not exist yet (a later
 * implementation dispatch adds it); a throwing placeholder stands in so
 * this file type-checks - `deno test` failing/erroring at the first
 * `assertWarnings` call is expected.
 */

import { assertEquals } from "@std/assert";
import { checkStateNew } from "../check_state.ts";
import type { CheckStateInstance, Warning } from "../check_state.ts";
import { sortByLocation } from "../core_utils.ts";
import { run as parseRun } from "./parse.ts";
import { run as detectEmptyStatementsRun } from "./detect_empty_statements.ts";

function getChstateAfterDetectEmptyStatements(
  source: string,
): CheckStateInstance {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  detectEmptyStatementsRun(chstate);
  return chstate;
}

function assertWarnings(expected: Warning[], source: string): void {
  const chstate = getChstateAfterDetectEmptyStatements(source);
  sortByLocation(chstate.warnings);
  assertEquals(chstate.warnings, expected);
}

Deno.test("empty statement detection", async (t) => {
  // The source has two hanging semicolons: the leading `;` on line 1 and
  // the second `;` on line 2. The first `;` on line 2 follows the `end`
  // of `do end`, so it separates statements and is not hanging.
  await t.step("detects hanging semicolons as empty statements", () => {
    assertWarnings(
      [
        { code: 551, line: 1, column: 1, end_column: 1 },
        { code: 551, line: 2, column: 8, end_column: 8 },
      ],
      ";\ndo end;;\n",
    );
  });
});
