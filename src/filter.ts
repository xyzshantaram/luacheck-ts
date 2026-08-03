/**
 * Ported from luacheck's filter.lua: applies user options to raw check
 * results, turning `stages/*.lua`-produced warnings into the final,
 * filtered, sorted report. Two independent halves, run in sequence: rules
 * (`--ignore`/`--enable`/`--only`), line-length, and other non-global
 * filtering first; then cross-file implicit-global resolution.
 *
 * The `.fatal` result shape (from `check_files`'s I/O-error passthrough)
 * is dropped: `checkFiles` is out of scope for this port (see
 * `check.ts`/`PORT_NOTES.md`), so nothing can ever construct a `.fatal`
 * check result here.
 *
 * `Warning.code` is a plain number in this port (see `check.ts`), while
 * `filter.lua` treats it as a zero-padded 3-digit string throughout for
 * pattern matching and string-prefix code-family checks. Every function
 * below that needs to pattern-match a code pads it via `codeKey` first,
 * and converts back to a number before writing a new code onto a warning.
 *
 * Unlike `filter.lua`, which stores `.filtered_warnings`/`.normalized_options`
 * as extra dynamic fields bolted onto each check result table, this port
 * threads them through as explicit parallel state (one `FileFilterState`
 * per check result) instead of widening `CheckResult`'s own type - the
 * same computation, without the "some `CheckResult`s have extra fields"
 * ambiguity that would create.
 */

import { sortByLocation } from "./core_utils.ts";
import { decode } from "./decoder.ts";
import type { InlineOptionsEntry, Warning } from "./check_state.ts";
import type { CheckResult } from "./check.ts";
import {
  allOptions,
  normalize,
  type NormalizedOptions,
  type NormalizedPattern,
  type NormalizedRule,
  type Options,
  validate,
} from "./options.ts";
import { type FieldDef, isArrayIndexKey, type StdTable } from "./standards.ts";
import { pmatch } from "./utils.ts";

function codeKey(code: number): string {
  return String(code).padStart(3, "0");
}

/**
 * Drops keys whose value is `undefined`, so an omitted-in-Lua field doesn't
 * turn into a real, enumerable `undefined`-valued key in JS (see
 * `linearize.ts`'s own copy of this same helper for the bug this avoids;
 * `filter.ts` needs it for `updateOptionStackForNewLine`'s invalid-inline-
 * option warning, whose `end_column` isn't always present).
 */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};

  for (const key of Object.keys(obj)) {
    const value = obj[key];

    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}

/** Returns whether a warning matches `pattern` by code and by name. */
function match(
  pattern: NormalizedPattern,
  code: string,
  name: string | undefined,
): [matchesCode: boolean | undefined, matchesName: boolean | undefined] {
  let matchesCode: boolean | undefined;
  let matchesName: boolean | undefined;
  const [codePattern, namePattern] = pattern;

  if (codePattern) {
    matchesCode = pmatch(code, codePattern);
  }

  if (namePattern) {
    if (name === undefined) {
      // Warnings without a name field can't match by name.
      matchesName = false;
    } else {
      matchesName = pmatch(name, namePattern);
    }
  }

  return [matchesCode, matchesName];
}

function passesRulesFilter(
  rules: NormalizedRule[],
  code: string,
  name: string | undefined,
): boolean {
  // A warning is enabled when its code and name are enabled.
  let enabledCode = false;
  let enabledName = false;

  for (const [patterns, type] of rules) {
    let matchesOne = false;

    for (const pattern of patterns) {
      let [matchesCode, matchesName] = match(pattern, code, name);

      // If a factor is enabled, warning can't be disabled by it.
      if (enabledCode) {
        matchesCode = type !== "disable";
      }

      if (enabledName) {
        matchesCode = type !== "disable";
      }

      if (
        (matchesCode && matchesName !== false) ||
        (matchesName && matchesCode !== false)
      ) {
        matchesOne = true;
      }

      if (type === "enable") {
        if (matchesCode) {
          enabledCode = true;
        }

        if (matchesName) {
          enabledName = true;
        }

        if (enabledCode && enabledName) {
          // Enabled as matching to some `enable` pattern by code and to another by name.
          return true;
        }
      } else if (type === "disable") {
        if (matchesOne) {
          // Disabled as matching to a `disable` pattern.
          return false;
        }
      }
    }

    if (type === "only" && !matchesOne) {
      // Disabled as not matching to any of the `only` patterns.
      return false;
    }
  }

  // Enabled by default.
  return true;
}

