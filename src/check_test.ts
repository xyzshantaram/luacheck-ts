/**
 * Ported busted spec: .reference/luacheck/spec/check_spec.lua (376 lines).
 *
 * Every `code = "211"` (etc.) string literal in the Lua spec is ported as
 * a numeric `code: 211`, per `Warning.code: number` in check_state.ts, same
 * convention as every other ported stage spec in this repo.
 *
 * The Lua spec wraps `raw_check` (this file's `check`, from ./check.ts)
 * with two local helpers:
 *   - `check_full(src)`: runs the raw check, then strips every warning
 *     with code 561 (cyclomatic complexity) from the result in place,
 *     since the main chunk and every function unconditionally gets a 561
 *     entry from detect_cyclomatic_complexity.ts regardless of any
 *     threshold - filtering that down to only the complexity warnings a
 *     user's configured `max_cyclomatic_complexity` actually flags is
 *     filter.lua's job (ticket 5.2, not yet ported), not check.lua's.
 *   - `check(src)`: `check_full(src).warnings`.
 * `checkFull`/`checkWarnings` below mirror those two helpers exactly.
 *
 * `chstate.lineLengths` (and so `CheckResult.line_lengths`, copied from it
 * unmodified per check.lua line 56) is a 1-based array with index 0 an
 * unfilled hole, never a value - see detect_bad_whitespace.ts's own
 * comment ("`lineOffsets`/`lineLengths` are 1-based arrays: index 0 is
 * unused") and lexer.ts's `lineLengths[newLine] = ...` assignment, which
 * only ever writes indices >= 1 into an array that starts as `[]`. The one
 * test below that checks `line_lengths` (the "provides inline options..."
 * case) builds its expected array the same way, through index assignment
 * starting at 1, so the hole at index 0 matches on both sides.
 *
 * The two "syntax error" steps near the end are hand-written, not ported
 * from check_spec.lua - that spec has no case for check.lua's syntax-error
 * branch (lines 58-83 of check.lua). Each source string there is chosen so
 * the exact code path is derivable directly from parser.ts, without
 * running the parser: a lone `)` never reaches a prevRange-bearing error
 * (parseError is called with no prevRange argument), while `(1` reaches
 * `missingClosingTokenError` through `checkClosingToken`'s direct
 * (non-guesser) path, since its closing token is `)`, not `end`/`until` -
 * the only two closing tokens that route through `UnpairedTokenGuesser`
 * first. That guarantees `prev_line` is the `(` token's own line (1) on
 * the second case, without needing to hand-compute guesser-derived
 * columns. Exact `column`/`end_column`/`prev_column`/`prev_end_column`
 * values are asserted only as `typeof ... === "number"` on these two
 * hand-written steps, since those are `offsetToColumn` arithmetic already
 * covered elsewhere, not this file's concern; `check_state_test.ts`, not
 * this file, is the place for `offsetToColumn` byte-precision coverage.
 *
 * `validate_fields` (check.lua lines 10-37) is a safety net that only
 * fires on a real internal bug - a stage producing a field its own
 * `warnings` metadata does not declare. It is not exercised as a
 * dedicated throwing-path test here; the "provides inline options, line
 * lengths, and line endings" and "emits correct inline option error
 * messages" steps below already assert real, successfully-produced
 * warnings and inline-option events, which is enough to prove
 * `validate_fields` does not falsely reject legitimate output.
 *
 * `check` from ./check.ts does not exist yet (a later implementation
 * dispatch adds it); a throwing placeholder stands in so this file
 * type-checks. `deno test` failing/erroring at the first call into
 * `check` is expected.
 */

import { assert, assertEquals } from "@std/assert";
import type { Warning } from "./check_state.ts";
import { check, type CheckResult } from "./check.ts";

function checkFull(src: string): CheckResult {
  const report = check(src);
  return {
    ...report,
    warnings: report.warnings.filter((warning) => warning.code !== 561),
  };
}

function checkWarnings(src: string): Warning[] {
  return checkFull(src).warnings;
}

