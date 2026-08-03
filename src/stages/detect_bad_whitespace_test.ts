/**
 * Ported busted spec: .reference/luacheck/spec/bad_whitespace_spec.lua
 *
 * One Deno test for the busted `describe` block, with one `t.step` per
 * busted `it` block (8 `it`s), same convention as
 * detect_uninit_accesses_test.ts/detect_unreachable_code_test.ts. The
 * upstream `describe` block is named "bad whitespace detection".
 *
 * `helper.get_stage_warnings("detect_bad_whitespace", src)` runs
 * `helper.get_chstate_after_stage` (parse -> unwrap_parens -> linearize ->
 * parse_inline_options -> name_functions -> resolve_locals -> ... ->
 * detect_bad_whitespace, clearing `chstate.warnings` after every
 * intermediate stage) and then sorts the target stage's own warnings by
 * location. `assertWarnings` below inlines a narrower version of that:
 * only `parse.run` followed by `detectBadWhitespaceRun`, since
 * `stages/init.ts`'s registry (ticket 4.8) does not exist yet and
 * detect_bad_whitespace.lua reads state from only `chstate.source` (a
 * `Chars` with a `.find(pattern, from)` method, from ../decoder.ts),
 * `chstate.lineOffsets`, `chstate.lineLengths`, and `chstate.lineEndings`
 * - all populated directly by `stages/parse.ts`'s `run`. It does not
 * touch the AST, `chstate.lines`, or anything produced by unwrap_parens
 * or linearize, so no intermediate stage and no intermediate
 * `chstate.warnings = []` clearing are needed. Warnings are sorted with
 * `sortByLocation` from core_utils.ts before comparing, matching
 * `helper.get_stage_warnings`'s own
 * `core_utils.sort_by_location(chstate.warnings)` call.
 *
 * Every `code = "611"` (etc.) string literal in the Lua spec is ported as
 * a numeric `code: 611`, per `Warning.code: number` in check_state.ts (the
 * Lua source represents warning codes as strings, but this port's
 * `Warning` interface does not). `line`, `column`, and `end_column` are
 * already flat data-format keys in the Lua source and are carried over
 * unchanged.
 *
 * The Lua source strings are byte sequences. The short-string escapes
 * `\n`, `\r`, and `\t` are ported as the identical JS escapes, which
 * produce the same bytes. The `\NNN` decimal byte escapes in the spec
 * (e.g. `\204\128\204\130` in the utf8 `it` block) are ported as JS hex
 * escapes (`\xCC\x80\xCC\x82`). Each `\NNN` is one raw byte 0-255, and
 * decoder.ts represents source bytes as one UTF-16 code unit per byte, so
 * the hex escapes below carry the same bytes.
 *
 * `run` from ./detect_bad_whitespace.ts does not exist yet (a later
 * implementation dispatch adds it). A throwing placeholder stands in so
 * this file type-checks. `deno test` failing at the first `assertWarnings`
 * call is expected.
 */

import { assertEquals } from "@std/assert";
import { checkStateNew } from "../check_state.ts";
import type { CheckStateInstance, Warning } from "../check_state.ts";
import { sortByLocation } from "../core_utils.ts";
import { run as parseRun } from "./parse.ts";
import { run as detectBadWhitespaceRun } from "./detect_bad_whitespace.ts";

function getChstateAfterDetectBadWhitespace(
  source: string,
): CheckStateInstance {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  detectBadWhitespaceRun(chstate);
  return chstate;
}

function assertWarnings(expected: Warning[], source: string): void {
  const chstate = getChstateAfterDetectBadWhitespace(source);
  sortByLocation(chstate.warnings);
  assertEquals(chstate.warnings, expected);
}

Deno.test("bad whitespace detection", async (t) => {
  await t.step("detects lines with only whitespace", () => {
    assertWarnings(
      [
        { code: 611, line: 1, column: 1, end_column: 4 },
        { code: 611, line: 3, column: 1, end_column: 1 },
      ],
      "    \n--[[\n \n]]\n",
    );
  });

  await t.step(
    "detects trailing whitespace with different warnings code depending on line ending type",
    () => {
      assertWarnings(
        [
          { code: 612, line: 1, column: 8, end_column: 9 },
          { code: 613, line: 2, column: 13, end_column: 13 },
          { code: 612, line: 3, column: 8, end_column: 8 },
          { code: 614, line: 4, column: 11, end_column: 14 },
        ],
        "local a  \nlocal b = [[ \nthing]] \nlocal c --\t\t\t\t\nlocal d\n",
      );
    },
  );

  await t.step("detects spaces followed by tabs", () => {
    assertWarnings(
      [{ code: 621, line: 1, column: 1, end_column: 5 }],
      " \t  \tlocal foo\n\t\t    local bar\n",
    );
  });

  await t.step(
    "does not warn on spaces followed by tabs if the line has only whitespace",
    () => {
      assertWarnings(
        [{ code: 611, line: 1, column: 1, end_column: 7 }],
        "   \t \t \n",
      );
    },
  );

  await t.step(
    "can detect both trailing whitespace and inconsistent indentation on the same line",
    () => {
      assertWarnings(
        [
          { code: 621, line: 1, column: 1, end_column: 2 },
          { code: 612, line: 1, column: 10, end_column: 10 },
        ],
        " \tlocal a \n",
      );
    },
  );

  await t.step("handles lack of trailing newline", () => {
    assertWarnings(
      [{ code: 611, line: 2, column: 1, end_column: 5 }],
      "local a\n     ",
    );

    assertWarnings(
      [{ code: 612, line: 2, column: 8, end_column: 12 }],
      "local a\nlocal b     ",
    );

    assertWarnings(
      [
        { code: 621, line: 1, column: 1, end_column: 2 },
        { code: 614, line: 1, column: 13, end_column: 16 },
      ],
      " \tlocal a --    ",
    );
  });

  await t.step(
    "provides correct column ranges in presence of two-byte line endings",
    () => {
      assertWarnings(
        [
          { code: 612, line: 1, column: 10, end_column: 13 },
          { code: 621, line: 2, column: 1, end_column: 4 },
          { code: 611, line: 3, column: 1, end_column: 3 },
        ],
        "local foo    \r\n   \tlocal bar\n\r   ",
      );
    },
  );

  await t.step("provides correct column ranges in presence of utf8", () => {
    assertWarnings(
      [
        { code: 612, line: 1, column: 17, end_column: 20 },
        { code: 611, line: 2, column: 1, end_column: 4 },
        { code: 621, line: 3, column: 1, end_column: 4 },
        { code: 614, line: 3, column: 20, end_column: 24 },
      ],
      "local foo = '\xCC\x80\xCC\x82'    \n    \n   \tlocal bar -- " +
        "\xF0\x90\x80\x80\xE0\xA6\x98     \n",
    );
  });
});
