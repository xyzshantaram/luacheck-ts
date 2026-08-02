/**
 * Ported from luacheck's options.lua, trimmed per PORT_NOTES.md: no `compat`
 * option, no `max` std preset. The default std is now `lua54`, not `max`.
 *
 * `globals`/`read_globals`/`new_globals`/`new_read_globals` accept a fields
 * table with both an array part (plain names) and named-key entries (per-
 * field overrides). `getFinalStd` walks only the array part when it builds
 * the ordered `overwriteField` calls for globals vs read-only globals; the
 * named-key entries reach the final std separately, through `addStdTable`'s
 * own field-tree merge on the same table. Both parts still end up applied.
 */

import {
  arrayOf,
  hasType,
  hasTypeOrFalse,
  luaType,
  ripairs,
  sortedPairs,
  split,
  strip,
} from "./utils.ts";
import {
  addStdTable,
  type FieldDef,
  type FieldsTable,
  finalize,
  overwriteField,
  removeField,
  type StdTable,
  validateGlobalsTable,
  validateStdTable,
} from "./standards.ts";
import { builtinStandards } from "./builtin_standards.ts";

export type RuleType = "enable" | "disable" | "only";
/** [codePattern, namePattern], either half may be absent. */
export type NormalizedPattern = [string | undefined, string | undefined];
/** [patterns, type], pre-normalization, as produced by `getRules`. */
export type Rule = [patterns: string[], type: RuleType];
/** [patterns, type], post-normalization, as stored in `NormalizedOptions.rules`. */
export type NormalizedRule = [patterns: NormalizedPattern[], type: RuleType];

export interface Options {
  global?: boolean;
  unused?: boolean;
  redefined?: boolean;
  unused_args?: boolean;
  unused_secondaries?: boolean;
  self?: boolean;
  allow_defined?: boolean;
  allow_defined_top?: boolean;
  module?: boolean;
  std?: string | StdTable;
  max_line_length?: number | false;
  max_code_line_length?: number | false;
  max_string_line_length?: number | false;
  max_comment_line_length?: number | false;
  max_cyclomatic_complexity?: number | false;
  operators?: string[];
  globals?: FieldsTable;
  read_globals?: FieldsTable;
  new_globals?: FieldsTable;
  new_read_globals?: FieldsTable;
  not_globals?: string[];
  ignore?: string[];
  enable?: string[];
  only?: string[];
  [key: string]: unknown;
}

export interface NormalizedOptions {
  std: StdTable;
  operators?: string[];
  unused_secondaries: boolean;
  self: boolean;
  module: boolean;
  allow_defined: boolean;
  allow_defined_top: boolean;
  max_cyclomatic_complexity: number | false;
  max_line_length: number | false;
  max_code_line_length: number | false;
  max_string_line_length: number | false;
  max_comment_line_length: number | false;
  rules: NormalizedRule[];
}

type Validator = (
  x: unknown,
  stds?: Record<string, StdTable>,
) => [boolean, string?];

const boolean = hasType("boolean");
const numberOrFalse = hasTypeOrFalse("number");
const arrayOfStrings = arrayOf("string");

interface SplitStdResult {
  parts: string[];
  add: boolean;
}

/**
 * Validates a std string. Returns an array of std names, with `add` true if
 * the string starts with `+`. On error, returns `undefined` and a message.
 */
function splitStd(
  std: string,
  stds: Record<string, StdTable>,
): [SplitStdResult, undefined] | [undefined, string] {
  const parts = split(std, "+");
  let add = false;

  if (/^\s*$/.test(parts[0])) {
    add = true;
    parts.shift();
  }

  for (let i = 0; i < parts.length; i++) {
    parts[i] = strip(parts[i]);

    if (!stds[parts[i]]) {
      return [undefined, `unknown std '${parts[i]}'`];
    }
  }

  return [{ parts, add }, undefined];
}

function stdOrArrayOfStrings(
  x: unknown,
  stds?: Record<string, StdTable>,
): [boolean, string?] {
  if (typeof x === "string") {
    const [ok, err] = splitStd(x, stds ?? builtinStandards);
    return [!!ok, err];
  } else if (luaType(x) === "table") {
    return validateStdTable(x as StdTable);
  } else {
    return [false, `string or table expected, got ${luaType(x)}`];
  }
}

