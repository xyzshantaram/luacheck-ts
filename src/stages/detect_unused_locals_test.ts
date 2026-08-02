/**
 * Ported busted spec: .reference/luacheck/spec/unused_locals_spec.lua
 *
 * One Deno test per busted `describe` block, with one `t.step` per busted
 * `it` block (same convention as resolve_locals_test.ts/linearize_test.ts).
 * The upstream spec's second `describe` block is misspelled ("unused
 * recurisve function detection"); the ported `Deno.test` name below
 * corrects the typo to "unused recursive function detection", since this
 * name isn't user-facing output and there is no reason to preserve a typo
 * in it.
 *
 * `helper.get_stage_warnings("detect_unused_locals", src)` runs
 * `helper.get_chstate_after_stage` (parse -> unwrap_parens -> linearize ->
 * parse_inline_options -> name_functions -> resolve_locals -> ... ->
 * detect_unused_locals, clearing `chstate.warnings` after every
 * intermediate stage) and then sorts the target stage's own warnings by
 * location. `assertWarnings` below inlines a narrower version of that:
 * only `parse.run`/`unwrap_parens.run`/`linearize.run`/`resolve_locals.run`
 * (the stages detect_unused_locals.lua actually reads state from - var/
 * value resolution - per resolve_locals_test.ts's own precedent) followed
 * by `detectUnusedLocalsRun`, since `stages/init.ts`'s registry (ticket
 * 4.8) doesn't exist yet and the other upstream stages in between
 * (parse_inline_options, name_functions, and the detect_* stages that run
 * before detect_unused_locals) don't feed anything detect_unused_locals.lua
 * reads. Warnings are sorted with `sortByLocation` from core_utils.ts
 * before comparing, matching `helper.get_stage_warnings`'s own
 * `core_utils.sort_by_location(chstate.warnings)` call.
 *
 * Every `code = "211"` (etc.) string literal in the Lua spec is ported as
 * a numeric `code: 211`, per `Warning.code: number` in check_state.ts (the
 * Lua source represents warning codes as strings; this port's `Warning`
 * interface does not). `end_column`/`overwritten_line`/`overwritten_column`/
 * `overwritten_end_column` stay snake_case, since they are part of the
 * `Warning` public data format per check_state.ts's `Warning` interface
 * comment; the remaining warning fields (`name`, `line`, `column`,
 * `secondary`, `func`, `recursive`, `mutually_recursive`, `self`,
 * `useless`) are already flat data-format keys in the Lua source and are
 * carried over unchanged.
 *
 * `run` from ./detect_unused_locals.ts does not exist yet (a later
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
import { run as detectUnusedLocalsRun } from "./detect_unused_locals.ts";

function getChstateAfterDetectUnusedLocals(
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
  detectUnusedLocalsRun(chstate);
  return chstate;
}

function assertWarnings(expected: Warning[], source: string): void {
  const chstate = getChstateAfterDetectUnusedLocals(source);
  sortByLocation(chstate.warnings);
  assertEquals(chstate.warnings, expected);
}

Deno.test("unused locals detection", async (t) => {
  await t.step("does not find anything wrong in used locals", () => {
    assertWarnings(
      [],
      "local a\nlocal b = 5\na = 6\ndo\n   print(b, {(a)})\nend\n",
    );
  });

  await t.step("detects unused locals", () => {
    assertWarnings(
      [
        { code: 211, name: "a", line: 1, column: 7, end_column: 7 },
      ],
      "local a = 4\n\ndo\n   local b = 6\n   print(b)\nend\n",
    );
  });

  await t.step("detects useless local _ variable", () => {
    assertWarnings(
      [
        {
          code: 211,
          name: "_",
          useless: true,
          line: 2,
          column: 10,
          end_column: 10,
        },
        {
          code: 211,
          name: "_",
          useless: true,
          line: 7,
          column: 13,
          end_column: 13,
        },
        {
          code: 211,
          name: "_",
          secondary: true,
          line: 12,
          column: 13,
          end_column: 13,
        },
      ],
      "do\n   local _\nend\n\ndo\n   local a = 5\n   local b, _ = a\n   b()\n" +
        "end\n\ndo\n   local c, _ = ...\n   c()\nend\n",
    );
  });

  await t.step(
    "reports unused function with forward declaration as variable, not value",
    () => {
      assertWarnings(
        [
          {
            code: 211,
            name: "noop",
            func: true,
            line: 1,
            column: 22,
            end_column: 25,
          },
        ],
        "local noop; function noop() end\n",
      );
    },
  );

  await t.step("detects unused locals from function arguments", () => {
    assertWarnings(
      [
        { code: 212, name: "foo", line: 1, column: 17, end_column: 19 },
      ],
      "return function(foo, ...)\n   return ...\nend\n",
    );
  });

  await t.step(
    "allows unused function arguments with underscore prefix",
    () => {
      assertWarnings(
        [],
        "return function(_foo, ...)\n   return ...\nend\n",
      );
    },
  );

  await t.step("warns against using arguments with underscore prefix", () => {
    assertWarnings(
      [
        { code: 214, name: "_foo", line: 1, column: 17, end_column: 20 },
      ],
      "return function(_foo)\n   return _foo\nend\n",
    );
  });

  await t.step(
    "exempt _ENV from warning on usage with underscore prefix",
    () => {
      assertWarnings(
        [],
        " return function(_ENV) return type(_ENV) end ",
      );
    },
  );

  await t.step("detects unused implicit self", () => {
    assertWarnings(
      [
        {
          code: 212,
          name: "self",
          self: true,
          line: 2,
          column: 11,
          end_column: 11,
        },
      ],
      "local a = {}\nfunction a:b()\n\nend\nreturn a\n",
    );
  });

  await t.step("detects unused locals from loops", () => {
    assertWarnings(
      [
        { code: 213, name: "i", line: 1, column: 5, end_column: 5 },
        { code: 213, name: "i", line: 2, column: 5, end_column: 5 },
      ],
      "for i=1, 2 do end\nfor i in pairs{} do end\n",
    );
  });

  await t.step("detects unused values", () => {
    assertWarnings(
      [
        {
          code: 311,
          name: "a",
          line: 3,
          column: 4,
          end_column: 4,
          overwritten_line: 3,
          overwritten_column: 7,
          overwritten_end_column: 7,
        },
        {
          code: 311,
          name: "a",
          line: 3,
          column: 7,
          end_column: 7,
          overwritten_line: 8,
          overwritten_column: 1,
          overwritten_end_column: 1,
        },
        {
          code: 311,
          name: "a",
          line: 5,
          column: 4,
          end_column: 4,
          overwritten_line: 8,
          overwritten_column: 1,
          overwritten_end_column: 1,
        },
      ],
      "local a\nif ... then\n   a, a = 2, 4\nelse\n   a = 3\nend\n\n" +
        "a = 5\nreturn a\n",
    );
  });

  await t.step(
    "does not provide overwriting location if value can reach end of scope",
    () => {
      assertWarnings(
        [
          { code: 311, name: "a", line: 4, column: 4, end_column: 4 },
          { code: 311, name: "a", line: 7, column: 7, end_column: 7 },
        ],
        "do\n   local a = 1\n   (...)(a)\n   a = 2\n\n   if ... then\n" +
          "      a = 3\n   end\nend\n",
      );
    },
  );

  await t.step(
    "does not provide overwriting location if the value overwrites itself",
    () => {
      assertWarnings(
        [
          { code: 311, name: "a", line: 5, column: 4, end_column: 4 },
        ],
        "local a = 1\nprint(a)\n\nwhile true do\n   a = 2\nend\n",
      );
    },
  );

  await t.step(
    "does not detect unused value when it and a closure using it can live together",
    () => {
      assertWarnings(
        [],
        "local a = 3\nif true then\n   escape(function() return a end)\nend\n",
      );
    },
  );

  await t.step(
    "does not consider value assigned to upvalue as unused if it is accessed in another closure",
    () => {
      assertWarnings(
        [],
        "local a\n\nlocal function f(x) a = x end\n" +
          "local function g() return a end\nreturn f, g\n",
      );
    },
  );

  await t.step(
    "does not consider a variable initialized if it can't get a value due to short rhs",
    () => {
      assertWarnings(
        [],
        'local a, b = "foo"\nb = "bar"\nreturn a, b\n',
      );
    },
  );

  await t.step(
    "considers a variable initialized if short rhs ends with potential multivalue",
    () => {
      assertWarnings(
        [
          {
            code: 311,
            name: "b",
            line: 2,
            column: 13,
            end_column: 13,
            secondary: true,
            overwritten_line: 3,
            overwritten_column: 4,
            overwritten_end_column: 4,
          },
        ],
        'return function(...)\n   local a, b = ...\n   b = "bar"\n' +
          "   return a, b\nend\n",
      );
    },
  );

  await t.step(
    "reports unused variable as secondary if it is assigned together with a used one",
    () => {
      assertWarnings(
        [
          {
            code: 211,
            name: "a",
            line: 2,
            column: 10,
            end_column: 10,
            secondary: true,
          },
        ],
        "return function(f)\n   local a, b = f()\n   return b\nend\n",
      );
    },
  );

  await t.step(
    "reports unused value as secondary if it is assigned together with a used one",
    () => {
      assertWarnings(
        [
          {
            code: 231,
            name: "a",
            line: 2,
            column: 10,
            end_column: 10,
            secondary: true,
          },
        ],
        "return function(f)\n   local a, b\n   a, b = f()\n   return b\nend\n",
      );

      assertWarnings(
        [
          {
            code: 231,
            name: "a",
            line: 2,
            column: 10,
            end_column: 10,
            secondary: true,
          },
        ],
        "return function(f, t)\n   local a\n   a, t[1] = f()\nend\n",
      );
    },
  );

  await t.step(
    "detects variable that is mutated but never accessed",
    () => {
      assertWarnings(
        [
          { code: 241, name: "a", line: 1, column: 7, end_column: 7 },
        ],
        "local a = {}\na.k = 1\n",
      );

      assertWarnings(
        [
          { code: 241, name: "a", line: 1, column: 7, end_column: 7 },
        ],
        "local a\n\nif ... then\n   a = {}\n   a.k1 = 1\nelse\n   a = {}\n" +
          "   a.k2 = 2\nend\n",
      );

      assertWarnings(
        [
          { code: 241, name: "a", line: 1, column: 7, end_column: 7 },
          { code: 311, name: "a", line: 7, column: 4, end_column: 4 },
        ],
        "local a\n\nif ... then\n   a = {}\n   a.k1 = 1\nelse\n   a = {}\nend\n",
      );
    },
  );

  await t.step("detects values that are mutated but never accessed", () => {
    assertWarnings(
      [
        { code: 331, name: "a", line: 5, column: 4, end_column: 4 },
      ],
      "local a\nlocal b = (...).k\n\nif (...)[1] then\n   a = {}\n" +
        "   a.k1 = 1\nelseif (...)[2] then\n   a = b\n   a.k2 = 2\n" +
        "elseif (...)[3] then\n   a = b()\n   a.k3 = 3\n" +
        "elseif (...)[4] then\n   a = b(1) or b(2)\n   a.k4 = 4\nelse\n" +
        "   a = {}\n   return a\nend\n",
    );
  });

  await t.step("detects unset variables", () => {
    assertWarnings(
      [
        { code: 221, name: "a", line: 1, column: 7, end_column: 7 },
      ],
      "local a\nreturn a\n",
    );
  });
});

// Upstream `describe("unused recurisve function detection", ...)` -
// misspelled "recurisve" in the Lua spec, corrected here since this test
// name is not user-facing output.
Deno.test("unused recursive function detection", async (t) => {
  await t.step("detects unused recursive functions", () => {
    assertWarnings(
      [
        {
          code: 211,
          name: "f",
          func: true,
          recursive: true,
          line: 1,
          column: 16,
          end_column: 16,
        },
      ],
      "local function f(x)\n   return x <= 1 and 1 or x * f(x - 1)\nend\n",
    );
  });

  await t.step("handles functions defined without a local value", () => {
    assertWarnings(
      [],
      "print(function() return function() end end)\n",
    );
  });

  await t.step("detects unused mutually recursive functions", () => {
    assertWarnings(
      [
        {
          code: 211,
          name: "odd",
          func: true,
          mutually_recursive: true,
          line: 3,
          column: 16,
          end_column: 18,
        },
        {
          code: 211,
          name: "even",
          func: true,
          mutually_recursive: true,
          line: 7,
          column: 10,
          end_column: 13,
        },
      ],
      "local even\n\nlocal function odd(x)\n   return x == 1 or even(x - 1)\n" +
        "end\n\nfunction even(x)\n   return x == 0 or odd(x - 1)\nend\n",
    );
  });

  await t.step(
    "detects unused mutually recursive functions as values",
    () => {
      assertWarnings(
        [
          { code: 311, name: "odd", line: 5, column: 10, end_column: 12 },
          { code: 311, name: "even", line: 9, column: 10, end_column: 13 },
        ],
        "local even = 2\nlocal odd = 3\n(...)(even, odd)\n\n" +
          "function odd(x)\n   return x == 1 or even(x - 1)\nend\n\n" +
          "function even(x)\n   return x == 0 or odd(x - 1) or even(x)\nend\n",
      );
    },
  );

  await t.step(
    "does not incorrectly detect unused recursive functions inside unused functions",
    () => {
      assertWarnings(
        [
          {
            code: 211,
            name: "unused",
            func: true,
            line: 1,
            column: 16,
            end_column: 21,
          },
        ],
        "local function unused()\n   local function nested1() end\n" +
          "   local function nested2() nested2() end\n" +
          "   return nested1(), nested2()\nend\n",
      );
    },
  );

  await t.step(
    "does not incorrectly detect unused recursive functions used by an unused recursive function",
    () => {
      assertWarnings(
        [
          {
            code: 211,
            name: "g",
            func: true,
            recursive: true,
            line: 2,
            column: 16,
            end_column: 16,
          },
        ],
        "local function f() return 1 end\n" +
          "local function g() return f() + g() end\n",
      );

      assertWarnings(
        [
          {
            code: 211,
            name: "g",
            func: true,
            recursive: true,
            line: 2,
            column: 16,
            end_column: 16,
          },
        ],
        "local f\nlocal function g() return f() + g() end\n" +
          "function f() return 1 end\n",
      );
    },
  );
});
