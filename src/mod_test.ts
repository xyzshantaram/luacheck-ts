/**
 * Ported busted spec: .reference/luacheck/spec/luacheck_spec.lua - the
 * `describe("check_strings", ...)`, `describe("get_report", ...)`,
 * `describe("process_reports", ...)`, and `describe("get_message", ...)`
 * blocks. One `Deno.test` per `describe`, one `t.step` per `it`.
 *
 * The spec's outer `describe("luacheck", ...)` block covers `check_files`
 * and the `luacheck` table's callable-invocation form. Both are dropped
 * from this port (disk I/O, out of scope for a browser library - see
 * PLAN.md's Phase 5 entry and mod.ts's header), so that block is not
 * ported.
 *
 * Every `code = "211"` (etc.) string literal is ported as a numeric
 * `code: 211`, same convention as every other ported spec in this repo.
 *
 * Upstream asserts a single table with `warnings`/`errors`/`fatals`
 * bolted onto the reports array as extra named properties; this port's
 * `processReports`/`checkStrings` return a `[reports, counts]` tuple
 * instead (mod.ts's header), so every ported step below destructures the
 * tuple and asserts the two halves separately.
 *
 * `check_strings`'s "ignores tables with .fatal field" step has no
 * equivalent here: `checkStrings` takes `string[]` only, since the
 * `{fatal, msg}` item shape existed only to let the (dropped)
 * `checkFiles` mark unreadable files - nothing can construct one, so
 * there is nothing to test.
 *
 * `check_strings`'s per-item bad-argument message also drops "or tables"
 * for the same reason ("array of strings expected", not "array of
 * strings or tables expected").
 *
 * `process_reports`'s "uses options" step passes `std = "none"` upstream;
 * this port's std presets are trimmed to `lua54`/`lua54c` only (see
 * builtin_standards.ts), so it is ported with `std: {}` (an empty std
 * table) - the same substitution already used by filter_test.ts.
 */

import { assertEquals, assertThrows } from "@std/assert";
import type { Warning } from "./check_state.ts";
import type { CheckResult } from "./check.ts";
import type { Options } from "./options.ts";
import { checkStrings, getMessage, getReport, processReports } from "./mod.ts";

function stripLocations(reports: Warning[][]): Partial<Warning>[][] {
  return reports.map((warnings) =>
    warnings.map((warning) => {
      const copy = { ...warning } as Record<string, unknown>;
      delete copy.line;
      delete copy.column;
      delete copy.end_column;
      delete copy.prev_line;
      delete copy.prev_column;
      delete copy.prev_end_column;
      return copy as Partial<Warning>;
    })
  );
}

