/**
 * Ported from luacheck's stages/parse_inline_options.lua: parses
 * `-- luacheck: ...` inline option comments into `chstate.inlineOptions`, an
 * array of `{line, pop_count?, options?, column?, end_column?}` entries
 * describing how the option stack should be pushed/popped while walking
 * lines during filtering (not yet ported).
 *
 * `%b()` (Lua's balanced-paren match) and Lua's `tonumber` have no existing
 * port: `lua_pattern.ts` explicitly excludes `%b`, and nothing else in this
 * codebase needs `tonumber` yet. `removeBalancedParens`/`luaToNumber` below
 * are small local implementations scoped to this file's needs (comment
 * bodies and numeric limit-option arguments), not general-purpose ports.
 *
 * The push/pop entries built by `parseInlineComments` (from inline
 * `-- luacheck: push`/`pop` comments) always carry `end_column`; the ones
 * built by `addFunctionBoundaries` (implicit function-start/end pushes/
 * pops) never do. `applyBoundaries` uses that presence/absence, not any
 * explicit tag, to tell the two kinds apart when pairing pushes with pops
 * and when deciding whether an unpaired push/pop warning applies.
 */

import type { CheckStateInstance, InlineOptionsEntry } from "../check_state.ts";
import type { CommentEntry, Range } from "../parser.ts";
import {
  nullaryInlineOptions,
  type Options,
  variadicInlineOptions,
} from "../options.ts";
import { after, arrayToSet, split, Stack, strip } from "../utils.ts";
import { luaFind } from "../lua_pattern.ts";

export const warnings: Record<
  string,
  { message_format: string; fields: string[] }
> = {
  // Also produced during filtering for options that did not pass validation.
  "021": { message_format: "{msg}", fields: ["msg"] },
  "022": { message_format: "unpaired push directive", fields: [] },
  "023": { message_format: "unpaired pop directive", fields: [] },
};

/** The field set of one `chstate.inlineOptions` entry, used by check.ts to validate inline-option events. */
export const inlineOptionFields = [
  "line",
  "pop_count",
  "options",
  "column",
  "end_column",
];

const limitOpts = arrayToSet([
  "max_line_length",
  "max_code_line_length",
  "max_string_line_length",
  "max_comment_line_length",
  "max_cyclomatic_complexity",
]);

function isValidOptionName(name: string): boolean {
  if (name === "std" || variadicInlineOptions[name] !== undefined) {
    return true;
  }

  const stripped = name.replace(/^no_/, "");
  return nullaryInlineOptions[stripped] !== undefined ||
    limitOpts[stripped] !== undefined;
}

/**
 * Splits a token array for an inline option invocation into option name and
 * argument array, or `undefined` if invocation is invalid.
 */
function splitInvocation(tokens: string[]): [string, string[]] | undefined {
  // Name of the option can be split into several space separated tokens.
  // Since some valid names are prefixes of some other names (e.g. `unused`
  // and `unused arguments`), the longest prefix of the token array that is
  // a valid option name is used.
  let curName: string | undefined;
  let lastValidName: string | undefined;
  let lastValidNameEndIndex: number | undefined;

  for (let i = 0; i < tokens.length; i++) {
    curName = curName !== undefined ? `${curName}_${tokens[i]}` : tokens[i];

    if (isValidOptionName(curName)) {
      lastValidName = curName;
      lastValidNameEndIndex = i + 1;
    }
  }

  if (lastValidName === undefined) {
    return undefined;
  }

  return [lastValidName, tokens.slice(lastValidNameEndIndex!)];
}

function unexpectedNumArgs(
  name: string,
  args: string[],
  expected: number,
): string {
  return `inline option '${name}' expects ${expected} argument${
    expected === 1 ? "" : "s"
  }, ${args.length} given`;
}

/** Mirrors Lua's `str:gsub("%b()", " ")`: replaces balanced-paren spans with a single space. */
function removeBalancedParens(str: string): string {
  let result = "";
  let i = 0;

  while (i < str.length) {
    if (str[i] === "(") {
      let depth = 1;
      let j = i + 1;

      while (j < str.length && depth > 0) {
        if (str[j] === "(") depth++;
        else if (str[j] === ")") depth--;
        j++;
      }

      if (depth === 0) {
        result += " ";
        i = j;
        continue;
      }
    }

    result += str[i];
    i++;
  }

  return result;
}

/** Approximates Lua's `tonumber` for the decimal/hex-integer literals inline limit options actually use. */
function luaToNumber(str: string): number | undefined {
  const trimmed = str.trim();

  if (
    !/^[+-]?(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)$/.test(
      trimmed,
    )
  ) {
    return undefined;
  }

  const value = Number(trimmed);
  return Number.isNaN(value) ? undefined : value;
}

