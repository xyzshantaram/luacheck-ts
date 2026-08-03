/**
 * The discriminated union of all warning shapes the check pipeline can
 * produce, one variant per warning code. `Warning` is the union itself;
 * `code` is a single literal number per variant, so narrowing on
 * `warning.code` gives access to that variant's fields.
 *
 * Field names match luacheck's warning data 1:1, so `end_column` and
 * `prev_end_column` stay snake_case. A field marked `?` is genuinely
 * optional: some constructions of that code omit it (each stage module
 * drops `undefined`-valued keys before pushing a warning, mirroring how a
 * Lua table constructor never creates a key assigned `nil`).
 *
 * The registered `fields` arrays passed to `registerWarnings` in
 * stages/init.ts are the runtime mirror of this union, kept in sync with
 * the true reachable field set per code (see ticket 7.1).
 */

/** Warning code 011: a syntax error, reported as a single warning. */
export interface SyntaxErrorWarning {
  code: 11;
  line: number;
  column: number;
  end_column: number;
  msg: string;
  /** Present together with `prev_column`/`prev_end_column` or not at all. */
  prev_line?: number;
  prev_column?: number;
  prev_end_column?: number;
}

/** Warning code 021: an invalid inline option. */
export interface InvalidInlineOptionWarning {
  code: 21;
  line: number;
  column: number;
  end_column: number;
  msg: string;
}