Deno.test("check_strings", async (t) => {
  await t.step("panics on bad strings", () => {
    assertThrows(
      () => checkStrings("foo" as unknown as string[]),
      Error,
      "bad argument #1 to 'luacheck.check_strings' (table expected, got string)",
    );
    assertThrows(
      () => checkStrings([1] as unknown as string[]),
      Error,
      "bad argument #1 to 'luacheck.check_strings' (array of strings expected, got number)",
    );
  });

  await t.step("panics on bad options", () => {
    assertThrows(
      () => checkStrings(["foo"], "bar" as unknown as Options),
      Error,
      "bad argument #2 to 'luacheck.check_strings' (option table expected, got string)",
    );
    assertThrows(
      () => checkStrings(["foo"], { globals: "bar" } as unknown as Options),
      Error,
      "bad argument #2 to 'luacheck.check_strings' (invalid value of option 'globals': table expected, got string)",
    );
    assertThrows(
      () =>
        checkStrings(["foo"], {
          "1": { unused: 123 },
        } as unknown as Options),
      Error,
      "bad argument #2 to 'luacheck.check_strings' (invalid options at index [1]: invalid value of option 'unused': boolean expected, got number)",
    );
  });

  await t.step("works on empty list", () => {
    const [reports, counts] = checkStrings([]);
    assertEquals(reports, []);
    assertEquals(counts, { warnings: 0, errors: 0, fatals: 0 });
  });

  await t.step("works on strings", () => {
    const [reports, counts] = checkStrings(["return foo", "return return"]);
    assertEquals(stripLocations(reports), [
      [{ code: 113, name: "foo" }],
      [{ code: 11, msg: "expected expression near 'return'" }],
    ]);
    assertEquals(counts, { warnings: 1, errors: 1, fatals: 0 });
  });

  await t.step("supports comments in inline options", () => {
    const [reports, counts] = checkStrings([
      "local foo, bar -- luacheck: ignore foo (not bar though)",
    ]);
    assertEquals(stripLocations(reports), [[{ code: 211, name: "bar" }]]);
    assertEquals(counts, { warnings: 1, errors: 0, fatals: 0 });
  });

  await t.step("provides correct location info for warnings", () => {
    const [reports, counts] = checkStrings([
      `:: foo
::local t = {}
function t:m(x)
   self = x
   self = x
   return self
end
do return t end
(t)()
`,
    ]);
    assertEquals(reports, [
      [
        {
          code: 521,
          label: "foo",
          line: 1,
          column: 1,
          end_column: 6,
        },
        {
          code: 312,
          name: "self",
          line: 3,
          column: 11,
          end_column: 11,
          overwritten_line: 4,
          overwritten_column: 4,
          overwritten_end_column: 7,
        },
        {
          code: 311,
          name: "self",
          line: 4,
          column: 4,
          end_column: 7,
          overwritten_line: 5,
          overwritten_column: 4,
          overwritten_end_column: 7,
        },
        {
          code: 511,
          line: 9,
          column: 1,
          end_column: 5,
        },
      ],
    ]);
    assertEquals(counts, { warnings: 4, errors: 0, fatals: 0 });
  });

  await t.step("provides correct location info for bad inline options", () => {
    const [reports, counts] = checkStrings([
      `-- luacheck: push
local function f()
   -- luacheck: pop
end

return f
  -- luacheck: some invalid comment
`,
    ]);
    assertEquals(reports, [
      [
        {
          code: 22,
          line: 1,
          column: 1,
          end_column: 17,
        },
        {
          code: 23,
          line: 3,
          column: 4,
          end_column: 19,
        },
        {
          code: 21,
          msg: "unknown inline option 'some invalid comment'",
          line: 7,
          column: 3,
          end_column: 35,
        },
      ],
    ]);
    assertEquals(counts, { warnings: 0, errors: 3, fatals: 0 });
  });

  await t.step("provides correct location info for syntax errors", () => {
    const [reports, counts] = checkStrings([
      'local x = "foo',
      'local x = "foo\\x2',
      "if true ",
      "::b:: ::b::",
      "function f() (...)() end",
      "break it()",
    ]);
    assertEquals(reports, [
      [{
        code: 11,
        msg: "unfinished string",
        line: 1,
        column: 11,
        end_column: 11,
      }],
      [{
        code: 11,
        msg: "invalid hexadecimal escape sequence '\\x2'",
        line: 1,
        column: 15,
        end_column: 17,
      }],
      [{
        code: 11,
        msg: "expected 'then' near <eof>",
        line: 1,
        column: 8,
        end_column: 8,
      }],
      [{
        code: 11,
        msg: "label 'b' already defined on line 1",
        line: 1,
        column: 7,
        end_column: 11,
        prev_line: 1,
        prev_column: 1,
        prev_end_column: 5,
      }],
      [{
        code: 11,
        msg: "cannot use '...' outside a vararg function",
        line: 1,
        column: 15,
        end_column: 17,
      }],
      [{
        code: 11,
        msg: "'break' is not inside a loop",
        line: 1,
        column: 1,
        end_column: 5,
      }],
    ]);
    assertEquals(counts, { warnings: 0, errors: 6, fatals: 0 });
  });

  await t.step("uses options", () => {
    const [reports, counts] = checkStrings(["return foo", "return return"], {
      ignore: ["113"],
    });
    assertEquals(stripLocations(reports), [
      [],
      [{ code: 11, msg: "expected expression near 'return'" }],
    ]);
    assertEquals(counts, { warnings: 0, errors: 1, fatals: 0 });
  });
});

Deno.test("get_report", async (t) => {
  await t.step("panics on bad argument", () => {
    assertThrows(
      () => getReport({} as unknown as string),
      Error,
      "bad argument #1 to 'luacheck.get_report' (string expected, got table)",
    );
  });

  await t.step("returns a report", () => {
    assertEquals(typeof getReport("return foo"), "object");
  });

  await t.step(
    "returns a report with single error event on syntax error",
    () => {
      const report = getReport("return return");
      const [warning] = stripLocations([report.warnings])[0];
      assertEquals(warning, {
        code: 11,
        msg: "expected expression near 'return'",
      });
    },
  );
});

