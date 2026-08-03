/**
 * Ported from luacheck's stages/detect_unused_fields.lua: warns about
 * constant table fields whose value is overwritten by a later entry in
 * the same constructor (warning 314). It walks `chstate.ast` recursively
 * and reads nothing else.
 */

import type { AstNode, Range } from "../parser.ts";
import type { CheckStateInstance, Warning } from "../check_state.ts";
import { evalConstNode } from "../core_utils.ts";

/** Length of an AST node's 1-based array part (mirrors parser.ts's private `astLen`). */
function astLen(node: AstNode): number {
  let n = 0;
  while (node[String(n + 1)] !== undefined) n++;
  return n;
}

/**
 * Drops `undefined`-valued keys, mirroring how a Lua table constructor
 * never creates a key assigned `nil` - unlike a JS object literal, which
 * keeps the key with value `undefined`.
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

function unusedFieldValueMessageFormat(warning: Warning): string {
  // Registered for code 314 only.
  const target = warning.code === 314 && warning.index ? "index" : "field";
  return `value assigned to ${target} {field!} is overwritten on line {overwritten_line} before use`;
}

interface WarningEntry {
  message_format: string | ((warning: Warning) => string);
  fields: string[];
}

export const warnings: Record<string, WarningEntry> = {
  "314": {
    message_format: unusedFieldValueMessageFormat,
    fields: [
      "field",
      "index",
      "overwritten_line",
      "overwritten_column",
      "overwritten_end_column",
    ],
  },
};

function warnUnusedFieldValue(
  chstate: CheckStateInstance,
  node: AstNode,
  fieldRepr: string | undefined,
  isIndex: true | undefined,
  overwritingNode: AstNode,
): void {
  const overwritingRange = overwritingNode as Range;
  chstate.warnRange(
    314,
    node as Range,
    compact({
      field: fieldRepr,
      index: isIndex,
      overwritten_line: overwritingRange.line,
      overwritten_column: chstate.offsetToColumn(
        overwritingRange.line,
        overwritingRange.offset,
      ),
      overwritten_end_column: chstate.offsetToColumn(
        overwritingRange.line,
        overwritingRange.endOffset,
      ),
    }),
  );
}

function checkTable(chstate: CheckStateInstance, node: AstNode): void {
  let arrayIndex = 1;
  const keyValueToNode = new Map<string | number | boolean, AstNode>();
  const keyNodeToRepr = new Map<AstNode, string>();
  const indexKeyNodes = new Map<AstNode, true>();
  const len = astLen(node);

  for (let i = 1; i <= len; i++) {
    const pair = node[String(i)] as AstNode;
    let keyValue: string | number | boolean | undefined;
    let keyRepr: string | undefined;
    let keyNode: AstNode;

    if (pair.tag === "Pair") {
      keyNode = pair["1"] as AstNode;
      [keyValue, keyRepr] = evalConstNode(keyNode) ?? [];
    } else {
      keyNode = pair;
      keyValue = arrayIndex;
      keyRepr = String(Math.floor(arrayIndex));
      arrayIndex += 1;
    }

    // Lua truthiness: only `nil` and `false` are falsy, so `0` and `""`
    // are truthy constant keys; a bare JS truthy check would drop them.
    if (keyValue !== undefined && keyValue !== false) {
      const prevKeyNode = keyValueToNode.get(keyValue);

      if (prevKeyNode) {
        warnUnusedFieldValue(
          chstate,
          prevKeyNode,
          keyNodeToRepr.get(prevKeyNode),
          indexKeyNodes.get(prevKeyNode),
          keyNode,
        );
      }

      keyValueToNode.set(keyValue, keyNode);
      // `keyRepr` is always set when `keyValue` passes the truthy check.
      keyNodeToRepr.set(keyNode, keyRepr as string);

      if (pair.tag !== "Pair") {
        indexKeyNodes.set(keyNode, true);
      }
    }
  }
}

function checkNodes(chstate: CheckStateInstance, nodes: AstNode): void {
  const len = astLen(nodes);

  for (let i = 1; i <= len; i++) {
    const node = nodes[String(i)];

    if (typeof node === "object" && node !== null) {
      const astNode = node as AstNode;

      if (astNode.tag === "Table") {
        checkTable(chstate, astNode);
      }

      checkNodes(chstate, astNode);
    }
  }
}

export function run(chstate: CheckStateInstance): void {
  checkNodes(chstate, chstate.ast);
}
