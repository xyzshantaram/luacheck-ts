/**
 * Ported busted spec: .reference/luacheck/spec/cyclomatic_complexity_spec.lua
 *
 * One Deno test for the busted `describe` block, with one `t.step` per
 * busted `it` block (7 `it`s), same convention as
 * detect_uninit_accesses_test.ts/detect_globals_test.ts.
 *
 * `helper.get_stage_warnings("detect_cyclomatic_complexity", src)` runs
 * `helper.get_chstate_after_stage` (parse -> unwrap_parens -> linearize ->
 * parse_inline_options -> name_functions -> resolve_locals -> ... ->
 * detect_cyclomatic_complexity, clearing `chstate.warnings` after every
 * intermediate stage) and then sorts the target stage's own warnings by
 * location. `assertWarnings` below inlines a narrower version of that: only
 * `parse.run`/`unwrap_parens.run`/`linearize.run`/`name_functions.run`
 * (the stages detect_cyclomatic_complexity.lua actually reads state from -
 * `chstate.lines`/`chstate.top_line`/`line.node`/`line.items`, plus the
 * `Function` AST `name` field that name_functions.ts populates, read back
 * as `node.name` for the `function_name` warning field) followed by
 * `detectCyclomaticComplexityRun`, since `stages/init.ts`'s registry
 * (ticket 4.8) doesn't exist yet and the other upstream stages in between
 * (parse_inline_options, resolve_locals, and the detect_* stages that run
 * before detect_cyclomatic_complexity) don't feed anything
 * detect_cyclomatic_complexity.lua reads. Warnings are sorted with
 * `sortByLocation` from core_utils.ts before comparing, matching
 * `helper.get_stage_warnings`'s own
 * `core_utils.sort_by_location(chstate.warnings)` call.
 *
 * Every `code = "561"` string literal in the Lua spec is ported as a
 * numeric `code: 561`, per `Warning.code: number` in check_state.ts (the
 * Lua source represents warning codes as strings; this port's `Warning`
 * interface does not). `complexity`, `function_type`, `function_name`,
 * `line`, `column`, and `end_column` are already flat data-format keys in
 * the Lua source and are carried over unchanged.
 *
 * `run` from ./detect_cyclomatic_complexity.ts does not exist yet (a later
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
import { run as nameFunctionsRun } from "./name_functions.ts";
import { run as detectCyclomaticComplexityRun } from "./detect_cyclomatic_complexity.ts";

function getChstateAfterDetectCyclomaticComplexity(
  source: string,
): CheckStateInstance {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  chstate.warnings = [];
  unwrapParensRun(chstate);
  chstate.warnings = [];
  linearizeRun(chstate);
  chstate.warnings = [];
  nameFunctionsRun(chstate);
  chstate.warnings = [];
  detectCyclomaticComplexityRun(chstate);
  return chstate;
}

function assertWarnings(expected: Warning[], source: string): void {
  const chstate = getChstateAfterDetectCyclomaticComplexity(source);
  sortByLocation(chstate.warnings);
  assertEquals(chstate.warnings, expected);
}

Deno.test("cyclomatic complexity detection", async (t) => {
  await t.step("reports 1 for empty main chunk", () => {
    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 1,
          function_type: "main_chunk",
        },
      ],
      "",
    );
  });

  await t.step("reports 1 for functions with no branches", () => {
    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 1,
          function_type: "main_chunk",
        },
      ],
      "print(1)\n\ndo\n   print(2)\nend\n\nreturn 3\n",
    );
  });

  await t.step("reports 2 for functions with a single if branch", () => {
    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 2,
          function_type: "main_chunk",
        },
      ],
      "print(1)\n\nif ... then\n   print(2)\nend\n\nprint(3)\n",
    );

    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 2,
          function_type: "main_chunk",
        },
      ],
      "print(1)\n\nif ... then\n   print(2)\nelse\n   print(3)\nend\n",
    );
  });

  await t.step("reports 2 for functions with a single loop", () => {
    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 2,
          function_type: "main_chunk",
        },
      ],
      "print(1)\n\nfor i = 1, 10 do\n   print(2)\nend\n\nprint(3)\n",
    );

    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 2,
          function_type: "main_chunk",
        },
      ],
      "print(1)\n\nfor k, v in pairs(t) do\n   print(2)\nend\n\nprint(3)\n",
    );

    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 2,
          function_type: "main_chunk",
        },
      ],
      "print(1)\n\nwhile cond() do\n   print(2)\nend\n\nprint(3)\n",
    );

    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 2,
          function_type: "main_chunk",
        },
      ],
      "print(1)\n\nrepeat\n   print(2)\nuntil cond()\n\nprint(3)\n",
    );
  });

  await t.step("reports 2 for functions with a single boolean operator", () => {
    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 2,
          function_type: "main_chunk",
        },
      ],
      "print(a and b)\n",
    );

    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 2,
          function_type: "main_chunk",
        },
      ],
      "print(a or b)\n",
    );
  });

  await t.step("provides appropriate names and types for functions", () => {
    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 1,
          function_type: "main_chunk",
        },
        {
          code: 561,
          line: 1,
          column: 8,
          end_column: 17,
          complexity: 1,
          function_type: "function",
        },
        {
          code: 561,
          line: 2,
          column: 14,
          end_column: 27,
          complexity: 1,
          function_type: "function",
          function_name: "f",
        },
        {
          code: 561,
          line: 3,
          column: 8,
          end_column: 21,
          complexity: 1,
          function_type: "function",
          function_name: "g",
        },
        {
          code: 561,
          line: 4,
          column: 10,
          end_column: 25,
          complexity: 1,
          function_type: "function",
          function_name: "h",
        },
        {
          code: 561,
          line: 5,
          column: 25,
          end_column: 38,
          complexity: 1,
          function_type: "function",
          function_name: "t.k",
        },
        {
          code: 561,
          line: 6,
          column: 26,
          end_column: 39,
          complexity: 1,
          function_type: "function",
          function_name: "t.k1.k2.k3.k4",
        },
        {
          code: 561,
          line: 7,
          column: 11,
          end_column: 24,
          complexity: 1,
          function_type: "function",
        },
        {
          code: 561,
          line: 8,
          column: 6,
          end_column: 19,
          complexity: 1,
          function_type: "function",
        },
        {
          code: 561,
          line: 9,
          column: 4,
          end_column: 27,
          complexity: 1,
          function_type: "method",
          function_name: "t.foo.bar",
        },
      ],
      "return function()\n   local f = function() end\n   g = function() end\n" +
        "   local function h() end\n   local a, t = 1, {k = function() end}\n" +
        "   t.k1.k2 = {k3 = {k4 = function() end}}\n   t[1] = function() end\n" +
        "   t[function() end] = 1\n   function t.foo:bar() end\nend\n",
    );
  });

  await t.step("reports correct complexity in complex cases", () => {
    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 8,
          function_type: "main_chunk",
        },
      ],
      "if month == 1 then\n   return 31\nelseif month == 2 then\n" +
        "   if year % 4 == 0 then\n      return 29\n   end\n\n   return 28\n" +
        "elseif (month <= 7 and month % 2 == 1) or (month >= 8 and month % 2 == 0)" +
        " then\n   return 31\nelse\n   return 30\nend\n",
    );

    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 4,
          function_type: "main_chunk",
        },
      ],
      "local i, j = 0, 0\nlocal total = 0\nwhile to > 0 and i < to do\n" +
        "   while j < to do\n      j = j + 1\n      total = total + 1\n   end\n\n" +
        "   i = i + 1\nend\n\nreturn total\n",
    );

    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 4,
          function_type: "main_chunk",
        },
      ],
      "local i, j = 0, 0\nlocal total = 0\n\nrepeat\n   repeat\n" +
        "      j = j + 1\n      total = total + 1\n   until j >= to\n\n" +
        "   i = i + 1\nuntil i >= to or to <= 0\n\nreturn total\n",
    );

    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 7,
          function_type: "main_chunk",
        },
      ],
      "for k1 in t and pairs(t) or pairs({}) do\n   for k2 in pairs(t) do\n" +
        "      if k1 and k2 then\n         return k1 + k2\n      end\n   end\nend\n",
    );

    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 6,
          function_type: "main_chunk",
        },
      ],
      "for i = 1, t > 10 and 10 or t do\n   for j = 1, t do\n" +
        "      if i + j == i * j then\n         return i\n      end\n   end\nend\n",
    );

    assertWarnings(
      [
        {
          code: 561,
          line: 1,
          column: 1,
          end_column: 1,
          complexity: 5,
          function_type: "main_chunk",
        },
      ],
      "local v1 = v and v*3 or 4\nlocal t = {v1 == 3 and v*v or v/3}\nreturn t\n",
    );
  });
});
