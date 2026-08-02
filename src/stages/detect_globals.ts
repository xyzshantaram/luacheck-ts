/**
 * Ported from luacheck's stages/detect_globals.lua: warns about
 * assignments (111), mutations (112), and accesses (113) of global
 * variables, tracing through localizing assignments such as
 * `local t = table` (and their field chains, e.g. `local a = t.b; a.c`).
 *
 * `deep_resolve`/`resolve_node` walk an `Id`/`Index` node down to its
 * ultimate base, following `local alias = global.field` chains through
 * `item.usedValues`, and memoize the result on `node.resolution` (stashed
 * via `AstNode`'s index signature, read back with a cast - matching this
 * codebase's `node.var`/similar conventions). `node.resolution` is either
 * the string `"unknown"`, the string `"not_string"`, a `String`-tag AST
 * node (a literal key), or a synthetic array-part `AstNode` shaped like
 * `{1: globalIdNode, 2: keyResolution, ...}` plus an out-of-band
 * `previous_indexing_len` field - all of which fit the same "array part
 * via numeric string keys + named fields" shape every other AstNode in
 * this codebase already uses, so `NodeResolution` below just aliases
 * `AstNode` for the non-literal cases rather than inventing a separate
 * type.
 */

import type { AstNode, AstValue, Range } from "../parser.ts";
import type { CheckStateInstance, Warning } from "../check_state.ts";
import type { Item, LineInstance, ScanningItem, Var } from "./linearize.ts";
import { arrayToSet } from "../utils.ts";

/** Length of an AST node's 1-based array part (mirrors linearize.ts's private `astLen`). */
function astLen(node: AstNode): number {
  let n = 0;
  while (node[String(n + 1)] !== undefined) n++;
  return n;
}