function getFieldString(warning: Warning): string {
  const parts: string[] = [];
  const indexing = warning.indexing as (boolean | string)[] | undefined;

  if (indexing) {
    for (const index of indexing) {
      if (typeof index === "string") {
        const chars = decode(index);
        parts.push(chars.getPrintableSubstring(1, chars.getLength()));
      } else {
        parts.push("?");
      }
    }
  }

  return parts.join(".");
}

function getFieldStatus(
  normalizedOptions: NormalizedOptions,
  warning: Warning,
  depth?: number,
): "read_only" | "global" | "undefined" {
  let def = normalizedOptions.std;
  let defined = true;
  let readOnly = true;
  const indexing = warning.indexing as (boolean | string)[] | undefined;
  const limit = depth ?? (indexing ? indexing.length : 0) + 1;

  for (let i = 1; i <= limit; i++) {
    const indexString: boolean | string = i === 1
      ? (warning.name as string)
      : indexing![i - 2];

    if (indexString === true) {
      // Indexing with something that may or may not be a string.
      if (
        (def.fields && Object.keys(def.fields).length > 0) || def.other_fields
      ) {
        readOnly = Boolean(def.deep_read_only);
      } else {
        defined = false;
      }

      break;
    } else if (indexString === false) {
      // Indexing with not a string.
      if (!def.other_fields) {
        defined = false;
      }

      break;
    } else {
      // Indexing with a constant string.
      if (def.fields && def.fields[indexString] !== undefined) {
        // The field is defined, recurse into it.
        def = def.fields[indexString] as FieldDef;

        if (def.read_only !== undefined) {
          readOnly = def.read_only;
        }
      } else {
        // The field is not defined, but it may be okay to index if `other_fields` is true.
        if (!def.other_fields) {
          defined = false;
        }

        break;
      }
    }
  }

  return defined ? (readOnly ? "read_only" : "global") : "undefined";
}

/** Checks if a warning passes the options filter. May add fields required for formatting. */
function passesFilter(
  normalizedOptions: NormalizedOptions,
  warning: Warning,
): boolean {
  const code = codeKey(warning.code);

  if (code === "561") {
    const maxComplexity = normalizedOptions.max_cyclomatic_complexity;

    if (!maxComplexity || (warning.complexity as number) <= maxComplexity) {
      return false;
    }

    warning.max_complexity = maxComplexity;
  } else if (code === "033") {
    const operators = normalizedOptions.operators ?? [];

    for (const op of operators) {
      if (warning.operator === op) {
        return false;
      }
    }

    return true;
  } else if (/^[234]/.test(code) && warning.name === "_" && !warning.useless) {
    return false;
  } else if (/^1[14]/.test(code)) {
    if (
      warning.indirect &&
      getFieldStatus(
          normalizedOptions,
          warning,
          warning.previous_indexing_len as number | undefined,
        ) === "undefined"
    ) {
      return false;
    }

    if (
      !warning.module &&
      getFieldStatus(normalizedOptions, warning) !== "undefined"
    ) {
      return false;
    }
  }

  if (/^1[24][23]/.test(code)) {
    warning.field = getFieldString(warning);
  }

  if (warning.secondary && !normalizedOptions.unused_secondaries) {
    return false;
  }

  if (warning.self && !normalizedOptions.self) {
    return false;
  }

  return passesRulesFilter(normalizedOptions.rules, code, warning.name);
}

