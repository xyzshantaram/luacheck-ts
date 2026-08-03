/**
 * luacheck-ts — a TypeScript port of the luacheck Lua linter.
 *
 * Ported from luacheck's top-level init.lua: the public API. `getReport`
 * wraps check.ts's `check`; `processReports` and `checkStrings` apply
 * options via filter.ts's `filter` and tally warning/error counts;
 * `getMessage` wraps format.ts's `getMessage`.
 *
 * Two deliberate deviations from a strict 1:1 mirror, both disclosed in
 * PLAN.md's Phase 5 entry: `processReports`/`checkStrings` return a
 * `[reports, counts]` tuple (`reports` a real array of real arrays of
 * `Warning`; `counts` a `{warnings, errors, fatals}` object) instead of
 * Lua's array-with-three-extra-named-properties shape; and `checkFiles`
 * (disk I/O) plus the `luacheck` table's callable-invocation form built on
 * it are dropped entirely, so `checkStrings` takes `string[]` only, not
 * Lua's `string | {fatal, msg}` item shape that existed only to let
 * `checkFiles` pass through unreadable-file markers. `fatals` in `Counts`
 * is therefore always `0` here, kept for shape fidelity with upstream.
 */

import type { Warning } from "./check_state.ts";
import { check, type CheckResult } from "./check.ts";
import { filter } from "./filter.ts";
import { allOptions, type Options, validate } from "./options.ts";
import type { StdTable } from "./standards.ts";
import { getMessage as formatGetMessage } from "./format.ts";
import { luaType } from "./utils.ts";

export interface Counts {
  warnings: number;
  errors: number;
  fatals: number;
}

function codeKey(code: number): string {
  return String(code).padStart(3, "0");
}

function rawValidateOptions(
  fname: string,
  opts: Options | undefined,
  stds?: Record<string, StdTable>,
  context?: string,
): void {
  const [ok, err] = validate(allOptions, opts, stds);

  if (!ok) {
    throw new Error(
      context
        ? `bad argument #2 to '${fname}' (${context}: ${err})`
        : `bad argument #2 to '${fname}' (${err})`,
    );
  }
}

/**
 * Validates `opts` itself, then `opts["1"]`, `opts["2"]`, ... (one per
 * entry in `items`, per-item option overrides), then each of those
 * entries' own array part `opts[i]["1"]`, `opts[i]["2"]`, ....
 */
function validateOptions(
  fname: string,
  items: unknown[],
  opts?: Options,
  stds?: Record<string, StdTable>,
): void {
  rawValidateOptions(fname, opts);

  if (opts === undefined) {
    return;
  }

  items.forEach((_item, i) => {
    const index = i + 1;
    const nestedOpts = opts[String(index)] as Options | undefined;
    rawValidateOptions(
      fname,
      nestedOpts,
      stds,
      `invalid options at index [${index}]`,
    );

    if (nestedOpts === undefined) {
      return;
    }

    for (let j = 1;; j++) {
      const doubleNestedOpts = nestedOpts[String(j)] as Options | undefined;

      if (doubleNestedOpts === undefined) {
        break;
      }

      rawValidateOptions(
        fname,
        doubleNestedOpts,
        stds,
        `invalid options at index [${index}][${j}]`,
      );
    }
  });
}

/** Returns the raw check report for a source string. */
export function getReport(src: string): CheckResult {
  if (luaType(src) !== "string") {
    throw new Error(
      `bad argument #1 to 'luacheck.get_report' (string expected, got ${
        luaType(src)
      })`,
    );
  }

  return check(src);
}

/**
 * Applies options to check reports. Options are applied to `reports[i]`
 * in order: `opts`, `opts[i]`, `opts[i][1]`, `opts[i][2]`, .... Returns
 * the filtered, location-sorted warnings per report, plus totals.
 */
export function processReports(
  reports: CheckResult[],
  opts?: Options,
  stds?: Record<string, StdTable>,
): [Warning[][], Counts] {
  if (luaType(reports) !== "table") {
    throw new Error(
      `bad argument #1 to 'luacheck.process_reports' (table expected, got ${
        luaType(reports)
      })`,
    );
  }

  validateOptions("luacheck.process_reports", reports, opts, stds);
  const filtered = filter(reports, opts, stds);

  let warnings = 0;
  let errors = 0;

  for (const fileWarnings of filtered) {
    for (const event of fileWarnings) {
      if (codeKey(event.code).startsWith("0")) {
        errors++;
      } else {
        warnings++;
      }
    }
  }

  return [filtered, { warnings, errors, fatals: 0 }];
}

/**
 * Checks strings with options, returns the filtered report and totals.
 */
export function checkStrings(
  srcs: string[],
  opts?: Options,
): [Warning[][], Counts] {
  if (luaType(srcs) !== "table") {
    throw new Error(
      `bad argument #1 to 'luacheck.check_strings' (table expected, got ${
        luaType(srcs)
      })`,
    );
  }

  for (const src of srcs) {
    if (luaType(src) !== "string") {
      throw new Error(
        `bad argument #1 to 'luacheck.check_strings' (array of strings expected, got ${
          luaType(src)
        })`,
      );
    }
  }

  validateOptions("luacheck.check_strings", srcs, opts);
  const reports = srcs.map((src) => getReport(src));
  return processReports(reports, opts);
}

/** Returns the human-readable message for a warning. */
export function getMessage(warning: Warning): string {
  if (luaType(warning) !== "table") {
    throw new Error(
      `bad argument #1 to 'luacheck.get_message' (table expected, got ${
        luaType(warning)
      })`,
    );
  }

  return formatGetMessage(warning);
}
