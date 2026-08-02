/**
 * Ported busted spec: .reference/luacheck/spec/uninit_accesses_spec.lua
 *
 * One Deno test for the busted `describe` block, with one `t.step` per
 * busted `it` block (8 `it`s), same convention as
 * detect_globals_test.ts/detect_unused_locals_test.ts/
 * resolve_locals_test.ts/linearize_test.ts. The upstream `describe` block
 * itself is named "uninitalized access detection" - a genuine spelling
 * variant of "uninitialized", not the kind of unambiguous typo corrected
 * in detect_unused_locals_test.ts's "unused recurisve function detection"
 * -> "unused recursive function detection" fix. The `Deno.test` name below
 * preserves the upstream spelling verbatim rather than guessing at
 * upstream's intent.
 *
 * `helper.get_stage_warnings("detect_uninit_accesses", src)` runs
 * `helper.get_chstate_after_stage` (parse -> unwrap_parens -> linearize ->
 * parse_inline_options -> name_functions -> resolve_locals -> ... ->
 * detect_uninit_accesses, clearing `chstate.warnings` after every
 * intermediate stage) and then sorts the target stage's own warnings by
 * location. `assertWarnings` below inlines a narrower version of that:
 * only `parse.run`/`unwrap_parens.run`/`linearize.run`/`resolve_locals.run`
 * (the stages detect_uninit_accesses.lua actually reads state from -
 * `item.usedValues`/`var.values`/`item.accesses`/`item.mutations`, all
 * populated by resolve_locals.ts and linearize.ts - per
 * resolve_locals_test.ts's and detect_unused_locals_test.ts's own
 * precedent) followed by `detectUninitAccessesRun`, since
 * `stages/init.ts`'s registry (ticket 4.8) doesn't exist yet and the other
 * upstream stages in between (parse_inline_options, name_functions, and
 * the detect_* stages that run before detect_uninit_accesses) don't feed
 * anything detect_uninit_accesses.lua reads. Warnings are sorted with
 * `sortByLocation` from core_utils.ts before comparing, matching
 * `helper.get_stage_warnings`'s own
 * `core_utils.sort_by_location(chstate.warnings)` call.
 *
 * Every `code = "321"` (etc.) string literal in the Lua spec is ported as
 * a numeric `code: 321`, per `Warning.code: number` in check_state.ts (the
 * Lua source represents warning codes as strings; this port's `Warning`
 * interface does not). `name`, `line`, `column`, and `end_column` are
 * already flat data-format keys in the Lua source and are carried over
 * unchanged.
 *
 * `run` from ./detect_uninit_accesses.ts does not exist yet (a later
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
import { run as detectUninitAccessesRun } from "./detect_uninit_accesses.ts";

function getChstateAfterDetectUninitAccesses(
  source: string,
): CheckStateInstance {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  chstate.warnings = [];
  unwrapParensRun(chstate);
  chstate.warnings = [];
  linearizeRun(chstate);
  chstate.warnings = [];
  resolveLocalsRun(chstate);
  chstate.warnings = [];
  detectUninitAccessesRun(chstate);
  return chstate;
}

function assertWarnings(expected: Warning[], source: string): void {
  const chstate = getChstateAfterDetectUninitAccesses(source);
  sortByLocation(chstate.warnings);
  assertEquals(chstate.warnings, expected);
}

Deno.test("uninitalized access detection", async (t) => {
  await t.step("detects accessing uninitialized variables", () => {
    assertWarnings(
      [
        { code: 321, name: "a", line: 6, column: 12, end_column: 12 },
      ],
      "local a\n\nif ... then\n   a = 5\nelse\n   a = get(a)\nend\n\nreturn a\n",
    );
  });

  await t.step(
    "detects accessing uninitialized variables in unreachable functions",
    () => {
      assertWarnings(
        [
          { code: 321, name: "a", line: 12, column: 20, end_column: 20 },
        ],
        "return function()\n   return function()\n      do return end\n\n" +
          "      return function(x)\n         local a\n\n" +
          "         if x then\n            a = 1\n" +
          "            return a + 2\n         else\n" +
          "            return a + 1\n         end\n      end\n   end\nend\n",
      );
    },
  );

  await t.step("detects mutating uninitialized variables", () => {
    assertWarnings(
      [
        { code: 341, name: "a", line: 4, column: 4, end_column: 4 },
      ],
      "local a\n\nif ... then\n   a.k = 5\nelse\n   a = get(5)\nend\n\n" +
        "return a\n",
    );
  });

  await t.step(
    "detects accessing uninitialized variables in nested functions",
    () => {
      assertWarnings(
        [
          { code: 321, name: "a", line: 7, column: 12, end_column: 12 },
        ],
        "return function() return function(...)\nlocal a\n\n" +
          "if ... then\n   a = 5\nelse\n   a = get(a)\nend\n\nreturn a\n" +
          "end end\n",
      );
    },
  );

  await t.step("handles accesses with no reaching values", () => {
    assertWarnings(
      [],
      'local var = "foo"\n(...)(var)\ndo return end\n(...)(var)\n',
    );
  });

  await t.step("handles upvalue accesses with no reaching values", () => {
    assertWarnings(
      [],
      'local var = "foo"\n(...)(var)\ndo return end\n(...)(function()\n' +
        "   return var\nend)\n",
    );
  });

  await t.step(
    "handles upvalue accesses with no reaching values in a nested function",
    () => {
      assertWarnings(
        [],
        'return function(...)\n   local var = "foo"\n   (...)(var)\n' +
          "   do return end\n   (...)(function()\n      return var\n" +
          "   end)\nend\n",
      );
    },
  );

  await t.step(
    "does not detect accessing unitialized variables incorrectly in loops",
    () => {
      assertWarnings(
        [],
        "local a\n\nwhile not a do\n   a = get()\nend\n\nreturn a\n",
      );
    },
  );
});