/** Warning code 022: an unpaired `-- luacheck: push` directive. */
export interface UnpairedPushWarning {
  code: 22;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 023: an unpaired `-- luacheck: pop` directive. */
export interface UnpairedPopWarning {
  code: 23;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 033: an assignment that uses a compound operator. */
export interface CompoundOperatorWarning {
  code: 33;
  line: number;
  column: number;
  end_column: number;
  operator: string;
}

/** Warning code 111: setting a global variable. */
export interface SettingGlobalWarning {
  code: 111;
  line: number;
  column: number;
  end_column: number;
  name: string;
  indexing?: (boolean | string)[];
  previous_indexing_len?: number;
  top?: true;
  indirect?: true;
  /** Set during filtering, never by the stages. */
  module?: true;
}

/** Warning code 112: mutating a global variable. */
export interface MutatingGlobalWarning {
  code: 112;
  line: number;
  column: number;
  end_column: number;
  name: string;
  indexing?: (boolean | string)[];
  previous_indexing_len?: number;
  indirect?: true;
}

/** Warning code 113: accessing a global variable. */
export interface AccessingGlobalWarning {
  code: 113;
  line: number;
  column: number;
  end_column: number;
  name: string;
  indexing?: (boolean | string)[];
  previous_indexing_len?: number;
  indirect?: true;
}

/** Warning code 121: setting a read-only global variable. Created during filtering. */
export interface SettingReadOnlyGlobalWarning {
  code: 121;
  line: number;
  column: number;
  end_column: number;
  name: string;
  indexing?: (boolean | string)[];
  previous_indexing_len?: number;
  top?: true;
  indirect?: true;
}

/** Warning code 122: setting a read-only field of a global variable. Created during filtering. */
export interface SettingReadOnlyFieldOfGlobalWarning {
  code: 122;
  line: number;
  column: number;
  end_column: number;
  name: string;
  indexing?: (boolean | string)[];
  previous_indexing_len?: number;
  indirect?: true;
  field: string;
}

/** Warning code 131: an unused implicitly defined global. Created during filtering. */
export interface UnusedGlobalWarning {
  code: 131;
  line: number;
  column: number;
  end_column: number;
  name: string;
  indexing?: (boolean | string)[];
  previous_indexing_len?: number;
  indirect?: true;
}

/** Warning code 142: setting an undefined field of a global variable. Created during filtering. */
export interface SettingUndefinedFieldOfGlobalWarning {
  code: 142;
  line: number;
  column: number;
  end_column: number;
  name: string;
  indexing?: (boolean | string)[];
  previous_indexing_len?: number;
  indirect?: true;
  field: string;
}

/** Warning code 143: accessing an undefined field of a global variable. Created during filtering. */
export interface AccessingUndefinedFieldOfGlobalWarning {
  code: 143;
  line: number;
  column: number;
  end_column: number;
  name: string;
  indexing?: (boolean | string)[];
  previous_indexing_len?: number;
  indirect?: true;
  field: string;
}

/** Warning code 211: an unused local variable or function. */
export interface UnusedLocalWarning {
  code: 211;
  line: number;
  column: number;
  end_column: number;
  name: string;
  secondary?: true;
  func?: true;
  useless?: true;
  recursive?: true;
  mutually_recursive?: true;
}

/** Warning code 212: an unused argument. */
export interface UnusedArgumentWarning {
  code: 212;
  line: number;
  column: number;
  end_column: number;
  name: string;
  self?: true;
}

/** Warning code 213: an unused loop variable. */
export interface UnusedLoopVariableWarning {
  code: 213;
  line: number;
  column: number;
  end_column: number;
  name: string;
}

/** Warning code 214: a variable that has an unused hint but is used. */
export interface UsedVariableWithUnusedHintWarning {
  code: 214;
  line: number;
  column: number;
  end_column: number;
  name: string;
}

/** Warning code 221: a variable that is never set. */
export interface VariableNeverSetWarning {
  code: 221;
  line: number;
  column: number;
  end_column: number;
  name: string;
}

/** Warning code 231: a variable that is never accessed. */
export interface VariableNeverAccessedWarning {
  code: 231;
  line: number;
  column: number;
  end_column: number;
  name: string;
  secondary?: true;
}

/** Warning code 232: an argument that is never accessed. */
export interface ArgumentNeverAccessedWarning {
  code: 232;
  line: number;
  column: number;
  end_column: number;
  name: string;
}

/** Warning code 233: a loop variable that is never accessed. */
export interface LoopVariableNeverAccessedWarning {
  code: 233;
  line: number;
  column: number;
  end_column: number;
  name: string;
}

/** Warning code 241: a variable that is mutated but never accessed. */
export interface VariableMutatedButNeverAccessedWarning {
  code: 241;
  line: number;
  column: number;
  end_column: number;
  name: string;
  secondary?: true;
}

/** Warning code 311: a value assigned to a variable that is never used. */
export interface ValueOfVariableOverwrittenWarning {
  code: 311;
  line: number;
  column: number;
  end_column: number;
  name: string;
  secondary?: true;
  /** Present together with `overwritten_column`/`overwritten_end_column` or not at all. */
  overwritten_line?: number;
  overwritten_column?: number;
  overwritten_end_column?: number;
}

/** Warning code 312: a value of an argument that is never used. */
export interface ValueOfArgumentOverwrittenWarning {
  code: 312;
  line: number;
  column: number;
  end_column: number;
  name: string;
  secondary?: true;
  /** Present together with `overwritten_column`/`overwritten_end_column` or not at all. */
  overwritten_line?: number;
  overwritten_column?: number;
  overwritten_end_column?: number;
}

/** Warning code 313: a value of a loop variable that is never used. */
export interface ValueOfLoopVariableOverwrittenWarning {
  code: 313;
  line: number;
  column: number;
  end_column: number;
  name: string;
  secondary?: true;
  /** Present together with `overwritten_column`/`overwritten_end_column` or not at all. */
  overwritten_line?: number;
  overwritten_column?: number;
  overwritten_end_column?: number;
}

/** Warning code 314: a constant table field overwritten by a later entry in the same constructor. */
export interface UnusedFieldValueWarning {
  code: 314;
  line: number;
  column: number;
  end_column: number;
  field: string;
  index?: true;
  overwritten_line: number;
  overwritten_column: number;
  overwritten_end_column: number;
}

/** Warning code 321: accessing an uninitialized variable. */
export interface AccessingUninitializedVariableWarning {
  code: 321;
  line: number;
  column: number;
  end_column: number;
  name: string;
}

/** Warning code 331: a value that is mutated but never accessed. */
export interface ValueMutatedButNeverAccessedWarning {
  code: 331;
  line: number;
  column: number;
  end_column: number;
  name: string;
  secondary?: true;
}

/** Warning code 341: mutating an uninitialized variable. */
export interface MutatingUninitializedVariableWarning {
  code: 341;
  line: number;
  column: number;
  end_column: number;
  name: string;
}

/** Warning code 411: redefinition of a previously defined variable. */
export interface VariableRedefinedWarning {
  code: 411;
  line: number;
  column: number;
  end_column: number;
  name: string;
  prev_line: number;
  prev_column: number;
  prev_end_column: number;
  self?: true;
}

/** Warning code 412: redefinition of a previously defined argument. */
export interface ArgumentRedefinedWarning {
  code: 412;
  line: number;
  column: number;
  end_column: number;
  name: string;
  prev_line: number;
  prev_column: number;
  prev_end_column: number;
  self?: true;
}

/** Warning code 413: redefinition of a previously defined loop variable. */
export interface LoopVariableRedefinedWarning {
  code: 413;
  line: number;
  column: number;
  end_column: number;
  name: string;
  prev_line: number;
  prev_column: number;
  prev_end_column: number;
  self?: true;
}

/** Warning code 421: shadowing definition of a variable. */
export interface ShadowingVariableWarning {
  code: 421;
  line: number;
  column: number;
  end_column: number;
  name: string;
  prev_line: number;
  prev_column: number;
  prev_end_column: number;
  self?: true;
}

/** Warning code 422: shadowing definition of an argument. */
export interface ShadowingArgumentWarning {
  code: 422;
  line: number;
  column: number;
  end_column: number;
  name: string;
  prev_line: number;
  prev_column: number;
  prev_end_column: number;
  self?: true;
}

/** Warning code 423: shadowing definition of a loop variable. */
export interface ShadowingLoopVariableWarning {
  code: 423;
  line: number;
  column: number;
  end_column: number;
  name: string;
  prev_line: number;
  prev_column: number;
  prev_end_column: number;
  self?: true;
}

/** Warning code 431: shadowing of an upvalue. */
export interface ShadowingUpvalueWarning {
  code: 431;
  line: number;
  column: number;
  end_column: number;
  name: string;
  prev_line: number;
  prev_column: number;
  prev_end_column: number;
  self?: true;
}

/** Warning code 432: shadowing of an upvalue argument. */
export interface ShadowingUpvalueArgumentWarning {
  code: 432;
  line: number;
  column: number;
  end_column: number;
  name: string;
  prev_line: number;
  prev_column: number;
  prev_end_column: number;
  self?: true;
}

/** Warning code 433: shadowing of an upvalue loop variable. */
export interface ShadowingUpvalueLoopVariableWarning {
  code: 433;
  line: number;
  column: number;
  end_column: number;
  name: string;
  prev_line: number;
  prev_column: number;
  prev_end_column: number;
  self?: true;
}

/** Warning code 511: unreachable code. */
export interface UnreachableCodeWarning {
  code: 511;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 512: a loop executed at most once. */
export interface LoopExecutedAtMostOnceWarning {
  code: 512;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 521: an unused label. */
export interface UnusedLabelWarning {
  code: 521;
  line: number;
  column: number;
  end_column: number;
  label: string;
}

/** Warning code 531: right side of an assignment has more values than the left side expects. */
export interface MoreValuesThanExpectedWarning {
  code: 531;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 532: right side of an assignment has fewer values than the left side expects. */
export interface LessValuesThanExpectedWarning {
  code: 532;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 541: an empty `do..end` block. */
export interface EmptyDoBlockWarning {
  code: 541;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 542: an empty if branch. */
export interface EmptyIfBranchWarning {
  code: 542;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 551: an empty statement. */
export interface EmptyStatementWarning {
  code: 551;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 561: a function whose cyclomatic complexity is too high. */
export interface CyclomaticComplexityWarning {
  code: 561;
  line: number;
  column: number;
  end_column: number;
  complexity: number;
  function_type: "main_chunk" | "function" | "method";
  /** Absent for the main chunk and for anonymous nested functions. */
  function_name?: string;
  /** Set during filtering, never by the stages. */
  max_complexity?: number;
}

/** Warning code 571: a numeric for loop going from `#(expr)` down to a non-negative step. */
export interface ReversedFornumLoopWarning {
  code: 571;
  line: number;
  column: number;
  end_column: number;
  limit: string;
}

/** Warning code 581: a negation over a relational operator. */
export interface NegationOverRelationalOperatorWarning {
  code: 581;
  line: number;
  column: number;
  end_column: number;
  operator: string;
  replacement_operator: string;
}

/** Warning code 582: an error prone negation. */
export interface ErrorProneNegationWarning {
  code: 582;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 611: a line that contains only whitespace. */
export interface LineContainsOnlyWhitespaceWarning {
  code: 611;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 612: a line with trailing whitespace. */
export interface TrailingWhitespaceWarning {
  code: 612;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 613: trailing whitespace inside a string literal. */
export interface TrailingWhitespaceInStringWarning {
  code: 613;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 614: trailing whitespace inside a comment. */
export interface TrailingWhitespaceInCommentWarning {
  code: 614;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 621: inconsistent indentation (SPACE followed by TAB). */
export interface InconsistentIndentationWarning {
  code: 621;
  line: number;
  column: number;
  end_column: number;
}

/** Warning code 631: a line that is too long. Created during filtering, never by the stages. */
export interface LineTooLongWarning {
  code: 631;
  line: number;
  column: number;
  end_column: number;
  max_length: number;
  /** Absent on plain code lines. */
  line_ending?: "comment" | "string";
}

/** The union of every warning shape the check pipeline can produce. */
export type Warning =
  | SyntaxErrorWarning
  | InvalidInlineOptionWarning
  | UnpairedPushWarning
  | UnpairedPopWarning
  | CompoundOperatorWarning
  | SettingGlobalWarning
  | MutatingGlobalWarning
  | AccessingGlobalWarning
  | SettingReadOnlyGlobalWarning
  | SettingReadOnlyFieldOfGlobalWarning
  | UnusedGlobalWarning
  | SettingUndefinedFieldOfGlobalWarning
  | AccessingUndefinedFieldOfGlobalWarning
  | UnusedLocalWarning
  | UnusedArgumentWarning
  | UnusedLoopVariableWarning
  | UsedVariableWithUnusedHintWarning
  | VariableNeverSetWarning
  | VariableNeverAccessedWarning
  | ArgumentNeverAccessedWarning
  | LoopVariableNeverAccessedWarning
  | VariableMutatedButNeverAccessedWarning
  | ValueOfVariableOverwrittenWarning
  | ValueOfArgumentOverwrittenWarning
  | ValueOfLoopVariableOverwrittenWarning
  | UnusedFieldValueWarning
  | AccessingUninitializedVariableWarning
  | ValueMutatedButNeverAccessedWarning
  | MutatingUninitializedVariableWarning
  | VariableRedefinedWarning
  | ArgumentRedefinedWarning
  | LoopVariableRedefinedWarning
  | ShadowingVariableWarning
  | ShadowingArgumentWarning
  | ShadowingLoopVariableWarning
  | ShadowingUpvalueWarning
  | ShadowingUpvalueArgumentWarning
  | ShadowingUpvalueLoopVariableWarning
  | UnreachableCodeWarning
  | LoopExecutedAtMostOnceWarning
  | UnusedLabelWarning
  | MoreValuesThanExpectedWarning
  | LessValuesThanExpectedWarning
  | EmptyDoBlockWarning
  | EmptyIfBranchWarning
  | EmptyStatementWarning
  | CyclomaticComplexityWarning
  | ReversedFornumLoopWarning
  | NegationOverRelationalOperatorWarning
  | ErrorProneNegationWarning
  | LineContainsOnlyWhitespaceWarning
  | TrailingWhitespaceWarning
  | TrailingWhitespaceInStringWarning
  | TrailingWhitespaceInCommentWarning
  | InconsistentIndentationWarning
  | LineTooLongWarning;

/** Warning variants that carry a `name` field. */
export type NamedWarning = Extract<Warning, { name: string }>;

/** Maps a warning code to its single variant. */
export type WarningByCode = {
  [C in Warning["code"]]: Extract<Warning, { code: C }>;
};

/** Maps a warning code to its single named variant. */
export type NamedWarningByCode = {
  [C in NamedWarning["code"]]: Extract<NamedWarning, { code: C }>;
};

/** The eight variants derived from global-related stage warnings. */
export type GlobalWarning =
  | SettingGlobalWarning
  | MutatingGlobalWarning
  | AccessingGlobalWarning
  | SettingReadOnlyGlobalWarning
  | SettingReadOnlyFieldOfGlobalWarning
  | UnusedGlobalWarning
  | SettingUndefinedFieldOfGlobalWarning
  | AccessingUndefinedFieldOfGlobalWarning;

/** Returns whether `warning` is one of the eight global-related variants. */
export function isGlobalWarning(warning: Warning): warning is GlobalWarning {
  switch (warning.code) {
    case 111:
    case 112:
    case 113:
    case 121:
    case 122:
    case 131:
    case 142:
    case 143:
      return true;
    default:
      return false;
  }
}

/**
 * The five variants `passesFilter` re-checks for definedness/read-only
 * status: the three base action codes (111/112/113) plus the two
 * undefined-field codes derived from them (142/143). Matches upstream
 * `filter.lua`'s `warning.code:find("^1[14]")` exactly - the other three
 * global-related codes (121/122/131) are excluded on purpose, since by
 * the time a warning carries one of those codes its definedness/read-only
 * status has already been resolved by `filterGlobalRelatedInFile`, and
 * re-running this check against them would incorrectly re-filter them.
 */
export type GlobalFieldStatusWarning =
  | SettingGlobalWarning
  | MutatingGlobalWarning
  | AccessingGlobalWarning
  | SettingUndefinedFieldOfGlobalWarning
  | AccessingUndefinedFieldOfGlobalWarning;

/** Returns whether `warning` is one of the five `GlobalFieldStatusWarning` variants. */
export function isGlobalFieldStatusWarning(
  warning: Warning,
): warning is GlobalFieldStatusWarning {
  switch (warning.code) {
    case 111:
    case 112:
    case 113:
    case 142:
    case 143:
      return true;
    default:
      return false;
  }
}