function fieldMap(x: unknown): [boolean, string?] {
  if (luaType(x) === "table") {
    return validateGlobalsTable(x as FieldsTable);
  } else {
    return [false, `table expected, got ${luaType(x)}`];
  }
}

export const nullaryInlineOptions: Record<string, Validator> = {
  global: boolean,
  unused: boolean,
  redefined: boolean,
  unused_args: boolean,
  unused_secondaries: boolean,
  self: boolean,
  allow_defined: boolean,
  allow_defined_top: boolean,
  module: boolean,
};

export const variadicInlineOptions: Record<string, Validator> = {
  globals: fieldMap,
  read_globals: fieldMap,
  new_globals: fieldMap,
  new_read_globals: fieldMap,
  not_globals: arrayOfStrings,
  ignore: arrayOfStrings,
  enable: arrayOfStrings,
  only: arrayOfStrings,
};

export const allOptions: Record<string, Validator> = {
  std: stdOrArrayOfStrings,
  max_line_length: numberOrFalse,
  max_code_line_length: numberOrFalse,
  max_string_line_length: numberOrFalse,
  max_comment_line_length: numberOrFalse,
  max_cyclomatic_complexity: numberOrFalse,
  operators: arrayOfStrings,
  ...nullaryInlineOptions,
  ...variadicInlineOptions,
};

/** Returns true if `opts` is a valid `optionSet` or is `undefined`/`null`, else false and an error message. */
export function validate(
  optionSet: Record<string, Validator>,
  opts?: Options | null,
  stds?: Record<string, StdTable>,
): [boolean, string?] {
  if (opts === null || opts === undefined) {
    return [true];
  }

  if (luaType(opts) !== "table") {
    return [false, `option table expected, got ${luaType(opts)}`];
  }

  const resolvedStds = stds ?? builtinStandards;

  for (const [option, validator] of sortedPairs(optionSet)) {
    if (opts[option] !== undefined) {
      const [ok, err] = validator(opts[option], resolvedStds);

      if (!ok) {
        return [false, `invalid value of option '${option}': ${err}`];
      }
    }
  }

  return [true];
}

// Option stack is an array of options with options closer to the end
// overriding options closer to the beginning.

/** Extracts the sequence of active std tables from an option stack. */
function getStdTables(
  optsStack: Options[],
  stds: Record<string, StdTable>,
): StdTable[] {
  let baseStd: StdTable | undefined;
  const addStds: StdTable[] = [];

  for (const [, opts] of ripairs(optsStack)) {
    if (opts.std) {
      if (typeof opts.std === "object") {
        baseStd = opts.std;
        break;
      } else {
        const [parts] = splitStd(opts.std, stds);

        for (const part of parts!.parts) {
          addStds.push(stds[part]);
        }

        if (!parts!.add) {
          baseStd = {};
          break;
        }
      }
    }
  }

  addStds.unshift(baseStd ?? stds.lua54);
  return addStds;
}

/** Returns the index of the last option table in a stack that uses the given option, or 0 if none does. */
function indexOfLastOptionUsage(
  optsStack: Options[],
  optionName: string,
): number {
  for (const [index, opts] of ripairs(optsStack)) {
    if (opts[optionName]) {
      return index;
    }
  }

  return 0;
}

function splitField(fieldName: string): string[] {
  return split(fieldName, "%.");
}

function fieldComparator(
  field1: [string[], boolean],
  field2: [string[], boolean],
): number {
  const parts1 = field1[0];
  const parts2 = field2[0];

  const maxLen = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLen; i++) {
    const part1 = parts1[i];
    const part2 = parts2[i];

    if (part1 === undefined) {
      return -1;
    } else if (part2 === undefined) {
      return 1;
    }

    if (part1 !== part2) {
      return part1 < part2 ? -1 : 1;
    }
  }

  return 0;
}

/** Walks the array part (1-based, `ipairs` semantics) of a fields table, returning only its string entries. */
function arrayPartStrings(table: FieldsTable | undefined): string[] {
  if (!table) {
    return [];
  }

  const result: string[] = [];

  for (let i = 1;; i++) {
    const value = table[String(i)];

    if (value === undefined) {
      break;
    }

    if (typeof value === "string") {
      result.push(value);
    }
  }

  return result;
}

