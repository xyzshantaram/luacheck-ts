/**
 * Ported busted spec: .reference/luacheck/spec/empty_blocks_spec.lua
 *
 * One Deno test for the busted `describe` block, with one `t.step` per
 * busted `it` block (2 `it`s), same convention as
 * detect_uninit_accesses_test.ts/detect_unreachable_code_test.ts.
 *
 * `helper.get_stage_warnings("detect_empty_blocks", src)` runs
 * `helper.get_chstate_after_stage` (parse -> unwrap_parens -> linearize ->
 * parse_inline_options -> name_functions -> resolve_locals -> ... ->
 * detect_empty_blocks, clearing `chstate.warnings` after every
 * intermediate stage) and then sorts the target stage's own warnings by
 * location. `assertWarnings` below inlines a narrower version of that:
 * only `parse.run`/`unwrap_parens.run`/`linearize.run` (the stages
 * detect_empty_blocks.lua actually reads state from - `chstate.lines`,
 * walked by `eachStatement` from core_utils.ts, which linearize.ts
 * populates - per the model files' precedent) followed by
 * `detectEmptyBlocksRun`, since `stages/init.ts`'s registry (ticket 4.8)
 * doesn't exist yet and the other upstream stages in between
 * (parse_inline_options, name_functions, resolve_locals, and the detect_*
 * stages that run before detect_empty_blocks) don't feed anything
 * detect_empty_blocks.lua reads. Warnings are sorted with `sortByLocation`
 * from core_utils.ts before comparing, matching
 * `helper.get_stage_warnings`'s own
 * `core_utils.sort_by_location(chstate.warnings)` call.
 *
 * Every `code = "541"` (etc.) string literal in the Lua spec is ported as
 * a numeric `code: 541`, per `Warning.code: number` in check_state.ts (the
 * Lua source represents warning codes as strings; this port's `Warning`
 * interface does not). `line`, `column`, and `end_column` are already flat
 * data-format keys in the Lua source and are carried over unchanged.
 *
 * `run` from ./detect_empty_blocks.ts does not exist yet (a later
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
import { run as detectEmptyBlocksRun } from "./detect_empty_blocks.ts";

function getChstateAfterDetectEmptyBlocks(
  source: string,
): CheckStateInstance {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  chstate.warnings = [];
  unwrapParensRun(chstate);
  chstate.warnings = [];
  linearizeRun(chstate);
  chstate.warnings = [];
  detectEmptyBlocksRun(chstate);
  return chstate;
}

function assertWarnings(expected: Warning[], source: string): void {
  const chstate = getChstateAfterDetectEmptyBlocks(source);
  sortByLocation(chstate.warnings);
  assertEquals(chstate.warnings, expected);
}

Deno.test("empty block detection", async (t) => {
  await t.step("detects empty blocks", () => {
    assertWarnings(
      [
        { code: 541, line: 1, column: 1, end_column: 6 },
        { code: 542, line: 3, column: 8, end_column: 11 },
        { code: 542, line: 5, column: 12, end_column: 15 },
        { code: 542, line: 7, column: 1, end_column: 4 },
      ],
      "do end\n\nif ... then\n\nelseif ... then\n\nelse\n\nend\n\n" +
        "if ... then\n   somehing()\nelse\n   something_else()\nend\n\n" +
        "do something() end\n\nwhile ... do end\nrepeat until ...\n",
    );
  });

  await t.step("detects empty blocks in nested blocks and functions", () => {
    assertWarnings(
      [
        { code: 541, line: 4, column: 10, end_column: 15 },
        { code: 541, line: 7, column: 13, end_column: 18 },
        { code: 541, line: 12, column: 22, end_column: 27 },
        { code: 542, line: 14, column: 27, end_column: 30 },
      ],
      "do\n   while x do\n      if y then\n         do end\n      else\n" +
        "         repeat\n            do end\n\n            function t()\n" +
        "               for i = 1, 10 do\n" +
        "                  for _, v in ipairs(tab) do\n" +
        "                     do end\n\n                     if c then end\n" +
        "                  end\n               end\n            end\n" +
        "         until z\n      end\n   end\nend\n",
    );
  });
});