Deno.test("process_reports", async (t) => {
  await t.step("panics on bad reports", () => {
    assertThrows(
      () => processReports("foo" as unknown as CheckResult[]),
      Error,
      "bad argument #1 to 'luacheck.process_reports' (table expected, got string)",
    );
  });

  await t.step("panics on bad options", () => {
    assertThrows(
      () => processReports([{} as CheckResult], "bar" as unknown as Options),
      Error,
      "bad argument #2 to 'luacheck.process_reports' (option table expected, got string)",
    );
    assertThrows(
      () =>
        processReports([{} as CheckResult], {
          globals: "bar",
        } as unknown as Options),
      Error,
      "bad argument #2 to 'luacheck.process_reports' (invalid value of option 'globals': table expected, got string)",
    );
    assertThrows(
      () =>
        processReports([{} as CheckResult], {
          "1": { unused: 123 },
        } as unknown as Options),
      Error,
      "bad argument #2 to 'luacheck.process_reports' (invalid options at index [1]: invalid value of option 'unused': boolean expected, got number)",
    );
  });

  await t.step("processes reports", () => {
    const [reports, counts] = processReports([
      getReport("return foo"),
      getReport("return math"),
    ]);
    assertEquals(stripLocations(reports), [
      [{ code: 113, name: "foo" }],
      [],
    ]);
    assertEquals(counts, { warnings: 1, errors: 0, fatals: 0 });
  });

  await t.step("uses options", () => {
    const [reports, counts] = processReports(
      [getReport("return foo"), getReport("return math.floor")],
      { std: {} },
    );
    assertEquals(stripLocations(reports), [
      [{ code: 113, name: "foo" }],
      [{ code: 113, name: "math", indexing: ["floor"] }],
    ]);
    assertEquals(counts, { warnings: 2, errors: 0, fatals: 0 });
  });
});

Deno.test("get_message", async (t) => {
  await t.step("panics on bad events", () => {
    assertThrows(
      () => getMessage("foo" as unknown as Warning),
      Error,
      "bad argument #1 to 'luacheck.get_message' (table expected, got string)",
    );
  });

  await t.step("returns message for an event", () => {
    assertEquals(
      getMessage({ code: 212, name: "bar" } as unknown as Warning),
      "unused argument 'bar'",
    );

    assertEquals(
      getMessage(
        { code: 423, name: "foo", line: 2, prev_line: 1 } as unknown as Warning,
      ),
      "shadowing definition of loop variable 'foo' on line 1",
    );

    assertEquals(
      getMessage(
        { code: 521, name: "unrelated", label: "fail" } as unknown as Warning,
      ),
      "unused label 'fail'",
    );

    assertEquals(
      getMessage({
        code: 314,
        name: "unrelated",
        field: "actual",
        overwritten_line: 2,
      } as unknown as Warning),
      "value assigned to field 'actual' is overwritten on line 2 before use",
    );

    assertEquals(
      getMessage({
        code: 314,
        name: "11037",
        field: "42",
        index: true,
        overwritten_line: 2,
      } as unknown as Warning),
      "value assigned to index '42' is overwritten on line 2 before use",
    );

    assertEquals(
      getMessage({ code: 11, msg: "message goes here" } as unknown as Warning),
      "message goes here",
    );

    assertEquals(
      getMessage(
        {
          code: 11,
          msg: "unexpected character near '%'",
        } as unknown as Warning,
      ),
      "unexpected character near '%'",
    );

    assertEquals(
      getMessage({
        code: 211,
        name: "hello",
        func: true,
        recursive: true,
      } as unknown as Warning),
      "unused recursive function 'hello'",
    );

    assertEquals(
      getMessage({
        code: 211,
        name: "hallo",
        func: true,
        mutually_recursive: true,
      } as unknown as Warning),
      "unused mutually recursive function 'hallo'",
    );

    assertEquals(
      getMessage({
        code: 561,
        function_type: "main_chunk",
        complexity: "yes",
        max_complexity: "please no",
      } as unknown as Warning),
      "cyclomatic complexity of main chunk is too high (yes > please no)",
    );

    assertEquals(
      getMessage({
        code: 561,
        function_type: "function",
        complexity: 10,
        max_complexity: 1,
      } as unknown as Warning),
      "cyclomatic complexity of function is too high (10 > 1)",
    );

    assertEquals(
      getMessage({
        code: 561,
        function_type: "function",
        function_name: ">>=",
        complexity: 10,
        max_complexity: 1,
      } as unknown as Warning),
      "cyclomatic complexity of function '>>=' is too high (10 > 1)",
    );

    assertEquals(
      getMessage({
        code: 561,
        function_type: "method",
        function_name: "foo.bar.baz",
        complexity: 1000,
        max_complexity: 10,
      } as unknown as Warning),
      "cyclomatic complexity of method 'foo.bar.baz' is too high (1000 > 10)",
    );
  });
});