/**
 * Combines all stds and global-related options into one final definition
 * table. A definition table may have fields `read_only` (boolean),
 * `other_fields` (boolean), and `fields` (maps field names to definition
 * tables). The std table format is similar, except at the top level there
 * are two fields, `globals` and `read_globals`, mapping to top-level field
 * tables. Also in field tables it's possible to use field names in the
 * array part as a shortcut: `{fields: {"foo"}}` is equivalent to
 * `{fields: {foo: {}}}` or `{fields: {foo: {other_fields: true}}}` in
 * top-level fields tables.
 */
function getFinalStd(
  optsStack: Options[],
  stds: Record<string, StdTable>,
): FieldDef {
  const finalStd: FieldDef = {};
  const stdTables = getStdTables(optsStack, stds);

  for (const stdTable of stdTables) {
    addStdTable(finalStd, stdTable);
  }

  const lastNewGlobals = indexOfLastOptionUsage(optsStack, "new_globals");
  const lastNewReadGlobals = indexOfLastOptionUsage(
    optsStack,
    "new_read_globals",
  );

  optsStack.forEach((opts, i) => {
    const index = i + 1;
    const globals = index >= lastNewGlobals
      ? (opts.new_globals ?? opts.globals)
      : undefined;
    const readGlobals = index >= lastNewReadGlobals
      ? (opts.new_read_globals ?? opts.read_globals)
      : undefined;

    const newFields: [string[], boolean][] = [];

    if (globals) {
      for (const global of arrayPartStrings(globals)) {
        newFields.push([splitField(global), false]);
      }
    }

    if (readGlobals) {
      for (const readGlobal of arrayPartStrings(readGlobals)) {
        newFields.push([splitField(readGlobal), true]);
      }
    }

    if (globals && readGlobals) {
      // If there are both globals and read-only globals defined in one
      // options table, more general definitions must be applied first, or
      // they will overwrite more specific ones. E.g. `globals x` must be
      // applied before `read globals x.y`.
      newFields.sort(fieldComparator);
    }

    for (const field of newFields) {
      overwriteField(finalStd, field[0], field[1]);
    }

    addStdTable(finalStd, { globals, read_globals: readGlobals }, true, true);

    if (opts.not_globals) {
      for (const notGlobal of opts.not_globals) {
        removeField(finalStd, splitField(notGlobal));
      }
    }
  });

  finalize(finalStd);
  return finalStd;
}

function getScalarOpt<T>(
  optsStack: Options[],
  option: string,
  defaultValue: T,
): T {
  for (const [, opts] of ripairs(optsStack)) {
    if (opts[option] !== undefined) {
      return opts[option] as T;
    }
  }

  return defaultValue;
}

const lineLengthSuboptions = [
  "max_code_line_length",
  "max_string_line_length",
  "max_comment_line_length",
] as const;

interface MaxLineOpts {
  max_line_length: number | false;
  max_code_line_length: number | false;
  max_string_line_length: number | false;
  max_comment_line_length: number | false;
}

function getMaxLineOpts(optsStack: Options[]): MaxLineOpts {
  const res: MaxLineOpts = {
    max_line_length: 120,
    max_code_line_length: 120,
    max_string_line_length: 120,
    max_comment_line_length: 120,
  };

  for (const opts of optsStack) {
    if (opts.max_line_length !== undefined) {
      res.max_line_length = opts.max_line_length;

      for (const optName of lineLengthSuboptions) {
        res[optName] = opts.max_line_length;
      }
    }

    for (const optName of lineLengthSuboptions) {
      if (opts[optName] !== undefined) {
        res[optName] = opts[optName] as number | false;
      }
    }
  }

  return res;
}

function anchorPattern(
  pattern: string | undefined,
  onlyStart?: boolean,
): string | undefined {
  if (!pattern) {
    return undefined;
  }

  if (pattern[0] === "^" || pattern[pattern.length - 1] === "$") {
    return pattern;
  } else {
    return "^" + pattern + (onlyStart ? "" : "$");
  }
}

/**
 * Returns a pair of normalized patterns for code and name. `pattern` can be:
 * a string containing `/` (first part matches the warning code, second the
 * variable name), a string containing letters (matches the variable name),
 * or otherwise a string matching the warning code. Unless anchored by the
 * user, the name pattern is anchored on both sides and the code pattern is
 * anchored only at the beginning.
 */
