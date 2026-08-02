/**
 * Ported from luacheck's core_utils.lua.
 *
 * `eval_const_node` reads Lua source-code numerals. Upstream branches on
 * `_VERSION == "Lua 5.3" or "Lua 5.4"` before appending a `.0` suffix to
 * integer-looking numerals (see PORT_NOTES.md, "5. Lua constructs" table,
 * `core_utils.lua _VERSION branch"). This port targets Lua 5.4 only, so
 * that branch collapses to an unconditional step here.
 *
 * `each_statement` walks `chstate.lines`, a field populated by
 * stages/linearize.lua. That file is not yet ported (see PORT_NOTES.md
 * section 4, `core_utils.lua` row). `eachStatement` below takes a minimal
 * forward-declared `LineLike` shape instead of importing a real `Line`
 * type, and will need reconciling once linearize.lua lands.
 */

import type { AstNode } from "./parser.ts";
import { decode } from "./decoder.ts";
import { arrayToSet } from "./utils.ts";
import type { Warning } from "./check_state.ts";

/**
 * Parses a Lua numeral string to a JS number. `Number()` handles plain
 * decimal and hex-integer syntax the same way Lua does, but not hex
 * numerals with a radix point (e.g. `0x1F.0`) or a `p`/`P` binary exponent
 * (e.g. `0x1p4`), which need a hand parse. Per the Lua 5.4 grammar, a hex
 * float's `p` exponent is optional; a radix point alone (no `p`) is still
 * a float, with an implicit exponent of 0. Callers of `evalConstNode`
 * append a bare `.0` to integer-looking numerals to force float
 * evaluation, so even plain hex integers can arrive here with a radix
 * point and no exponent (e.g. `0x1F` becomes `0x1F.0`).
 */
function luaNumeralToNumber(str: string): number | undefined {
  const isHex = /^0[xX]/.test(str);

  if (isHex) {
    const rest = str.slice(2);

    if (/[.pP]/.test(rest)) {
      const pIndex = rest.search(/[pP]/);
      const mantissaStr = pIndex === -1 ? rest : rest.slice(0, pIndex);
      const exponent = pIndex === -1 ? 0 : Number(rest.slice(pIndex + 1));
      const dotIndex = mantissaStr.indexOf(".");
      const intPart = dotIndex === -1
        ? mantissaStr
        : mantissaStr.slice(0, dotIndex);
      const fracPart = dotIndex === -1 ? "" : mantissaStr.slice(dotIndex + 1);
      const mantissaValue = parseInt(intPart || "0", 16) +
        (fracPart ? parseInt(fracPart, 16) / 16 ** fracPart.length : 0);
      const value = mantissaValue * 2 ** exponent;
      return Number.isNaN(value) ? undefined : value;
    }
  }

  const value = Number(str);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * Attempts to evaluate a node as a Lua value, without resolving locals.
 * Returns the Lua value and its string representation on success,
 * `undefined` on failure.
 */
export function evalConstNode(
  node: AstNode,
): [value: string | number | boolean, repr: string] | undefined {
  if (node.tag === "True") {
    return [true, "true"];
  } else if (node.tag === "False") {
    return [false, "false"];
  } else if (node.tag === "String") {
    const chars = decode(node["1"] as string);
    return [
      node["1"] as string,
      chars.getPrintableSubstring(1, chars.getLength()),
    ];
  } else {
    let isNegative = false;

    if (node.tag === "Op" && node["1"] === "unm") {
      isNegative = true;
      node = node["2"] as AstNode;
    }

    if (node.tag !== "Number") {
      return undefined;
    }

    let str = node["1"] as string;

    if (/[iIuUlL]/.test(str)) {
      // Ignore LuaJIT cdata literals.
      return undefined;
    }

    if (!/[.eEpP]/.test(str)) {
      str = str + ".0";
    }

    let number = luaNumeralToNumber(str);

    if (number === undefined) {
      return undefined;
    }

    if (isNegative) {
      number = -number;
    }

    if (Number.isFinite(number)) {
      return [number, (isNegative ? "-" : "") + (node["1"] as string)];
    }
  }
}

const statementContainingTags = arrayToSet([
  "Do",
  "While",
  "Repeat",
  "Fornum",
  "Forin",
  "If",
]);

/**
 * Minimal forward-declared shape of a linearized "line" object. The full
 * Line type comes from stages/linearize.lua, not yet ported. This is only
 * the slice eachStatement needs.
 */
interface LineLike {
  node: AstNode;
}

/** Length of an AST node's 1-based array part (mirrors parser.ts's private `astLen`). */
function astLen(node: AstNode): number {
  let n = 0;
  while (node[String(n + 1)] !== undefined) n++;
  return n;
}

/** `items` is an array of nodes or nested item arrays. */
function scanForStatements<Args extends unknown[]>(
  chstate: unknown,
  items: AstNode,
  tags: Record<string, number>,
  callback: (chstate: unknown, item: AstNode, ...args: Args) => void,
  ...args: Args
): void {
  const length = astLen(items);

  for (let i = 1; i <= length; i++) {
    const item = items[String(i)] as AstNode;

    if (item.tag !== undefined && tags[item.tag]) {
      callback(chstate, item, ...args);
    }

    if (!item.tag || statementContainingTags[item.tag]) {
      scanForStatements(chstate, item, tags, callback, ...args);
    }
  }
}

/** Calls `callback(chstate, node, ...)` for each statement node within the AST with tag in the given array. */
export function eachStatement<Args extends unknown[]>(
  chstate: { lines: LineLike[] },
  tagsArray: string[],
  callback: (chstate: unknown, item: AstNode, ...args: Args) => void,
  ...args: Args
): void {
  const tags = arrayToSet(tagsArray);

  for (const line of chstate.lines) {
    scanForStatements(
      chstate,
      line.node["2"] as AstNode,
      tags,
      callback,
      ...args,
    );
  }
}

function locationComparator(a: Warning, b: Warning): number {
  if (a.line !== b.line) return a.line - b.line;
  if (a.column !== b.column) return a.column - b.column;
  return a.code - b.code;
}

/** Sorts an array of warnings, in place, by location information as provided in `line` and `column` fields. */
export function sortByLocation(warnings: Warning[]): void {
  warnings.sort(locationComparator);
}
