/**
 * Ported from luacheck's filter_spec.lua (594 lines): one Deno test for
 * the single `describe("filter", ...)` block, one `t.step` per `it`.
 *
 * `filter_spec.lua`'s own `filter(issue_arrays, opts)` helper builds a
 * `CheckResult` per issue array (one line per issue, `line_lengths` all
 * 0 so no line-length warnings fire), calls `filter.filter`, then strips
 * `line`/`column` from every output warning before comparing - most cases
 * only care about which warnings survive, not their synthetic positions.
 * Two cases ("applies inline option events...", "adds line length
 * warnings") call `filter_full` directly with hand-built check results
 * instead, and do compare positions.
 *
 * Warning codes are plain numbers in this port (`check.ts`), not the
 * zero-padded 3-digit strings `filter_spec.lua` uses; every fixture below
 * uses the number.
 */

import { assertEquals } from "@std/assert";
import type { Warning } from "./check_state.ts";
import type { CheckResult } from "./check.ts";
import type { Options } from "./options.ts";
import { filter } from "./filter.ts";

type IssueInput = Partial<Warning> & { code: number };
/** Loosened for comparisons that don't care about every `Warning` field. */
type LooseWarning = Partial<Warning> & Record<string, unknown>;

function buildCheckResults(issueArrays: IssueInput[][]): CheckResult[] {
  return issueArrays.map((issues) => {
    const lineLengths: number[] = [0];
    const warnings: Warning[] = issues.map((issue, index) => {
      lineLengths.push(0);
      return {
        end_column: 1,
        ...issue,
        line: index + 1,
        column: 1,
      } as Warning;
    });

    return {
      warnings,
      inline_options: [],
      line_lengths: lineLengths,
      line_endings: {},
    };
  });
}

function filterFixture(
  issueArrays: IssueInput[][],
  opts?: Options,
): LooseWarning[][] {
  const result = filter(buildCheckResults(issueArrays), opts);

  for (const fileReport of result) {
    for (const issue of fileReport) {
      const loose = issue as unknown as Record<string, unknown>;
      delete loose.line;
      delete loose.column;
      // `buildCheckResults` had to fill in a placeholder `end_column` to
      // satisfy `Warning`'s required field; upstream's fixture never sets
      // one, so strip it the same way `line`/`column` are stripped above.
      delete loose.end_column;
    }
  }

  return result as unknown as LooseWarning[][];
}