const emptyOptions: Options = {};

/**
 * Pops `inlineOption.pop_count` layers off `optionStack`, then pushes the
 * next layer for `line` if `inlineOption` carries one. Invalid inline
 * options are converted into a 021 warning pushed onto `filteredWarnings`
 * (an `empty_options` sentinel is pushed onto the stack in their place, to
 * keep pop counts correct while keeping normalized-option cache identity
 * stable). Returns the updated index into `inlineOptions`.
 */
function updateOptionStackForNewLine(
  inlineOptions: InlineOptionsEntry[],
  filteredWarnings: Warning[],
  stds: Record<string, StdTable> | undefined,
  optionStack: Options[],
  line: number,
  nextIndex: number,
): number {
  const inlineOption = inlineOptions[nextIndex];

  if (!inlineOption || inlineOption.line > line) {
    // No inline options on this line, option stack for the line is ready.
    return nextIndex;
  }

  nextIndex++;

  if (inlineOption.pop_count) {
    for (let i = 0; i < inlineOption.pop_count; i++) {
      optionStack.pop();
    }
  }

  if (!inlineOption.options) {
    // No inline option push on this line, option stack for the line is ready.
    return nextIndex;
  }

  const [optionsOk, errMsg] = validate(allOptions, inlineOption.options, stds);

  if (!optionsOk) {
    filteredWarnings.push(compact({
      code: 21,
      line: inlineOption.line,
      column: inlineOption.column,
      end_column: inlineOption.end_column,
      msg: errMsg,
    }) as Warning);
    optionStack.push(emptyOptions);
  } else {
    optionStack.push(inlineOption.options);
  }

  return nextIndex;
}

/** Warns about a too-long line, unless the warning is filtered out by options. */
function checkLineLength(
  filteredWarnings: Warning[],
  checkResult: CheckResult,
  normalizedOptions: NormalizedOptions,
  line: number,
): void {
  const lineLength = checkResult.line_lengths[line];
  const lineType = checkResult.line_endings[line];
  const maxLength = lineType === "comment"
    ? normalizedOptions.max_comment_line_length
    : lineType === "string"
    ? normalizedOptions.max_string_line_length
    : normalizedOptions.max_code_line_length;

  if (maxLength && lineLength > maxLength) {
    if (passesRulesFilter(normalizedOptions.rules, "631", undefined)) {
      filteredWarnings.push(compact({
        code: 631,
        line,
        column: maxLength + 1,
        end_column: lineLength,
        max_length: maxLength,
        line_ending: lineType,
      }) as Warning);
    }
  }
}

/**
 * Appends warnings passing filtering and not related to globals onto
 * `filteredWarnings`. If there is a global-related warning on this line,
 * records `normalizedOptions` for it in `normalizedOptionsByLine`.
 */
function filterWarningsOnNewLine(
  warnings: Warning[],
  filteredWarnings: Warning[],
  normalizedOptionsByLine: Map<number, NormalizedOptions>,
  normalizedOptions: NormalizedOptions,
  line: number,
  nextIndex: number,
): number {
  while (true) {
    const warning = warnings[nextIndex];

    if (!warning || warning.line > line) {
      // No more warnings on this line.
      break;
    }

    if (codeKey(warning.code).startsWith("1")) {
      normalizedOptionsByLine.set(line, normalizedOptions);
    } else if (passesFilter(normalizedOptions, warning)) {
      filteredWarnings.push(warning);
    }

    nextIndex++;
  }

  return nextIndex;
}

interface TrieNode {
  result?: NormalizedOptions;
  next: Map<Options, TrieNode>;
}

/**
 * Normalizing options is relatively expensive because full std definitions
 * are quite large. Caches `normalize`'s results, keyed by identity of the
 * option tables in the stack (a `Map`-based trie, since JS objects can't
 * be used as plain-object keys by identity the way Lua tables can).
 *
 * Takes `(optionStack, stds)`, matching `normalize`'s own parameter order
 * - `filter.lua`'s equivalent method takes `(stds, option_stack)`, the
 * opposite order from its own call to `options.normalize`; this class is
 * internal-only, so there is no faithfulness reason to keep that mismatch.
 */