/** Parses inline option body, returns options or `undefined` and an error message. */
function parseOptions(
  body: string,
): [Options, undefined] | [undefined, string] {
  const opts: Options = {};
  const parts = split(body, ",");

  for (const nameAndArgs of parts) {
    const tokens = split(nameAndArgs);
    const invocation = splitInvocation(tokens);

    if (!invocation) {
      if (tokens.length === 0) {
        return [
          undefined,
          parts.length === 1
            ? "empty inline option"
            : "empty inline option invocation",
        ];
      } else {
        return [undefined, `unknown inline option '${tokens.join(" ")}'`];
      }
    }

    let [name, args] = invocation;

    if (name === "std") {
      if (args.length !== 1) {
        return [undefined, unexpectedNumArgs(name, args, 1)];
      }

      opts.std = args[0];
    } else if (name === "ignore" && args.length === 0) {
      opts.ignore = [".*"];
    } else if (variadicInlineOptions[name] !== undefined) {
      opts[name] = args;
    } else {
      const fullName = name.replace(/_/g, " ");
      const hasNoPrefix = name.startsWith("no_");
      if (hasNoPrefix) name = name.slice(3);
      const flag = !hasNoPrefix;

      if (nullaryInlineOptions[name] !== undefined) {
        if (args.length !== 0) {
          return [undefined, unexpectedNumArgs(fullName, args, 0)];
        }

        opts[name] = flag;
      } else {
        // Guaranteed by isValidOptionName/splitInvocation: any name that
        // reaches here without matching std/variadic/nullary must be a
        // limit option (max_line_length and friends).
        if (flag) {
          if (args.length !== 1) {
            return [undefined, unexpectedNumArgs(fullName, args, 1)];
          }

          const value = luaToNumber(args[0]);

          if (value === undefined) {
            return [
              undefined,
              `inline option '${name}' expects number as argument`,
            ];
          }

          opts[name] = value;
        } else {
          if (args.length !== 0) {
            return [undefined, unexpectedNumArgs(fullName, args, 0)];
          }

          opts[name] = false;
        }
      }
    }
  }

  return [opts, undefined];
}

type InlineCommentOptions = Options | "push" | "pop";

/**
 * Parses comment contents, returns up to two `options` values (tables or
 * `"push"` or `"pop"`). On an invalid inline comment returns `undefined`
 * and an error message.
 */
function parseInlineComment(
  commentContents: string,
): [InlineCommentOptions | undefined, string | undefined] {
  const bodyAfterPrefix = after(strip(commentContents), "^luacheck:");

  if (bodyAfterPrefix === undefined) {
    return [undefined, undefined];
  }

  let opts2: string | undefined;

  // Remove comments in balanced parens.
  let body = strip(removeBalancedParens(bodyAfterPrefix));
  const pushMatch = luaFind(body, "^push%s+(.*)");

  if (pushMatch) {
    opts2 = "push";
    // `^push%s+(.*)` has one plain capture group, never a `()` position capture.
    body = pushMatch.captures[0] as string;
  } else if (body === "push" || body === "pop") {
    return [body, undefined];
  }

  const [opts1, errMsg] = parseOptions(body);
  return [opts1, errMsg ?? opts2];
}

/** An entry in the pre-`applyBoundaries` array: an inline option table, an inline push/pop, or a function boundary. */
interface OptionsAndBoundariesEntry {
  line: number;
  column: number;
  end_column?: number;
  options: InlineCommentOptions;
}

/**
 * Returns an array of tables with column range info and an `options` field
 * containing a table of options or `"push"` or `"pop"`. Warns about invalid
 * inline option comments.
 */
function parseInlineComments(
  chstate: CheckStateInstance,
): OptionsAndBoundariesEntry[] {
  const res: OptionsAndBoundariesEntry[] = [];

  for (const comment of chstate.comments) {
    const [opts1, opts2] = parseInlineComment(comment.contents);

    if (opts1) {
      const column = chstate.offsetToColumn(comment.line, comment.offset);
      const endColumn = chstate.offsetToColumn(
        comment.line,
        comment.endOffset,
      );

      res.push({
        line: comment.line,
        column,
        end_column: endColumn,
        options: opts1,
      });

      if (opts2) {
        res.push({
          line: comment.line,
          column,
          end_column: endColumn,
          options: opts2 as "push",
        });
      }
    } else if (opts2) {
      chstate.warnRange(21, comment as CommentEntry, { msg: opts2 });
    }
  }

  return res;
}

/**
 * Adds a table with `line`, `column`, and `options` fields to the given
 * array. For each function a table with `options` set to `"push"` for the
 * function start and a table with `options` set to `"pop"` for the
 * function end are added.
 */
function addFunctionBoundaries(
  inlineOptionsAndBoundaries: OptionsAndBoundariesEntry[],
  chstate: CheckStateInstance,
): void {
  for (const line of chstate.topLine.lines) {
    const fnNode = line.node;
    const endRange = fnNode.endRange as Range;

    inlineOptionsAndBoundaries.push({
      line: fnNode.line as number,
      column: chstate.offsetToColumn(
        fnNode.line as number,
        fnNode.offset as number,
      ),
      options: "push",
    });

    inlineOptionsAndBoundaries.push({
      line: endRange.line,
      column: chstate.offsetToColumn(endRange.line, endRange.offset),
      options: "pop",
    });
  }
}

