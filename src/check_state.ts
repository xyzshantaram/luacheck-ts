/**
 * Ported from luacheck's check_state.lua: the `CheckState` object that
 * collects and stamps warnings during the check pipeline.
 *
 * `lineOffsets`, `lineLengths`, `source`, `ast`, `comments`, `codeLines`,
 * `lineEndings`, and `hangingSemicolons` are not set here. `stages/parse.ts`
 * sets them after construction, once fed from parser.parse()'s output.
 * `topLine` and `lines` are likewise not set here: `stages/linearize.ts`
 * sets them. This mirrors upstream, where `CheckState:__init` sets only
 * `source_bytes` and `warnings`.
 *
 * The `LineInstance` import below is type-only, so it doesn't create a
 * runtime circular dependency even though `stages/linearize.ts` itself
 * imports `CheckStateInstance` from this file.
 */

import type { AstNode, CommentEntry, Range } from "./parser.ts";
import type { Chars } from "./decoder.ts";
import type { LineInstance } from "./stages/linearize.ts";
import { class as classImpl } from "./utils.ts";

/**
 * A single warning emitted during the check pipeline. This is public
 * data-format output: field names match luacheck's warning data 1:1, so
 * `end_column` stays snake_case. Later pipeline stages, not yet ported,
 * add more fields per warning code.
 */
export interface Warning {
  code: number;
  line: number;
  column: number;
  end_column: number;
  name?: string;
  [key: string]: unknown;
}

/**
 * Shape of a column range as used by `warnColumnRange`: columns already
 * resolved, not byte offsets. `end_column` stays snake_case to match the
 * `Warning` field it is copied into.
 */
interface WarnColumnRangeInput {
  line: number;
  column: number;
  end_column: number;
}

export interface CheckStateInstance {
  sourceBytes: string;
  warnings: Warning[];
  lineOffsets: number[];
  lineLengths: number[];
  source: Chars;
  ast: AstNode;
  comments: CommentEntry[];
  codeLines: Record<number, boolean>;
  lineEndings: Record<number, "comment" | "string">;
  hangingSemicolons: Range[];
  topLine: LineInstance;
  lines: LineInstance[];
  offsetToColumn(line: number, offset: number): number;
  warnColumnRange(
    code: number,
    range: WarnColumnRangeInput,
    warning?: Partial<Warning>,
  ): Warning;
  warn(
    code: number,
    line: number,
    offset: number,
    endOffset: number,
    warning?: Partial<Warning>,
  ): Warning;
  warnRange(code: number, range: Range, warning?: Partial<Warning>): Warning;
  warnVar(
    code: number,
    variable: { node: Range; name: string },
    warning?: Partial<Warning>,
  ): Warning;
  warnValue(
    code: number,
    value: { varNode: Range; var: { name: string } },
    warning?: Partial<Warning>,
  ): Warning;
  [key: string]: unknown;
}

const CheckState = classImpl<CheckStateInstance>();

CheckState.__init = function (
  obj: Record<string, unknown>,
  sourceBytes: unknown,
) {
  const self = obj as CheckStateInstance;
  self.sourceBytes = sourceBytes as string;
  self.warnings = [];
};

// Returns column of a character in a line given its offset.
// The column is never larger than the line length.
// This can be called if line length is not yet known.
CheckState.offsetToColumn = function (
  this: CheckStateInstance,
  line: number,
  offset: number,
): number {
  const lineLength = this.lineLengths[line];
  const column = offset - this.lineOffsets[line] + 1;

  if (!lineLength) {
    return column;
  }

  return Math.max(1, Math.min(lineLength, column));
};

CheckState.warnColumnRange = function (
  this: CheckStateInstance,
  code: number,
  range: WarnColumnRangeInput,
  warning?: Partial<Warning>,
): Warning {
  const w = (warning ?? {}) as Warning;
  w.code = code;
  w.line = range.line;
  w.column = range.column;
  w.end_column = range.end_column;
  this.warnings.push(w);
  return w;
};

CheckState.warn = function (
  this: CheckStateInstance,
  code: number,
  line: number,
  offset: number,
  endOffset: number,
  warning?: Partial<Warning>,
): Warning {
  const w = (warning ?? {}) as Warning;
  w.code = code;
  w.line = line;
  w.column = this.offsetToColumn(line, offset);
  w.end_column = this.offsetToColumn(line, endOffset);
  this.warnings.push(w);
  return w;
};

CheckState.warnRange = function (
  this: CheckStateInstance,
  code: number,
  range: Range,
  warning?: Partial<Warning>,
): Warning {
  return this.warn(code, range.line, range.offset, range.endOffset, warning);
};

CheckState.warnVar = function (
  this: CheckStateInstance,
  code: number,
  variable: { node: Range; name: string },
  warning?: Partial<Warning>,
): Warning {
  const w = this.warnRange(code, variable.node, warning);
  w.name = variable.name;
  return w;
};

CheckState.warnValue = function (
  this: CheckStateInstance,
  code: number,
  value: { varNode: Range; var: { name: string } },
  warning?: Partial<Warning>,
): Warning {
  const w = this.warnRange(code, value.varNode, warning);
  w.name = value.var.name;
  return w;
};

export function checkStateNew(sourceBytes: string): CheckStateInstance {
  return CheckState(sourceBytes) as CheckStateInstance;
}