class CachingOptionsNormalizer {
  #root: TrieNode = { next: new Map() };

  normalizeOptions(
    optionStack: Options[],
    stds: Record<string, StdTable> | undefined,
  ): NormalizedOptions {
    let node = this.#root;

    for (const optionTable of optionStack) {
      let next = node.next.get(optionTable);

      if (!next) {
        next = { next: new Map() };
        node.next.set(optionTable, next);
      }

      node = next;
    }

    if (node.result) {
      return node.result;
    }

    const result = normalize(optionStack, stds);
    node.result = result;
    return result;
  }
}

/** True if `optsTable` has any real option settings of its own, not just array-part entries. */
function mayHaveOptions(optsTable: Options): boolean {
  for (const key of Object.keys(optsTable)) {
    if (!isArrayIndexKey(key)) {
      return true;
    }
  }

  return false;
}

/** May mutate `opts`. Builds the base option stack for `check_results[fileIndex]` (1-based). */
function getOptionStack(
  opts: Options | undefined,
  fileIndex: number,
): Options[] {
  const res: Options[] = opts ? [opts] : [];

  if (opts) {
    const fileOpts = opts[String(fileIndex)] as Options | undefined;

    if (fileOpts) {
      // Don't add useless per-file option tables, that messes up normalized option caching
      // since it memorizes based on option table identities.
      if (mayHaveOptions(fileOpts)) {
        res.push(fileOpts);
      }

      for (let i = 1;; i++) {
        const nestedOpts = fileOpts[String(i)] as Options | undefined;

        if (nestedOpts === undefined) {
          break;
        }

        res.push(nestedOpts);
      }
    }
  }

  return res;
}

interface FileFilterState {
  filteredWarnings: Warning[];
  normalizedOptionsByLine: Map<number, NormalizedOptions>;
}

/**
 * Stores invalid inline options, not-filtered-out not-global-related
 * warnings, and newly created line-length warnings in `filteredWarnings`.
 * Stores a map from line numbers to normalized options, for lines of
 * global-related warnings, in `normalizedOptionsByLine`.
 */
function filterNotGlobalRelatedInFile(
  checkResult: CheckResult,
  optionsNormalizer: CachingOptionsNormalizer,
  stds: Record<string, StdTable> | undefined,
  optionStack: Options[],
): FileFilterState {
  const filteredWarnings: Warning[] = [];
  const normalizedOptionsByLine = new Map<number, NormalizedOptions>();

  // `line_lengths` is a 1-based array (index 0 unused), so `.length` is numberOfLines + 1.
  const numLines = checkResult.line_lengths.length - 1;
  let nextWarningIndex = 0;
  let nextInlineOptionIndex = 0;

  // Iterate over lines, warnings, and inline options at the same time, keeping the option stack up to date.
  for (let line = 1; line <= numLines; line++) {
    nextInlineOptionIndex = updateOptionStackForNewLine(
      checkResult.inline_options,
      filteredWarnings,
      stds,
      optionStack,
      line,
      nextInlineOptionIndex,
    );

    const normalizedOptions = optionsNormalizer.normalizeOptions(
      optionStack,
      stds,
    );
    checkLineLength(filteredWarnings, checkResult, normalizedOptions, line);
    nextWarningIndex = filterWarningsOnNewLine(
      checkResult.warnings,
      filteredWarnings,
      normalizedOptionsByLine,
      normalizedOptions,
      line,
      nextWarningIndex,
    );
  }

  return { filteredWarnings, normalizedOptionsByLine };
}