function normalizePattern(pattern: string): NormalizedPattern {
  let codePattern: string | undefined;
  let namePattern: string | undefined;
  const slashPos = pattern.indexOf("/");

  if (slashPos !== -1) {
    codePattern = pattern.slice(0, slashPos);
    namePattern = pattern.slice(slashPos + 1);
  } else if (/[_a-zA-Z]/.test(pattern)) {
    namePattern = pattern;
  } else {
    codePattern = pattern;
  }

  return [anchorPattern(codePattern, true), anchorPattern(namePattern)];
}

// From most specific to least specific, pairs of {option, pattern}.
// Applying macros in order is required to get deterministic results and
// sensible results when intersecting macros are used. E.g.
// unused = false, unused_args = true should leave unused args enabled.
const macros: [option: string, pattern: string][] = [
  ["unused_args", "21[23]"],
  ["global", "1"],
  ["unused", "[23]"],
  ["redefined", "4"],
];

/** Returns the array of rules that should be applied, in order. */
function getRules(optsStack: Options[]): Rule[] {
  const rules: Rule[] = [];
  const usedMacros: Record<string, boolean> = {};

  for (const [, opts] of ripairs(optsStack)) {
    for (const [option, pattern] of macros) {
      if (!usedMacros[option]) {
        if (opts[option] !== undefined) {
          rules.push([[pattern], opts[option] ? "enable" : "disable"]);
          usedMacros[option] = true;
        }
      }
    }

    if (opts.ignore) {
      rules.push([opts.ignore, "disable"]);
    }

    if (opts.only) {
      rules.push([opts.only, "only"]);
    }

    if (opts.enable) {
      rules.push([opts.enable, "enable"]);
    }
  }

  return rules;
}

function normalizePatterns(rules: Rule[]): NormalizedRule[] {
  return rules.map((
    [patterns, type],
  ): NormalizedRule => [patterns.map(normalizePattern), type]);
}

function getOperators(optsStack: Options[]): string[] | undefined {
  let operators: string[] | undefined;
  let operatorsMap: Record<string, boolean> | undefined;

  for (const opts of optsStack) {
    if (opts.operators) {
      operators = operators ?? [];
      operatorsMap = operatorsMap ?? {};

      for (const op of opts.operators) {
        if (!operatorsMap[op]) {
          operators.push(op);
          operatorsMap[op] = true;
        }
      }
    }
  }

  return operators;
}

const scalarOptions: {
  unused_secondaries: boolean;
  self: boolean;
  module: boolean;
  allow_defined: boolean;
  allow_defined_top: boolean;
  max_cyclomatic_complexity: number | false;
} = {
  unused_secondaries: true,
  self: true,
  module: false,
  allow_defined: false,
  allow_defined_top: false,
  max_cyclomatic_complexity: false,
};

/**
 * Returns normalized options. Normalized options have fields: `std`
 * (normalized std table, see `standards.ts`); `unused_secondaries`, `self`,
 * `module`, `allow_defined`, `allow_defined_top` (booleans);
 * `max_line_length` and friends (number or false); `rules` (see
 * `getRules`).
 */
export function normalize(
  optsStack: Options[],
  stds?: Record<string, StdTable>,
): NormalizedOptions {
  const resolvedStds = stds ?? builtinStandards;
  const maxLineOpts = getMaxLineOpts(optsStack);

  return {
    std: getFinalStd(optsStack, resolvedStds) as StdTable,
    operators: getOperators(optsStack),
    unused_secondaries: getScalarOpt(
      optsStack,
      "unused_secondaries",
      scalarOptions.unused_secondaries,
    ),
    self: getScalarOpt(optsStack, "self", scalarOptions.self),
    module: getScalarOpt(optsStack, "module", scalarOptions.module),
    allow_defined: getScalarOpt(
      optsStack,
      "allow_defined",
      scalarOptions.allow_defined,
    ),
    allow_defined_top: getScalarOpt(
      optsStack,
      "allow_defined_top",
      scalarOptions.allow_defined_top,
    ),
    max_cyclomatic_complexity: getScalarOpt(
      optsStack,
      "max_cyclomatic_complexity",
      scalarOptions.max_cyclomatic_complexity,
    ),
    ...maxLineOpts,
    rules: normalizePatterns(getRules(optsStack)),
  };
}
