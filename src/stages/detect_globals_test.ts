/**
 * Ported busted spec: .reference/luacheck/spec/globals_spec.lua
 *
 * One Deno test for the busted `describe` block, with one `t.step` per
 * busted `it` block (8 `it`s), same convention as
 * detect_unused_locals_test.ts/resolve_locals_test.ts/linearize_test.ts.
 *
 * `helper.get_stage_warnings("detect_globals", src)` runs
 * `helper.get_chstate_after_stage` (parse -> unwrap_parens -> linearize ->
 * parse_inline_options -> name_functions -> resolve_locals -> ... ->
 * detect_globals, clearing `chstate.warnings` after every intermediate
 * stage) and then sorts the target stage's own warnings by location.
 * `assertWarnings` below inlines a narrower version of that: only
 * `parse.run`/`unwrap_parens.run`/`linearize.run`/`resolve_locals.run`
 * (the stages detect_globals.lua actually reads state from -
 * `deep_resolve` reads `item.used_values[var]`, populated by
 * resolve_locals.lua's `used`/`mutated`/`usingLines`/`overwritingItem`
 * bookkeeping - per resolve_locals_test.ts's and
 * detect_unused_locals_test.ts's own precedent) followed by
 * `detectGlobalsRun`, since `stages/init.ts`'s registry (ticket 4.8)
 * doesn't exist yet and the other upstream stages in between
 * (parse_inline_options, name_functions, and the detect_* stages that run
 * before detect_globals) don't feed anything detect_globals.lua reads.
 * Warnings are sorted with `sortByLocation` from core_utils.ts before
 * comparing, matching `helper.get_stage_warnings`'s own
 * `core_utils.sort_by_location(chstate.warnings)` call.
 *
 * Every `code = "111"` (etc.) string literal in the Lua spec is ported as
 * a numeric `code: 111`, per `Warning.code: number` in check_state.ts (the
 * Lua source represents warning codes as strings; this port's `Warning`
 * interface does not). `end_column`, `previous_indexing_len`, `indirect`,
 * and `top` stay as-is, since they are part of the `Warning` public
 * data-format fields per check_state.ts's `Warning` interface comment, and
 * are already flat/lowercase in the Lua source with no case-convention
 * translation needed (only `end_column` is snake_case to begin with).
 * `indexing` array entries use the Lua source's own `true`/`false`/string
 * markers (see detect_globals.lua's `warn_global`: `true` means an
 * "unknown" key, `false` means a "not_string" key, a string is a known
 * key) and are carried over unchanged as JS booleans/strings.
 *
 * `run` from ./detect_globals.ts does not exist yet (a later
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
import { run as resolveLocalsRun } from "./resolve_locals.ts";
import { run as detectGlobalsRun } from "./detect_globals.ts";

function getChstateAfterDetectGlobals(source: string): CheckStateInstance {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  chstate.warnings = [];
  unwrapParensRun(chstate);
  chstate.warnings = [];
  linearizeRun(chstate);
  chstate.warnings = [];
  resolveLocalsRun(chstate);
  chstate.warnings = [];
  detectGlobalsRun(chstate);
  return chstate;
}

function assertWarnings(expected: Warning[], source: string): void {
  const chstate = getChstateAfterDetectGlobals(source);
  sortByLocation(chstate.warnings);
  assertEquals(chstate.warnings, expected);
}

Deno.test("global detection", async (t) => {
  await t.step("detects global set", () => {
    assertWarnings(
      [
        {
          code: 111,
          name: "foo",
          line: 1,
          column: 1,
          end_column: 3,
          top: true,
        },
      ],
      "foo = {}\n",
    );
  });

  await t.step("detects global set in nested functions", () => {
    assertWarnings(
      [
        { code: 111, name: "foo", line: 2, column: 4, end_column: 6 },
      ],
      "local function bar()\n   foo = {}\nend\nbar()\n",
    );
  });

  await t.step("detects global access in multi-assignments", () => {
    assertWarnings(
      [
        { code: 111, name: "y", line: 2, column: 4, end_column: 4, top: true },
        { code: 113, name: "print", line: 3, column: 1, end_column: 5 },
      ],
      "local x\nx, y = 1\nprint(x)\n",
    );
  });

  await t.step("detects global access in self swap", () => {
    assertWarnings(
      [
        { code: 113, name: "a", line: 1, column: 11, end_column: 11 },
        { code: 113, name: "print", line: 2, column: 1, end_column: 5 },
      ],
      "local a = a\nprint(a)\n",
    );
  });

  await t.step("detects global mutation", () => {
    assertWarnings(
      [
        {
          code: 112,
          name: "a",
          indexing: [false],
          line: 1,
          column: 1,
          end_column: 1,
        },
      ],
      "a[1] = 6\n",
    );
  });

  await t.step("detects indirect global field access", () => {
    assertWarnings(
      [
        {
          code: 113,
          name: "b",
          indexing: [false],
          line: 2,
          column: 15,
          end_column: 15,
        },
        {
          code: 113,
          name: "b",
          indexing: [false, false, "foo"],
          previous_indexing_len: 2,
          line: 3,
          column: 8,
          end_column: 12,
          indirect: true,
        },
      ],
      'local c = "foo"\nlocal alias = b[1]\nreturn alias[2][c]\n',
    );
  });

  await t.step("detects indirect global field mutation", () => {
    assertWarnings(
      [
        {
          code: 113,
          name: "b",
          indexing: [false],
          line: 2,
          column: 15,
          end_column: 15,
        },
        {
          code: 112,
          name: "b",
          indexing: [false, false, "foo"],
          previous_indexing_len: 2,
          line: 3,
          column: 1,
          end_column: 5,
          indirect: true,
        },
      ],
      'local c = "foo"\nlocal alias = b[1]\nalias[2][c] = c\n',
    );
  });

  await t.step(
    "provides indexing information for warnings related to global fields",
    () => {
      assertWarnings(
        [
          {
            code: 113,
            name: "global",
            line: 2,
            column: 11,
            end_column: 16,
          },
          {
            code: 113,
            name: "global",
            indexing: ["foo", "bar", false],
            indirect: true,
            previous_indexing_len: 1,
            line: 3,
            column: 15,
            end_column: 15,
          },
          {
            code: 113,
            name: "global",
            indexing: ["foo", "bar", false, true],
            indirect: true,
            previous_indexing_len: 4,
            line: 5,
            column: 8,
            end_column: 13,
          },
        ],
        'local c = "foo"\nlocal g = global\nlocal alias = g[c].bar[1]\n' +
          "local alias2 = alias\nreturn alias2[...]\n",
      );
    },
  );
});