/** Builds a node with a 1-based array part from `items` (mirrors linearize.ts's private `arr`). */
function arr(...items: AstValue[]): AstNode {
  const node: AstNode = {};
  items.forEach((item, i) => {
    if (item !== undefined) node[String(i + 1)] = item;
  });
  return node;
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

function prefixIfIndirect(message: string): (warning: Warning) => string {
  return (warning) => warning.indirect ? `indirectly ${message}` : message;
}

function settingGlobalFormatMessage(warning: Warning): string {
  // `module` field is set during filtering.
  return warning.module
    ? "setting non-module global variable {name!}"
    : "setting non-standard global variable {name!}";
}

const globalWarningFields = [
  "name",
  "indexing",
  "previous_indexing_len",
  "top",
  "indirect",
];

interface WarningEntry {
  message_format: string | ((warning: Warning) => string);
  fields: string[];
}

export const warnings: Record<string, WarningEntry> = {
  "111": {
    message_format: settingGlobalFormatMessage,
    fields: globalWarningFields,
  },
  "112": {
    message_format: "mutating non-standard global variable {name!}",
    fields: globalWarningFields,
  },
  "113": {
    message_format: "accessing undefined variable {name!}",
    fields: globalWarningFields,
  },
  // The following warnings are added during filtering.
  "121": {
    message_format: "setting read-only global variable {name!}",
    fields: [],
  },
  "122": {
    message_format: prefixIfIndirect(
      "setting read-only field {field!} of global {name!}",
    ),
    fields: [],
  },
  "131": { message_format: "unused global variable {name!}", fields: [] },
  "142": {
    message_format: prefixIfIndirect(
      "setting undefined field {field!} of global {name!}",
    ),
    fields: [],
  },
  "143": {
    message_format: prefixIfIndirect(
      "accessing undefined field {field!} of global {name!}",
    ),
    fields: [],
  },
};

const actionCodes: Record<string, string> = {
  set: "1",
  mutate: "2",
  access: "3",
};

/**
 * `index` describes an indexing, where `index[1]` is a global node
 * and other items describe keys: each one is a string node, "not_string",
 * or "unknown". `node` is literal base node that's indexed.
 * E.g. in `local a = table.a; a.b = "c"` `node` is `a` node of the second
 * statement and `index` describes `table.a.b`.
 * `index.previous_indexing_len` is optional length of prefix of `index` array representing last
 * assignment in the aliasing chain, e.g. `2` in the previous example (because last indexing is
 * `table.a`).
 */
function warnGlobal(
  chstate: CheckStateInstance,
  node: AstNode,
  index: AstNode,
  isLhs: boolean | undefined,
  isTopLine: boolean,
): void {
  const global = index["1"] as AstNode;
  const indexLen = astLen(index);
  const action = isLhs ? (indexLen === 1 ? "set" : "mutate") : "access";

  let indexing: (boolean | string)[] | undefined;

  if (indexLen > 1) {
    indexing = [];

    for (let i = 2; i <= indexLen; i++) {
      const field = index[String(i)] as NodeResolution;

      if (field === "unknown") {
        indexing.push(true);
      } else if (field === "not_string") {
        indexing.push(false);
      } else {
        indexing.push(field["1"] as string);
      }
    }
  }

  chstate.warnRange(
    Number(`11${actionCodes[action]}`),
    node as Range,
    compact({
      name: global["1"] as string,
      indexing,
      previous_indexing_len: index.previous_indexing_len as
        | number
        | undefined,
      top: (isTopLine && action === "set") || undefined,
      indirect: (node !== global) || undefined,
    }),
  );
}

type NodeResolution = "unknown" | "not_string" | AstNode;

function resolvedToIndex(resolution: NodeResolution): resolution is AstNode {
  return resolution !== "unknown" && resolution !== "not_string" &&
    resolution.tag !== "String";
}

const literalTags = arrayToSet([
  "Nil",
  "True",
  "False",
  "Number",
  "String",
  "Table",
  "Function",
]);

function resolveNode(node: AstNode, item: ScanningItem): NodeResolution {
  if (node.tag === "Id" || node.tag === "Index") {
    deepResolve(node, item);
    return node.resolution as NodeResolution;
  } else if (node.tag !== undefined && literalTags[node.tag]) {
    return node.tag === "String" ? node : "not_string";
  } else {
    return "unknown";
  }
}

/**
 * Resolves value of an identifier or index node, tracking through simple
 * assignments like `local foo = bar.baz`.
 * Can be given an `Invoke` node to resolve the method field.
 * Sets `node.resolution` to "unknown", "not_string", `string node`, or
 * `{previous_indexing_len = index, global_node, key...}`.
 * Each key can be "unknown", "not_string" or `string_node`.
 */
function deepResolve(node: AstNode, item: ScanningItem): void {
  if (node.resolution) return;

  // Common case.
  // Also protects against infinite recursion, if it's even possible.
  node.resolution = "unknown" as NodeResolution;

  let base = node;
  let baseTag = node.tag === "Id" ? "Id" : "Index";
  const keys: AstNode[] = [];

  while (baseTag === "Index") {
    keys.unshift(base["2"] as AstNode);
    base = base["1"] as AstNode;
    baseTag = base.tag ?? "";
  }

  if (baseTag !== "Id") return;

  const variable = base.var as Var | undefined;
  let baseResolution: NodeResolution;
  let previousIndexingLen: number | undefined;

  if (variable) {
    const usedValues = item.usedValues.get(variable);

    if (!usedValues || usedValues.length !== 1) {
      // Do not know where the value for the base local came from.
      return;
    }

    const value = usedValues[0];

    if (!value.node) return;

    baseResolution = resolveNode(value.node, value.item);

    if (resolvedToIndex(baseResolution)) {
      previousIndexingLen = astLen(baseResolution);
    }
  } else {
    baseResolution = arr(base);
  }

  if (keys.length === 0) {
    node.resolution = baseResolution;
  } else if (!resolvedToIndex(baseResolution)) {
    // Indexing something unknown or indexing a literal.
    node.resolution = "unknown";
  } else {
    const resolution: AstNode = { ...baseResolution };
    resolution.previous_indexing_len = previousIndexingLen;

    const baseLen = astLen(baseResolution);

    keys.forEach((key, i) => {
      let keyResolution = resolveNode(key, item);

      if (resolvedToIndex(keyResolution)) {
        keyResolution = "unknown";
      }

      resolution[String(baseLen + i + 1)] = keyResolution;
    });

    // Assign resolution only after all the recursive calls.
    node.resolution = resolution;
  }
}

function detectInNode(
  chstate: CheckStateInstance,
  item: ScanningItem,
  originalNode: AstNode,
  isTopLine: boolean,
  isLhs?: boolean,
): void {
  if (
    originalNode.tag === "Index" || originalNode.tag === "Invoke" ||
    originalNode.tag === "Id"
  ) {
    if (originalNode.tag === "Id" && originalNode.var) {
      // Do not warn about assignments to and accesses of local variables
      // that resolve to globals or their fields.
      return;
    }

    deepResolve(originalNode, item);
    const resolution = originalNode.resolution as NodeResolution;

    // Still need to recurse into base and key nodes.
    // E.g. don't miss a global in `(global1())[global2()]`.

    if (originalNode.tag === "Invoke") {
      const len = astLen(originalNode);
      for (let i = 3; i <= len; i++) {
        detectInNode(
          chstate,
          item,
          originalNode[String(i)] as AstNode,
          isTopLine,
        );
      }
    }

    let node = originalNode;

    if (node.tag !== "Id") {
      do {
        const key = node["2"];
        if (typeof key === "object" && key !== null) {
          detectInNode(chstate, item, key as AstNode, isTopLine);
        }
        node = node["1"] as AstNode;
      } while (node.tag === "Index");

      if (node.tag !== "Id") {
        detectInNode(chstate, item, node, isTopLine);
      }
    }

    if (resolvedToIndex(resolution)) {
      warnGlobal(chstate, node, resolution, isLhs, isTopLine);
    }
  } else if (originalNode.tag !== "Function") {
    const len = astLen(originalNode);
    for (let i = 1; i <= len; i++) {
      const nestedNode = originalNode[String(i)];
      if (typeof nestedNode === "object" && nestedNode !== null) {
        detectInNode(chstate, item, nestedNode as AstNode, isTopLine);
      }
    }
  }
}

function detectInNodes(
  chstate: CheckStateInstance,
  item: ScanningItem,
  nodes: AstNode,
  isTopLine: boolean,
  isLhs?: boolean,
): void {
  const len = astLen(nodes);
  for (let i = 1; i <= len; i++) {
    detectInNode(chstate, item, nodes[String(i)] as AstNode, isTopLine, isLhs);
  }
}

function detectGlobalsInLine(
  chstate: CheckStateInstance,
  line: LineInstance,
): void {
  const isTopLine = line === chstate.topLine;

  for (let i = 1; i <= line.items.size; i++) {
    const item = line.items[i] as Item;

    if (item.tag === "Eval") {
      detectInNode(chstate, item, item.node, isTopLine);
    } else if (item.tag === "Local") {
      if (item.rhs) {
        detectInNodes(chstate, item, item.rhs, isTopLine);
      }
    } else if (item.tag === "Set" || item.tag === "OpSet") {
      detectInNodes(chstate, item, item.lhs, isTopLine, true);
      detectInNodes(chstate, item, item.rhs, isTopLine);
    }
  }
}

// Warns about assignments, field accesses, and mutations of global variables,
// tracing through localizing assignments such as `local t = table`.
export function run(chstate: CheckStateInstance): void {
  for (const line of chstate.lines) {
    detectGlobalsInLine(chstate, line);
  }
}