Deno.test("check", async (t) => {
  await t.step("does not find anything wrong in an empty block", () => {
    assertEquals(checkWarnings(""), []);
  });

  await t.step(
    "considers a variable assigned even if it can't get a value due to short rhs (it still gets nil)",
    () => {
      assertEquals(
        checkWarnings(
          'local a, b = "foo", "bar"\na, b = "bar"\nreturn a, b\n',
        ),
        [
          {
            code: 311,
            name: "a",
            line: 1,
            column: 7,
            end_column: 7,
            overwritten_line: 2,
            overwritten_column: 1,
            overwritten_end_column: 1,
          },
          {
            code: 311,
            name: "b",
            line: 1,
            column: 10,
            end_column: 10,
            overwritten_line: 2,
            overwritten_column: 4,
            overwritten_end_column: 4,
          },
          { code: 532, line: 2, column: 1, end_column: 12 },
        ],
      );
    },
  );

  await t.step(
    "reports vartype == var when the unused value is not the initial",
    () => {
      assertEquals(
        checkWarnings(
          "local function foo(a, b)\n" +
            '   a = a or "default"\n' +
            "   a = 42\n" +
            "   b = 7\n" +
            "   return a, b\n" +
            "end\n" +
            "\n" +
            "return foo\n",
        ),
        [
          {
            code: 312,
            name: "b",
            line: 1,
            column: 23,
            end_column: 23,
            overwritten_line: 4,
            overwritten_column: 4,
            overwritten_end_column: 4,
          },
          {
            code: 311,
            name: "a",
            line: 2,
            column: 4,
            end_column: 4,
            overwritten_line: 3,
            overwritten_column: 4,
            overwritten_end_column: 4,
          },
        ],
      );
    },
  );

  await t.step("does not detect unused values in loops", () => {
    assertEquals(
      checkWarnings(
        "local a = 10\n" +
          "while a > 0 do\n" +
          "   print(a)\n" +
          "   a = math.floor(a/2)\n" +
          "end\n",
      ),
      [
        { code: 113, name: "print", line: 3, column: 4, end_column: 8 },
        {
          code: 113,
          name: "math",
          indexing: ["floor"],
          line: 4,
          column: 8,
          end_column: 11,
        },
      ],
    );
  });

  await t.step(
    "detects unused local value referred to from closure in incompatible branch",
    () => {
      assertEquals(
        checkWarnings(
          "local a\n" +
            "\n" +
            "if (...)() then\n" +
            "   a = 1\n" +
            "else\n" +
            "   (...)(function() return a end)\n" +
            "end\n",
        ),
        [
          { code: 311, name: "a", line: 4, column: 4, end_column: 4 },
          { code: 321, name: "a", line: 6, column: 28, end_column: 28 },
        ],
      );
    },
  );

  await t.step(
    "detects unused upvalue value referred to from closure in incompatible branch",
    () => {
      assertEquals(
        checkWarnings(
          "local a\n" +
            "\n" +
            "if (...)() then\n" +
            "   (...)(function() a = 1 end)\n" +
            "else\n" +
            "   (...)(function() return a end)\n" +
            "end\n",
        ),
        [
          { code: 311, name: "a", line: 4, column: 21, end_column: 21 },
          { code: 321, name: "a", line: 6, column: 28, end_column: 28 },
        ],
      );
    },
  );

  await t.step("handles upvalues before infinite loops", () => {
    assertEquals(
      checkWarnings(
        "local x\n" +
          "local function f() return x end\n" +
          "::loop::\n" +
          "goto loop\n",
      ),
      [
        { code: 221, name: "x", line: 1, column: 7, end_column: 7 },
        {
          code: 211,
          name: "f",
          func: true,
          line: 2,
          column: 16,
          end_column: 16,
        },
      ],
    );
  });

  await t.step("detects redefinition in the same scope", () => {
    assertEquals(
      checkWarnings(
        'local foo\nlocal foo = "bar"\nprint(foo)\n',
      ),
      [
        { code: 211, name: "foo", line: 1, column: 7, end_column: 9 },
        {
          code: 411,
          name: "foo",
          line: 2,
          column: 7,
          end_column: 9,
          prev_line: 1,
          prev_column: 7,
          prev_end_column: 9,
        },
        { code: 113, name: "print", line: 3, column: 1, end_column: 5 },
      ],
    );
  });

  await t.step("detects redefinition of function arguments", () => {
    assertEquals(
      checkWarnings(
        "return function(foo, ...)\n" +
          "   local foo = 1\n" +
          "   return foo\n" +
          "end\n",
      ),
      [
        { code: 212, name: "foo", line: 1, column: 17, end_column: 19 },
        { code: 212, name: "...", line: 1, column: 22, end_column: 24 },
        {
          code: 412,
          name: "foo",
          line: 2,
          column: 10,
          end_column: 12,
          prev_line: 1,
          prev_column: 17,
          prev_end_column: 19,
        },
      ],
    );
  });

  await t.step("marks redefinition of implicit self", () => {
    assertEquals(
      checkWarnings(
        "local t = {}\n" +
          "function t:f()\n" +
          "   local o = {}\n" +
          "   function o:g() end\n" +
          "   return o\n" +
          "end\n" +
          "return t\n",
      ),
      [
        {
          code: 212,
          name: "self",
          line: 2,
          column: 11,
          end_column: 11,
          self: true,
        },
        {
          code: 212,
          name: "self",
          line: 4,
          column: 14,
          end_column: 14,
          self: true,
        },
        {
          code: 432,
          name: "self",
          line: 4,
          column: 14,
          end_column: 14,
          self: true,
          prev_line: 2,
          prev_column: 11,
          prev_end_column: 11,
        },
      ],
    );

    assertEquals(
      checkWarnings(
        "local t = {}\n" +
          "function t.f(self)\n" +
          "   local o = {}\n" +
          "   function o:g() end\n" +
          "   return o\n" +
          "end\n" +
          "return t\n",
      ),
      [
        { code: 212, name: "self", line: 2, column: 14, end_column: 17 },
        {
          code: 212,
          name: "self",
          line: 4,
          column: 14,
          end_column: 14,
          self: true,
        },
        {
          code: 432,
          name: "self",
          line: 4,
          column: 14,
          end_column: 14,
          prev_line: 2,
          prev_column: 14,
          prev_end_column: 17,
        },
      ],
    );

    assertEquals(
      checkWarnings(
        "local t = {}\n" +
          "function t:f()\n" +
          "   local o = {}\n" +
          "   function o.g(self) end\n" +
          "   return o\n" +
          "end\n" +
          "return t\n",
      ),
      [
        {
          code: 212,
          name: "self",
          line: 2,
          column: 11,
          end_column: 11,
          self: true,
        },
        { code: 212, name: "self", line: 4, column: 17, end_column: 20 },
        {
          code: 432,
          name: "self",
          line: 4,
          column: 17,
          end_column: 20,
          prev_line: 2,
          prev_column: 11,
          prev_end_column: 11,
        },
      ],
    );
  });

  await t.step("detects shadowing definitions", () => {
    assertEquals(
      checkWarnings(
        "local a = 46\n" +
          "\n" +
          "return a, function(foo, ...)\n" +
          "   local a = 1\n" +
          "\n" +
          "   do\n" +
          "      local a = 6\n" +
          "      foo(a, ...)\n" +
          "   end\n" +
          "\n" +
          "   return a\n" +
          "end\n",
      ),
      [
        {
          code: 431,
          name: "a",
          line: 4,
          column: 10,
          end_column: 10,
          prev_line: 1,
          prev_column: 7,
          prev_end_column: 7,
        },
        {
          code: 421,
          name: "a",
          line: 7,
          column: 13,
          end_column: 13,
          prev_line: 4,
          prev_column: 10,
          prev_end_column: 10,
        },
      ],
    );
  });

  await t.step("detects unused labels", () => {
    assertEquals(
      checkWarnings("::fail::\ndo ::fail:: end\ngoto fail\n"),
      [{ code: 521, label: "fail", line: 2, column: 4, end_column: 11 }],
    );
  });

  await t.step("detects empty statements", () => {
    assertEquals(
      checkWarnings(
        ";\n" +
          "do end;;\n" +
          'local foo = "bar";\n' +
          'foo = foo .. "baz";;\n' +
          "\n" +
          "while true do\n" +
          "   if foo() then;\n" +
          "      goto fail;\n" +
          "   elseif foo() then\n" +
          "      break;\n" +
          "   end\n" +
          "end\n" +
          "\n" +
          "::fail::\n" +
          "return foo;\n",
      ),
      [
        { code: 551, line: 1, column: 1, end_column: 1 },
        { code: 541, line: 2, column: 1, end_column: 6 },
        { code: 551, line: 2, column: 8, end_column: 8 },
        { code: 551, line: 4, column: 20, end_column: 20 },
        { code: 551, line: 7, column: 17, end_column: 17 },
      ],
    );
  });

  await t.step("provides correct locations in presence of utf8", () => {
    assertEquals(
      checkWarnings(
        "-- \xF0\x90\x80\x80\xE0\xA6\x98\nlocal --[[\xCC\x80]] a;math['\xCC\x82']()\n",
      ),
      [
        { code: 211, name: "a", line: 2, column: 15, end_column: 15 },
        {
          code: 113,
          name: "math",
          line: 2,
          column: 17,
          end_column: 20,
          indexing: ["\xCC\x82"],
        },
      ],
    );
  });

  await t.step(
    "provides inline options, line lengths, and line endings",
    () => {
      const lineLengths: number[] = [];
      [28, 38, 16, 17, 19, 17, 32, 16, 0, 17, 44, 20, 21, 16, 3, 0].forEach(
        (length, index) => {
          lineLengths[index + 1] = length;
        },
      );

      assertEquals(
        checkFull(
          "-- luacheck: push ignore bar\n" +
            "local foo, bar -- luacheck: ignore foo\n" +
            "-- luacheck: pop\n" +
            "return function()\n" +
            "-- luacheck: ignore\n" +
            "-- luacheck: push\n" +
            "for _ in pairs({}) do return end\n" +
            "-- luacheck: pop\n" +
            "\n" +
            "-- luacheck: push\n" +
            "local function f() end -- luacheck: ignore f\n" +
            "-- luacheck: std max\n" +
            "-- luacheck: std none\n" +
            "-- luacheck: pop\n" +
            "end\n",
        ),
        {
          warnings: [
            { code: 211, name: "foo", line: 2, column: 7, end_column: 9 },
            { code: 211, name: "bar", line: 2, column: 12, end_column: 14 },
            { code: 512, line: 7, column: 1, end_column: 32 },
            { code: 213, name: "_", line: 7, column: 5, end_column: 5 },
            { code: 113, name: "pairs", line: 7, column: 10, end_column: 14 },
            {
              code: 211,
              name: "f",
              func: true,
              line: 11,
              column: 16,
              end_column: 16,
            },
          ],
          inline_options: [
            {
              options: { ignore: ["bar"] },
              line: 1,
              column: 1,
              end_column: 28,
            },
            {
              options: { ignore: ["foo"] },
              line: 2,
              column: 16,
              end_column: 38,
            },
            { pop_count: 1, line: 3 },
            { pop_count: 1, line: 4 },
            { options: { ignore: [".*"] }, line: 5, column: 1, end_column: 19 },
            {
              options: { ignore: ["f"] },
              line: 11,
              column: 24,
              end_column: 44,
            },
            {
              pop_count: 1,
              options: { std: "max" },
              line: 12,
              column: 1,
              end_column: 20,
            },
            { options: { std: "none" }, line: 13, column: 1, end_column: 21 },
            { pop_count: 2, line: 15 },
            { pop_count: 1, line: 16 },
          ],
          line_lengths: lineLengths,
          line_endings: {
            1: "comment",
            2: "comment",
            3: "comment",
            5: "comment",
            6: "comment",
            8: "comment",
            10: "comment",
            11: "comment",
            12: "comment",
            13: "comment",
            14: "comment",
          },
        },
      );
    },
  );

  await t.step("emits correct inline option error messages", () => {
    assertEquals(
      checkFull(
        "-- luacheck: pop\n" +
          "-- luacheck: push\n" +
          "-- luacheck: something strange\n" +
          "-- luacheck: std\n" +
          "-- luacheck: std lua51 + lua52\n" +
          "-- luacheck: no unused, no unused very much\n" +
          "-- luacheck: no ignore anything please\n" +
          "-- luacheck:\n" +
          "-- luacheck: no unused, , no redefined\n",
      ).warnings,
      [
        { code: 23, line: 1, column: 1, end_column: 16 },
        { code: 22, line: 2, column: 1, end_column: 17 },
        {
          code: 21,
          msg: "unknown inline option 'something strange'",
          line: 3,
          column: 1,
          end_column: 30,
        },
        {
          code: 21,
          msg: "inline option 'std' expects 1 argument, 0 given",
          line: 4,
          column: 1,
          end_column: 16,
        },
        {
          code: 21,
          msg: "inline option 'std' expects 1 argument, 3 given",
          line: 5,
          column: 1,
          end_column: 30,
        },
        {
          code: 21,
          msg: "inline option 'no unused' expects 0 arguments, 2 given",
          line: 6,
          column: 1,
          end_column: 43,
        },
        {
          code: 21,
          msg: "unknown inline option 'no ignore anything please'",
          line: 7,
          column: 1,
          end_column: 38,
        },
        {
          code: 21,
          msg: "empty inline option",
          line: 8,
          column: 1,
          end_column: 12,
        },
        {
          code: 21,
          msg: "empty inline option invocation",
          line: 9,
          column: 1,
          end_column: 38,
        },
      ],
    );
  });

  await t.step("handles argparse sample", () => {
    const fileBytes = Deno.readFileSync(
      new URL("./testdata/argparse-0.2.0.lua", import.meta.url),
    );
    let bytes = "";
    for (const b of fileBytes) bytes += String.fromCharCode(b);
    const warnings = checkWarnings(bytes);
    assertEquals(Array.isArray(warnings), true);
  });

  await t.step(
    "recommends using the opposite operator when negating a relational operator",
    () => {
      assertEquals(
        checkWarnings("         if not (5 > 5) then return end\n"),
        [
          {
            code: 581,
            line: 1,
            column: 13,
            end_column: 23,
            operator: ">",
            replacement_operator: "<=",
          },
        ],
      );
    },
  );

  await t.step("error-prone negations", async (t) => {
    await t.step("as sole conditions", () => {
      assertEquals(
        checkWarnings("            if not 5 > 5 then return end\n"),
        [{ code: 582, line: 1, column: 16, end_column: 24 }],
      );
    });

    await t.step("as subexpressions", () => {
      assertEquals(
        checkWarnings(
          "            if not 5 or not 5 == 5 then return end\n",
        ),
        [{ code: 582, line: 1, column: 25, end_column: 34 }],
      );
    });

    await t.step("doesn't warn if properly parenthesized", () => {
      assertEquals(
        checkWarnings("            if (not 5) == 5 then return end\n"),
        [],
      );
    });

    await t.step("doesn't warn for a literal 'not'", () => {
      assertEquals(
        checkWarnings('            if 5 == "not" then return end\n'),
        [],
      );
    });
  });

  await t.step("doesn't warn on similarly named variables", () => {
    assertEquals(
      checkWarnings(
        "         local eq = true\n" +
          "         if not eq then return end\n",
      ),
      [],
    );
  });

  await t.step(
    "doesn't warn on error-prone negations if they have explicit parentheses",
    () => {
      assertEquals(
        checkWarnings("         if (not 5) > 5 then return end\n"),
        [],
      );
    },
  );

  await t.step(
    "converts a thrown SyntaxError into a single code-11 warning, with the other three fields empty",
    () => {
      const report = check(")");
      assertEquals(report.inline_options, []);
      assertEquals(report.line_lengths, []);
      assertEquals(report.line_endings, {});
      assertEquals(report.warnings.length, 1);

      const warning = report.warnings[0];
      assert(warning.code === 11);
      assertEquals(typeof warning.line, "number");
      assertEquals(typeof warning.column, "number");
      assertEquals(typeof warning.end_column, "number");
      assertEquals(typeof warning.msg, "string");
      assertEquals(warning.prev_line, undefined);
    },
  );

  await t.step(
    "adds prev_line/prev_column/prev_end_column when the SyntaxError carries a previous range",
    () => {
      const report = check("(1\n");
      assertEquals(report.warnings.length, 1);

      const warning = report.warnings[0];
      assert(warning.code === 11);
      assertEquals(warning.prev_line, 1);
      assertEquals(typeof warning.prev_column, "number");
      assertEquals(typeof warning.prev_end_column, "number");
    },
  );
});
