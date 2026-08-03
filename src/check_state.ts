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
import type { Options } from "./options.ts";

import type {
  NamedWarning,
  NamedWarningByCode,
  Warning,
  WarningByCode,
} from "./warnings.ts";
export type { NamedWarning, Warning } from "./warnings.ts";

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

/**
 * Placeholder shape for `chstate.inlineOptions`, added ahead of
 * stages/parse_inline_options.ts (ticket 4.3) so ticket 4.3's tests can
 * compile against a real field instead of an invented one. Mirrors
 * `stage.inline_option_fields` from parse_inline_options.lua
 * (`line`, `pop_count`, `options`, `column`, `end_column`); the ticket 4.3
 * implementation dispatch may adjust this.
 */
export interface InlineOptionsEntry {
  line: number;
  pop_count?: number;
  options?: Options;
  column?: number;
  end_column?: number;
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
  inlineOptions?: InlineOptionsEntry[];
  offsetToColumn(line: number, offset: number): number;
  warnColumnRange<C extends Warning["code"]>(
    code: C,
    range: WarnColumnRangeInput,
    warning?: Partial<
      Omit<WarningByCode[C], "code" | "line" | "column" | "end_column">
    >,
  ): WarningByCode[C];
  warn<C extends Warning["code"]>(
    code: C,
    line: number,
    offset: number,
    endOffset: number,
    warning?: Partial<
      Omit<WarningByCode[C], "code" | "line" | "column" | "end_column">
    >,
  ): WarningByCode[C];
  warnRange<C extends Warning["code"]>(
    code: C,
    range: Range,
    warning?: Partial<
      Omit<WarningByCode[C], "code" | "line" | "column" | "end_column">
    >,
  ): WarningByCode[C];
  warnVar<C extends NamedWarning["code"]>(
    code: C,
    variable: { node: Range; name: string },
    warning?: Partial<
      Omit<NamedWarningByCode[C], "code" | "line" | "column" | "end_column">
    >,
  ): NamedWarningByCode[C];
  warnValue<C extends NamedWarning["code"]>(
    code: C,
    value: { varNode: Range; var: { name: string } },
    warning?: Partial<
      Omit<NamedWarningByCode[C], "code" | "line" | "column" | "end_column">
    >,
  ): NamedWarningByCode[C];
  [key: string]: unknown;
}

export class CheckState implements CheckStateInstance {
  sourceBytes: string;
  warnings: Warning[];

  declare lineOffsets: number[];
  declare lineLengths: number[];
  declare source: Chars;
  declare ast: AstNode;
  declare comments: CommentEntry[];
  declare codeLines: Record<number, boolean>;
  declare lineEndings: Record<number, "comment" | "string">;
  declare hangingSemicolons: Range[];
  declare topLine: LineInstance;
  declare lines: LineInstance[];
  declare inlineOptions?: InlineOptionsEntry[];

  [key: string]: unknown;

  constructor(sourceBytes: string) {
    this.sourceBytes = sourceBytes;
    this.warnings = [];
  }

  // Returns column of a character in a line given its offset.
  // The column is never larger than the line length.
  // This can be called if line length is not yet known.
  offsetToColumn(line: number, offset: number): number {
    const lineLength = this.lineLengths[line];
    const column = offset - this.lineOffsets[line] + 1;

    if (!lineLength) {
      return column;
    }

    return Math.max(1, Math.min(lineLength, column));
  }

  warnColumnRange<C extends Warning["code"]>(
    code: C,
    range: WarnColumnRangeInput,
    warning?: Partial<
      Omit<WarningByCode[C], "code" | "line" | "column" | "end_column">
    >,
  ): WarningByCode[C] {
    const w = (warning ?? {}) as Record<string, unknown>;
    w.code = code;
    w.line = range.line;
    w.column = range.column;
    w.end_column = range.end_column;
    this.warnings.push(w as unknown as WarningByCode[C]);
    return w as unknown as WarningByCode[C];
  }

  warn<C extends Warning["code"]>(
    code: C,
    line: number,
    offset: number,
    endOffset: number,
    warning?: Partial<
      Omit<WarningByCode[C], "code" | "line" | "column" | "end_column">
    >,
  ): WarningByCode[C] {
    const w = (warning ?? {}) as Record<string, unknown>;
    w.code = code;
    w.line = line;
    w.column = this.offsetToColumn(line, offset);
    w.end_column = this.offsetToColumn(line, endOffset);
    this.warnings.push(w as unknown as WarningByCode[C]);
    return w as unknown as WarningByCode[C];
  }

  warnRange<C extends Warning["code"]>(
    code: C,
    range: Range,
    warning?: Partial<
      Omit<WarningByCode[C], "code" | "line" | "column" | "end_column">
    >,
  ): WarningByCode[C] {
    return this.warn(code, range.line, range.offset, range.endOffset, warning);
  }

  warnVar<C extends NamedWarning["code"]>(
    code: C,
    variable: { node: Range; name: string },
    warning?: Partial<
      Omit<NamedWarningByCode[C], "code" | "line" | "column" | "end_column">
    >,
  ): NamedWarningByCode[C] {
    const w = this.warnRange(
      code,
      variable.node,
      warning as Partial<
        Omit<WarningByCode[C], "code" | "line" | "column" | "end_column">
      >,
    ) as NamedWarningByCode[C];
    w.name = variable.name;
    return w;
  }

  warnValue<C extends NamedWarning["code"]>(
    code: C,
    value: { varNode: Range; var: { name: string } },
    warning?: Partial<
      Omit<NamedWarningByCode[C], "code" | "line" | "column" | "end_column">
    >,
  ): NamedWarningByCode[C] {
    const w = this.warnRange(
      code,
      value.varNode,
      warning as Partial<
        Omit<WarningByCode[C], "code" | "line" | "column" | "end_column">
      >,
    ) as NamedWarningByCode[C];
    w.name = value.var.name;
    return w;
  }
}

export function checkStateNew(sourceBytes: string): CheckStateInstance {
  return new CheckState(sourceBytes);
}