function getOrder(entry: OptionsAndBoundariesEntry): number {
  if (entry.options === "push") return 1;
  if (entry.options === "pop") return 3;
  return 2;
}

function optionsAndBoundariesComparator(
  t1: OptionsAndBoundariesEntry,
  t2: OptionsAndBoundariesEntry,
): number {
  if (t1.line !== t2.line) {
    return t1.line - t2.line;
  }

  // For options and boundaries on the same line, all pushes are applied
  // before options before pops. (Valid pops are moved to the start of the
  // next line below.)
  const order1 = getOrder(t1);
  const order2 = getOrder(t2);

  if (order1 !== order2) {
    return order1 - order2;
  }

  return t1.column - t2.column;
}

/**
 * Applies boundaries within `inlineOptionsAndBoundaries` to replace them
 * with pop count instructions in the resulting array. Comments on lines
 * with code are popped at the end of the line. Warns about unpaired push
 * and pop directives.
 */
function applyBoundaries(
  chstate: CheckStateInstance,
  inlineOptionsAndBoundaries: OptionsAndBoundariesEntry[],
): InlineOptionsEntry[] {
  const res: InlineOptionsEntry[] = [];
  let resLast: InlineOptionsEntry | undefined;

  // While iterating over inline options and boundaries track push
  // boundaries that were not popped yet plus the number of options that
  // would be on the option stack after applying all already processed
  // option table pushes and pops.
  const pushes = Stack();
  const pushOptionCounts = Stack();
  let optionCount = 0;

  for (const item of inlineOptionsAndBoundaries) {
    if (item.options === "push") {
      pushes.push(item);
      pushOptionCounts.push(optionCount);
    } else if (item.options === "pop") {
      const top = pushes.top as OptionsAndBoundariesEntry | undefined;

      // Function boundaries are implicit, don't allow inline options to
      // pop them, don't allow function boundaries to pop inline option
      // pushes either. Inline options boundaries have end_column, function
      // boundaries don't.
      if (
        !top ||
        (item.end_column !== undefined && top.end_column === undefined)
      ) {
        // Inline option pop against nothing or a function push, mark as unpaired.
        chstate.warnColumnRange(
          23,
          item as { line: number; column: number; end_column: number },
        );
      } else {
        if (item.end_column === undefined) {
          // Function pop, remove any unpaired inline option pushes.
          while (
            pushes.top &&
            (pushes.top as OptionsAndBoundariesEntry).end_column !== undefined
          ) {
            chstate.warnColumnRange(
              22,
              pushes.top as {
                line: number;
                column: number;
                end_column: number;
              },
            );
            pushes.pop();
            pushOptionCounts.pop();
          }
        }

        pushes.pop();
        const prevOptionCount = pushOptionCounts.pop() as number;
        const popCount = optionCount - prevOptionCount;

        if (popCount > 0) {
          // Place the pop instruction at the start of the next line so that
          // getting the option stack for a line amounts to applying both
          // the pop instruction and the option push for the line.
          const line = item.line + 1;

          // Collapse with a previous table if it's on the same line. It can only be a pop count table.
          if (resLast && resLast.line === line) {
            resLast.pop_count = (resLast.pop_count ?? 0) + popCount;
          } else {
            resLast = { line, pop_count: popCount };
            res.push(resLast);
          }
        }

        // Update option stack size for this pop.
        optionCount = prevOptionCount;
      }
    } else {
      // Inline options table. Check if there is a pop count table for this line already.
      if (resLast && resLast.line === item.line) {
        resLast.options = item.options;
        resLast.column = item.column;
        resLast.end_column = item.end_column;
      } else {
        resLast = item as InlineOptionsEntry;
        res.push(resLast);
      }

      if (chstate.codeLines[item.line]) {
        // Inline comment on a line with some code, immediately pop it.
        resLast = { line: item.line + 1, pop_count: 1 };
        res.push(resLast);
      } else {
        optionCount++;
      }
    }
  }

  // Any remaining pushes are unpaired inline comments from the main chunk.
  while (pushes.top) {
    chstate.warnColumnRange(
      22,
      pushes.pop() as { line: number; column: number; end_column: number },
    );
  }

  return res;
}

/**
 * Warns about invalid inline options. Sets `chstate.inlineOptions` to an
 * array of tables that describe the way inline option tables are pushed
 * onto and popped from the option stack when iterating over lines. Each
 * table has field `line` that the array is sorted by and also either or
 * both sets of fields:
 * - `pop_count` - a number of option tables that should be popped from the
 *   stack before processing warnings on this line.
 * - `options`, `column`, `end_column` - an option table that should be
 *   pushed onto the stack before processing warnings on this line but
 *   after popping tables if `pop_count` is present.
 */
export function run(chstate: CheckStateInstance): void {
  const inlineOptionsAndBoundaries = parseInlineComments(chstate);
  addFunctionBoundaries(inlineOptionsAndBoundaries, chstate);
  inlineOptionsAndBoundaries.sort(optionsAndBoundariesComparator);
  chstate.inlineOptions = applyBoundaries(chstate, inlineOptionsAndBoundaries);
}
