/**
 * Ported from luacheck's check.lua: runs the check pipeline over source
 * and packages the result, converting a thrown `SyntaxError` into a
 * single code-11 warning.
 *
 * `stages.warnings` keys warning entries by a zero-padded 3-digit string
 * (e.g. "011", "021"), while `Warning.code` is a plain number (11, 21).
 * Every lookup below pads the code to 3 digits before indexing
 * `stages.warnings`, so codes under 100 still resolve.
 */

import type { InlineOptionsEntry, Warning } from "./check_state.ts";
import { checkStateNew } from "./check_state.ts";
import { sortByLocation } from "./core_utils.ts";
import type { SyntaxErrorInstance } from "./parser.ts";
import { SyntaxError } from "./parser.ts";
import { stages } from "./stages/init.ts";
import { inlineOptionFields } from "./stages/parse_inline_options.ts";
import { arrayToSet, isInstance } from "./utils.ts";

export interface CheckResult {
  warnings: Warning[];
  inline_options: InlineOptionsEntry[];
  line_lengths: number[];
  line_endings: Record<number, "comment" | "string">;
}

const inlineOptionFieldsSet = arrayToSet(inlineOptionFields);

function codeKey(code: number): string {
  return String(code).padStart(3, "0");
}

function validateWarnings(warnings: Warning[]): void {
  for (const warning of warnings) {
    const info = stages.warnings[codeKey(warning.code)];

    if (!info) {
      throw new Error(`Unknown issue code ${warning.code}`);
    }

    for (const field of Object.keys(warning)) {
      if (!info.fields_set[field]) {
        throw new Error(
          `Unknown field ${field} in issue with code ${warning.code}`,
        );
      }
    }
  }
}

function validateInlineOptions(entries: InlineOptionsEntry[]): void {
  for (const entry of entries) {
    for (const field of Object.keys(entry)) {
      if (!inlineOptionFieldsSet[field]) {
        throw new Error(`Unknown field ${field} in inline option table`);
      }
    }
  }
}

/**
 * Checks source. Returns warnings, inline option events, per-line lengths,
 * and per-line endings. If source has a syntax error, `warnings` holds a
 * single code-11 entry and the other three fields are empty.
 */
export function check(source: string): CheckResult {
  const chstate = checkStateNew(source);

  let warnings: Warning[];
  let inlineOptions: InlineOptionsEntry[];
  let lineLengths: number[];
  let lineEndings: Record<number, "comment" | "string">;

  try {
    stages.run(chstate);
    warnings = chstate.warnings;
    sortByLocation(warnings);
    inlineOptions = chstate.inlineOptions ?? [];
    lineLengths = chstate.lineLengths;
    lineEndings = chstate.lineEndings;
  } catch (err) {
    if (!isInstance(err, SyntaxError)) {
      throw err;
    }

    const syntaxErr = err as SyntaxErrorInstance;
    const warning: Warning = {
      code: 11,
      line: syntaxErr.line,
      column: chstate.offsetToColumn(syntaxErr.line, syntaxErr.offset),
      end_column: chstate.offsetToColumn(syntaxErr.line, syntaxErr.endOffset),
      msg: syntaxErr.msg,
    };

    if (syntaxErr.prevLine !== undefined) {
      warning.prev_line = syntaxErr.prevLine;
      warning.prev_column = chstate.offsetToColumn(
        syntaxErr.prevLine,
        syntaxErr.prevOffset!,
      );
      warning.prev_end_column = chstate.offsetToColumn(
        syntaxErr.prevLine,
        syntaxErr.prevEndOffset!,
      );
    }

    warnings = [warning];
    inlineOptions = [];
    lineLengths = [];
    lineEndings = {};
  }

  validateWarnings(warnings);
  validateInlineOptions(inlineOptions);

  return {
    warnings,
    inline_options: inlineOptions,
    line_lengths: lineLengths,
    line_endings: lineEndings,
  };
}