Deno.test("filter", async (t) => {
  await t.step("filters warnings by name", () => {
    assertEquals(
      filterFixture([
        [
          { code: 211, name: "foo" },
          { code: 211, name: "bar" },
          { code: 211, name: "baz" },
        ],
      ], { ignore: ["bar"], only: ["bar", "baz"] }),
      [
        [{ code: 211, name: "baz" }],
      ],
    );
  });

  await t.step(
    "removes unused var/value and redefined warnings related to _, unless it's useless",
    () => {
      assertEquals(
        filterFixture([
          [
            { code: 211, name: "foo" },
            { code: 211, name: "_", useless: true },
            { code: 412, name: "_" },
            { code: 221, name: "_" },
          ],
        ]),
        [
          [
            { code: 211, name: "foo" },
            { code: 211, name: "_", useless: true },
          ],
        ],
      );
    },
  );

  await t.step("filters warnings by type", () => {
    assertEquals(
      filterFixture([
        [
          { code: 211, name: "foo" },
          { code: 111, name: "bar" },
          { code: 413, name: "baz" },
        ],
      ], { global: false, redefined: false }),
      [
        [{ code: 211, name: "foo" }],
      ],
    );

    assertEquals(
      filterFixture([
        [
          { code: 221, name: "foo" },
          { code: 111, name: "bar" },
          { code: 321, name: "qu" },
          { code: 413, name: "baz" },
        ],
      ], { ignore: ["32"] }),
      [
        [
          { code: 221, name: "foo" },
          { code: 111, name: "bar" },
          { code: 413, name: "baz" },
        ],
      ],
    );
  });

  await t.step("filters warnings by code and name using patterns", () => {
    assertEquals(
      filterFixture([
        [
          { code: 212, name: "bar" },
          { code: 212, name: "_qu" },
          { code: 321, name: "foo" },
          { code: 413, name: "_baz" },
        ],
      ], { ignore: ["foo", "212/_.*"] }),
      [
        [
          { code: 212, name: "bar" },
          { code: 413, name: "_baz" },
        ],
      ],
    );
  });

  await t.step("filters unused warnings by subtype", () => {
    assertEquals(
      filterFixture([
        [
          { code: 211, name: "foo" },
          { code: 311, name: "bar" },
          { code: 212, name: "baz" },
          { code: 221, name: "qu" },
        ],
      ], { ignore: ["22", "31"], unused_args: false }),
      [
        [{ code: 211, name: "foo" }],
      ],
    );
  });

  await t.step("filters unused warnings related to secondary variables", () => {
    assertEquals(
      filterFixture([
        [
          { code: 211, name: "foo", secondary: true },
          { code: 311, name: "bar", secondary: true },
          { code: 212, name: "baz" },
        ],
      ], { unused_secondaries: false }),
      [
        [{ code: 212, name: "baz" }],
      ],
    );
  });

  await t.step(
    "filters unused and redefined warnings related to implicit self",
    () => {
      assertEquals(
        filterFixture([
          [
            { code: 212, name: "self", self: true },
            { code: 432, name: "self", self: true },
            { code: 212, name: "self" },
          ],
        ], { self: false }),
        [
          [{ code: 212, name: "self" }],
        ],
      );
    },
  );

  await t.step("filters defined globals", () => {
    assertEquals(
      filterFixture([
        [
          { code: 113, name: "foo" },
          { code: 111, name: "module" },
        ],
      ], { std: {}, globals: { "1": "foo" } }),
      [
        [{ code: 111, name: "module" }],
      ],
    );
  });

  await t.step("filters standard globals", () => {
    // Upstream uses std = "min", a preset this port drops; "lua54" stands
    // in, since it also defines `package` as a standard global.
    assertEquals(
      filterFixture([
        [
          { code: 113, name: "package" },
          { code: 111, name: "module" },
        ],
      ], { std: "lua54" }),
      [
        [{ code: 111, name: "module" }],
      ],
    );
  });

  await t.step("allows defined globals with allow_defined = true", () => {
    assertEquals(
      filterFixture([
        [
          { code: 113, name: "foo" },
          { code: 111, name: "foo" },
          { code: 111, name: "bar" },
          { code: 113, name: "baz" },
        ],
      ], { allow_defined: true }),
      [
        [
          { code: 131, name: "bar" },
          { code: 113, name: "baz" },
        ],
      ],
    );
  });

  await t.step(
    "allows globals defined in top level function scope with allow_defined_top = true",
    () => {
      assertEquals(
        filterFixture([
          [
            { code: 113, name: "foo" },
            { code: 111, name: "foo", top: true },
            { code: 111, name: "bar" },
            { code: 113, name: "baz" },
          ],
        ], { allow_defined_top: true }),
        [
          [
            { code: 111, name: "bar" },
            { code: 113, name: "baz" },
          ],
        ],
      );
    },
  );

  await t.step(
    "allows globals defined in the same file with module = true",
    () => {
      assertEquals(
        filterFixture([
          [
            { code: 113, name: "foo" },
            { code: 111, name: "foo" },
          ],
          [
            { code: 113, name: "foo" },
          ],
        ], { allow_defined: true, module: true }),
        [
          [],
          [{ code: 113, name: "foo" }],
        ],
      );
    },
  );

  await t.step(
    "only allows setting globals defined in the same file with module = true",
    () => {
      assertEquals(
        filterFixture([
          [
            { code: 111, name: "bar" },
          ],
          [
            { code: 111, name: "foo", top: true },
            { code: 111, name: "foo" },
            { code: 111, name: "string" },
            { code: 111, name: "bar" },
          ],
        ], {
          "1": { allow_defined: true, ignore: ["13"] },
          "2": { allow_defined_top: true, module: true },
        }),
        [
          [],
          [
            { code: 111, name: "string", module: true },
            { code: 111, name: "bar", module: true },
          ],
        ],
      );
    },
  );

  await t.step(
    "using an implicitly defined global from a module marks it as used",
    () => {
      assertEquals(
        filterFixture([
          [
            { code: 111, name: "foo" },
          ],
          [
            { code: 113, name: "foo" },
            { code: 111, name: "bar" },
          ],
        ], {
          "1": { allow_defined: true },
          "2": { allow_defined: true, module: true },
        }),
        [
          [],
          [],
        ],
      );
    },
  );

  await t.step("applies inline option events and per-line options", () => {
    // Upstream uses std = "max", a preset this port drops (see PORT_NOTES.md
    // section 6 / options_test.ts's own substitutions); "lua54" stands in,
    // since it also defines `print` as a read-only global. Upstream's
    // std = "none" (another dropped preset) is replaced with an equivalent
    // empty std table, `{}`.
    const checkResults: CheckResult[] = [
      {
        warnings: [
          { code: 111, name: "not_print", line: 1, column: 1, end_column: 1 },
          { code: 111, name: "not_print", line: 4, column: 1, end_column: 1 },
          { code: 111, name: "print", line: 5, column: 1, end_column: 1 },
          { code: 111, name: "print", line: 7, column: 1, end_column: 1 },
          { code: 111, name: "not_print", line: 12, column: 1, end_column: 1 },
          { code: 211, name: "not_print", line: 14, column: 1, end_column: 1 },
          { code: 311, name: "c", line: 14, column: 2, end_column: 2 },
        ],
        inline_options: [
          { options: { std: {} }, line: 3, column: 1 },
          { options: { ignore: [".*"] }, line: 4, column: 10 },
          { pop_count: 1, line: 5 },
          { pop_count: 1, line: 7 },
          { options: { std: "bad_std" }, line: 8, column: 1 },
          { options: { std: "lua54" }, line: 9, column: 1 },
          { options: { std: "another_bad_std" }, line: 11, column: 20 },
          { options: { ignore: ["not_print"] }, line: 12, column: 1 },
          { options: { ignore: ["211"] }, line: 13, column: 1 },
          { pop_count: 2, options: { ignore: ["c"] }, line: 14, column: 1 },
        ],
        line_lengths: Array(15).fill(0),
        line_endings: {},
      },
    ];

    assertEquals(
      filter(checkResults, { "1": { std: "lua54" } }) as LooseWarning[][],
      [
        [
          { code: 111, name: "not_print", line: 1, column: 1, end_column: 1 },
          { code: 111, name: "print", line: 5, column: 1, end_column: 1 },
          { code: 121, name: "print", line: 7, column: 1, end_column: 1 },
          {
            code: 21,
            msg: "invalid value of option 'std': unknown std 'bad_std'",
            line: 8,
            column: 1,
          },
          {
            code: 21,
            msg: "invalid value of option 'std': unknown std 'another_bad_std'",
            line: 11,
            column: 20,
          },
          { code: 211, name: "not_print", line: 14, column: 1, end_column: 1 },
        ],
      ],
    );
  });

  await t.step("adds line length warnings", () => {
    const checkResults: CheckResult[] = [
      {
        warnings: [],
        inline_options: [
          { options: { max_line_length: 20 }, line: 3, column: 1 },
          { options: { max_string_line_length: 15 }, line: 4, column: 1 },
          { options: { max_line_length: false }, line: 6, column: 1 },
        ],
        line_lengths: [0, 120, 121, 15, 20, 18, 15, 200],
        line_endings: { 5: "string" },
      },
    ];

    assertEquals(
      filter(checkResults, {}) as LooseWarning[][],
      [
        [
          { code: 631, line: 2, column: 121, end_column: 121, max_length: 120 },
          {
            code: 631,
            line: 5,
            column: 16,
            end_column: 18,
            line_ending: "string",
            max_length: 15,
          },
        ],
      ],
    );
  });
});