function filterNotGlobalRelated(
  checkResults: CheckResult[],
  opts: Options | undefined,
  stds: Record<string, StdTable> | undefined,
): FileFilterState[] {
  const optionsNormalizer = new CachingOptionsNormalizer();

  return checkResults.map((checkResult, index) => {
    const fileIndex = index + 1;

    if (checkResult.warnings[0]?.code === 11) {
      // Special case syntax errors, they don't have line numbers so normal filtering does not work.
      return {
        filteredWarnings: checkResult.warnings,
        normalizedOptionsByLine: new Map(),
      };
    }

    return filterNotGlobalRelatedInFile(
      checkResult,
      optionsNormalizer,
      stds,
      getOptionStack(opts, fileIndex),
    );
  });
}

// A global is implicitly defined in a file if opts.allow_defined == true and it is set anywhere in the file,
//    or opts.allow_defined_top == true and it is set in the top level function scope.
// By default, accessing and setting globals in a file is allowed for explicitly defined globals (standard and custom)
//    for that file and implicitly defined globals from that file and
//    all other files except modules (files with opts.module == true).
// Accessing other globals results in "accessing undefined variable" warning.
// Setting other globals results in "setting non-standard global variable" warning.
// Unused implicitly defined global results in "unused global variable" warning.
// For modules, accessing globals uses same rules as normal files, however,
//    setting globals is only allowed for implicitly defined globals from the module.
// Setting a global not defined in the module results in "setting non-module global variable" warning.

function isDefinition(
  normalizedOptions: NormalizedOptions,
  warning: Warning,
): boolean {
  return normalizedOptions.allow_defined ||
    (normalizedOptions.allow_defined_top && Boolean(warning.top));
}

/** Extracts sets of defined, exported and used implicit globals from a file's check result. */
function getImplicitGlobalsInFile(
  checkResult: CheckResult,
  normalizedOptionsByLine: Map<number, NormalizedOptions>,
): { defined: Set<string>; exported: Set<string>; used: Set<string> } {
  const defined = new Set<string>();
  const exported = new Set<string>();
  const used = new Set<string>();

  for (const warning of checkResult.warnings) {
    const code = codeKey(warning.code);

    if (!code.startsWith("11")) {
      continue;
    }

    if (code === "111") {
      const normalizedOptions = normalizedOptionsByLine.get(warning.line)!;

      if (isDefinition(normalizedOptions, warning)) {
        if (normalizedOptions.module) {
          defined.add(warning.name!);
        } else {
          exported.add(warning.name!);
        }
      }
    } else {
      used.add(warning.name!);
    }
  }

  return { defined, exported, used };
}

/**
 * Returns the set of globals defined across all files except modules, the set of globals used
 * across all files, and an array of sets of globals defined per file, parallel to `checkResults`.
 */
function getImplicitGlobals(
  checkResults: CheckResult[],
  normalizedOptionsByLinePerFile: Map<number, NormalizedOptions>[],
): {
  globallyDefined: Set<string>;
  globallyUsed: Set<string>;
  locallyDefined: Set<string>[];
} {
  const globallyDefined = new Set<string>();
  const globallyUsed = new Set<string>();
  const locallyDefined: Set<string>[] = [];

  checkResults.forEach((checkResult, index) => {
    const { defined, exported, used } = getImplicitGlobalsInFile(
      checkResult,
      normalizedOptionsByLinePerFile[index],
    );

    for (const name of exported) globallyDefined.add(name);
    for (const name of used) globallyUsed.add(name);
    locallyDefined[index] = defined;
  });

  return { globallyDefined, globallyUsed, locallyDefined };
}

