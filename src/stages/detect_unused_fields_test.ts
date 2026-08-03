/**
 * Ported busted spec: .reference/luacheck/spec/unused_fields_spec.lua
 *
 * One Deno test for the busted `describe` block, with one `t.step` per
 * busted `it` block (2 `it`s), same convention as
 * detect_uninit_accesses_test.ts/detect_unreachable_code_test.ts. An
 * extra `t.step` below (marked as not from the upstream spec) covers a
 * literal `[0]` key used twice.
 *
 * `helper.get_stage_warnings("detect_unused_fields", src)` runs
 * `helper.get_chstate_after_stage` (parse -> unwrap_parens -> linearize ->
 * parse_inline_options -> name_functions -> resolve_locals -> ... ->
 * detect_unused_fields, clearing `chstate.warnings` after every
 * intermediate stage) and then sorts the target stage's own warnings by
 * location. `assertWarnings` below inlines a narrower version of that:
 * only `parse.run`/`unwrap_parens.run` (the stages
 * detect_unused_fields.lua actually reads state from - `chstate.ast`,
 * walked recursively for `Table` nodes) followed by
 * `detectUnusedFieldsRun`, since `stages/init.ts`'s registry (ticket
 * 4.8) doesn't exist yet and the other upstream stages in between
 * (linearize, parse_inline_options, name_functions, resolve_locals, and
 * the detect_* stages that run before detect_unused_fields) don't feed
 * anything detect_unused_fields.lua reads. `unwrap_parens.run` matters
 * here: it can strip a `Paren` wrapper around a table key expression
 * (e.g. `[(z)] = 7`), which would otherwise hide a constant key from
 * this stage's key evaluation. The ported spec does not exercise that
 * case, but it is the correct minimal-and-faithful pipeline matching the
 * real upstream stage order. Warnings are sorted with `sortByLocation`
 * from core_utils.ts before comparing, matching
 * `helper.get_stage_warnings`'s own
 * `core_utils.sort_by_location(chstate.warnings)` call.
 *
 * Every `code = "314"` string literal in the Lua spec is ported as a
 * numeric `code: 314`, per `Warning.code: number` in check_state.ts (the
 * Lua source represents warning codes as strings; this port's `Warning`
 * interface does not). `field`, `index`, `overwritten_line`,
 * `overwritten_column`, and `overwritten_end_column` are already flat
 * data-format keys in the Lua source and are carried over unchanged.
 * Upstream emits `index = nil` (absent) for keyed pairs and `index =
 * true` for array entries; the expected warnings below match that shape,
 * omitting `index` for keyed pairs per detect_globals.ts's `compact`
 * convention of dropping nil-valued warning fields.
 *
 * `run` from ./detect_unused_fields.ts does not exist yet (a later
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
import { run as detectUnusedFieldsRun } from "./detect_unused_fields.ts";

function getChstateAfterDetectUnusedFields(
  source: string,
): CheckStateInstance {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  chstate.warnings = [];
  unwrapParensRun(chstate);
  chstate.warnings = [];
  detectUnusedFieldsRun(chstate);
  return chstate;
}

function assertWarnings(expected: Warning[], source: string): void {
  const chstate = getChstateAfterDetectUnusedFields(source);
  sortByLocation(chstate.warnings);
  assertEquals(chstate.warnings, expected);
}

Deno.test("unused field detection", async (t) => {
  await t.step("detects unused fields in table literals", () => {
    assertWarnings(
      [
        {
          code: 314,
          field: "key",
          line: 3,
          column: 5,
          end_column: 9,
          overwritten_line: 7,
          overwritten_column: 4,
          overwritten_end_column: 6,
        },
        {
          code: 314,
          field: "2",
          index: true,
          line: 6,
          column: 4,
          end_column: 4,
          overwritten_line: 9,
          overwritten_column: 5,
          overwritten_end_column: 9,
        },
        {
          code: 314,
          field: "key",
          line: 7,
          column: 4,
          end_column: 6,
          overwritten_line: 8,
          overwritten_column: 4,
          overwritten_end_column: 6,
        },
        {
          code: 314,
          field: "0.2e1",
          line: 9,
          column: 5,
          end_column: 9,
          overwritten_line: 10,
          overwritten_column: 5,
          overwritten_end_column: 5,
        },
      ],
      'local x, y, z = 1, 2, 3\nreturn {\n   ["key"] = 4,\n' +
        "   [z] = 7,\n   1,\n   y,\n   key = x,\n   key = 0,\n" +
        "   [0.2e1] = 6,\n   [2] = 7\n}\n",
    );
  });

  await t.step("detects unused fields in nested table literals", () => {
    assertWarnings(
      [
        {
          code: 314,
          field: "a",
          line: 2,
          column: 5,
          end_column: 5,
          overwritten_line: 2,
          overwritten_column: 12,
          overwritten_end_column: 12,
        },
        {
          code: 314,
          field: "b",
          line: 3,
          column: 11,
          end_column: 11,
          overwritten_line: 3,
          overwritten_column: 18,
          overwritten_end_column: 18,
        },
      ],
      "return {\n   {a = 1, a = 2},\n   key = {b = 1, b = 2}\n}\n",
    );
  });

  // Not from the upstream spec. detect_unused_fields.lua's `check_table`
  // does `if key_value then` to decide whether to track a constant key.
  // In Lua only `nil` and `false` are falsy, so `0` and `""` are truthy
  // keys; the port's translation must keep them (a bare JS truthy check
  // `if (keyValue)` would wrongly drop them). Two `[0]` entries share
  // the key `0`, so the second overwrites the first and the first is
  // reported as unused. Expected values were derived by running
  // `parse.run` -> `unwrap_parens.run` on the source and converting the
  // key nodes' offsets with `chstate.offsetToColumn`.
  await t.step(
    "detects unused fields for a truthy zero key (not from upstream spec)",
    () => {
      assertWarnings(
        [
          {
            code: 314,
            field: "0",
            line: 2,
            column: 5,
            end_column: 5,
            overwritten_line: 3,
            overwritten_column: 5,
            overwritten_end_column: 5,
          },
        ],
        "return {\n   [0] = 1,\n   [0] = 2\n}\n",
      );
    },
  );
});