/** Mutates the warning and returns it, or discards it by returning `undefined` if it's filtered out. */
function applyImplicitDefinitions(
  globallyDefined: Set<string>,
  globallyUsed: Set<string>,
  locallyDefined: Set<string>,
  normalizedOptions: NormalizedOptions,
  warning: Warning,
): Warning | undefined {
  const code = codeKey(warning.code);

  if (!code.startsWith("11")) {
    return warning;
  }

  if (code === "111") {
    if (normalizedOptions.module) {
      if (locallyDefined.has(warning.name!)) {
        return undefined;
      }

      warning.module = true;
    } else {
      if (isDefinition(normalizedOptions, warning)) {
        if (globallyUsed.has(warning.name!)) {
          return undefined;
        }

        warning.code = 131;
        delete warning.top;
      } else {
        if (globallyDefined.has(warning.name!)) {
          return undefined;
        }
      }
    }
  } else {
    if (
      globallyDefined.has(warning.name!) || locallyDefined.has(warning.name!)
    ) {
      return undefined;
    }
  }

  return warning;
}

function filterGlobalRelatedInFile(
  filteredWarnings: Warning[],
  checkResult: CheckResult,
  normalizedOptionsByLine: Map<number, NormalizedOptions>,
  globallyDefined: Set<string>,
  globallyUsed: Set<string>,
  locallyDefined: Set<string>,
): void {
  for (const original of checkResult.warnings) {
    if (!codeKey(original.code).startsWith("1")) {
      continue;
    }

    const normalizedOptions = normalizedOptionsByLine.get(original.line)!;
    const warning = applyImplicitDefinitions(
      globallyDefined,
      globallyUsed,
      locallyDefined,
      normalizedOptions,
      original,
    );

    if (!warning) {
      continue;
    }

    const code = codeKey(warning.code);

    if (
      /^11[12]/.test(code) && !warning.module &&
      getFieldStatus(normalizedOptions, warning) === "read_only"
    ) {
      warning.code = Number("12" + code[2]);
    } else if (
      /^11[23]/.test(code) &&
      getFieldStatus(normalizedOptions, warning, 1) !== "undefined"
    ) {
      warning.code = Number("14" + code[2]);
    }

    // Upstream `filter.lua` repeats this exact check (unanchored, "11[23]" instead of "^11[23]")
    // right after the if/elseif above. Since every code here is a fixed 3-character string, an
    // unanchored 3-character pattern match is equivalent to an anchored one, and by this point
    // the code has already been changed away from the "11[23]" shape whenever the elseif above
    // fired - so this second check can now only re-evaluate a condition already known to be
    // false. Ported as-is (mirrors upstream, including its redundancy) rather than dropped.
    const codeAfterFirstPass = codeKey(warning.code);

    if (
      /11[23]/.test(codeAfterFirstPass) &&
      getFieldStatus(normalizedOptions, warning, 1) !== "undefined"
    ) {
      warning.code = Number("14" + codeAfterFirstPass[2]);
    }

    if (passesFilter(normalizedOptions, warning)) {
      filteredWarnings.push(warning);
    }
  }
}

function filterGlobalRelated(
  checkResults: CheckResult[],
  perFile: FileFilterState[],
): void {
  const { globallyDefined, globallyUsed, locallyDefined } = getImplicitGlobals(
    checkResults,
    perFile.map((f) => f.normalizedOptionsByLine),
  );

  checkResults.forEach((checkResult, index) => {
    filterGlobalRelatedInFile(
      perFile[index].filteredWarnings,
      checkResult,
      perFile[index].normalizedOptionsByLine,
      globallyDefined,
      globallyUsed,
      locallyDefined[index],
    );
  });
}

/**
 * Processes an array of check-stage results into the final report: one
 * filtered, location-sorted array of warnings per input check result.
 * `opts["1"]`, `opts["2"]`, ... (if present) are used as options when
 * processing `checkResults[0]`, `checkResults[1]`, ... together with
 * options in their own array parts.
 */
export function filter(
  checkResults: CheckResult[],
  opts?: Options,
  stds?: Record<string, StdTable>,
): Warning[][] {
  const perFile = filterNotGlobalRelated(checkResults, opts, stds);
  filterGlobalRelated(checkResults, perFile);

  return perFile.map(({ filteredWarnings }) => {
    sortByLocation(filteredWarnings);
    return filteredWarnings;
  });
}
