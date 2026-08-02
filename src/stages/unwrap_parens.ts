/**
 * Ported from luacheck's stages/unwrap_parens.lua. Mutates the AST,
 * unwrapping redundant `Paren` nodes and warning about two relational/`not`
 * operator precedence pitfalls (581, 582).
 *
 * A trailing `Paren` in an expression list is kept only when it wraps a
 * possibly multi-value expression (`Call`/`Invoke`/`Dots`) at a position
 * where that matters. The tricky part: when a `Paren` sits exactly at the
 * tail of a list that has a `listStart` (i.e. `index === listStart ===
 * numNodes`), the whole unwrap attempt - including the inner-tag check -
 * is skipped, so the `Paren` is preserved unconditionally even if its
 * inner expression is a plain scalar. Ground-truthed against the real Lua
 * 5.4 interpreter (e.g. `local t = {(1+2)}` keeps its `Paren` around the
 * `Op` node) since this is easy to get backwards from the source alone.
 */

import type { CheckStateInstance } from "../check_state.ts";
import type { AstNode, Range } from "../parser.ts";

export const warnings: Record<
  string,
  { message_format: string; fields: string[] }
> = {
  "581": {
    message_format:
      "'not (x {operator} y)' can be replaced by 'x {replacement_operator} y'" +
      " (if neither side is a table or NaN)",
    fields: ["operator", "replacement_operator"],
  },
  "582": {
    message_format:
      "Error prone negation: negation is executed before relational operator.",
    fields: [],
  },
};

const relationalOperators: Record<string, string> = {
  ne: "~=",
  eq: "==",
  gt: ">",
  ge: ">=",
  lt: "<",
  le: "<=",
};

const replacements: Record<string, string> = {
  ne: "==",
  eq: "~=",
  gt: "<=",
  ge: "<",
  lt: ">=",
  le: ">",
};

/** Length of an AST node's 1-based array part (mirrors parser.ts's private `astLen`). */
function astLen(node: AstNode): number {
  let n = 0;
  while (node[String(n + 1)] !== undefined) n++;
  return n;
}

function handleNodes(
  chstate: CheckStateInstance,
  nodes: AstNode,
  listStart?: number,
): void {
  const numNodes = astLen(nodes);

  for (let index = 1; index <= numNodes; index++) {
    const node = nodes[String(index)];

    if (typeof node !== "object" || node === null) continue;

    const n = node as AstNode;
    const tag = n.tag;

    if (tag === "Table" || tag === "Return") {
      handleNodes(chstate, n, 1);
    } else if (tag === "Call") {
      handleNodes(chstate, n, 2);
    } else if (tag === "Invoke") {
      handleNodes(chstate, n, 3);
    } else if (tag === "Forin") {
      handleNodes(chstate, n["2"] as AstNode, 1);
      handleNodes(chstate, n["3"] as AstNode);
    } else if (tag === "Local") {
      if (n["2"] !== undefined) {
        handleNodes(chstate, n["2"] as AstNode);
      }
    } else if (tag === "Set" || tag === "OpSet") {
      handleNodes(chstate, n["1"] as AstNode);
      handleNodes(chstate, n["2"] as AstNode, 1);
    } else {
      const leftBefore = n["2"] as AstNode | undefined;

      if (
        tag === "Op" && relationalOperators[n["1"] as string] !== undefined &&
        leftBefore?.tag === "Op" && leftBefore["1"] === "not"
      ) {
        chstate.warnRange(582, n as Range);
      }

      // Re-read n["2"] after recursing: the recursive call may have just
      // unwrapped a Paren sitting there (e.g. `not (a == b)`), so the 581
      // check below must see the post-recursion value, not `leftBefore`.
      handleNodes(chstate, n);
      const leftAfter = n["2"] as AstNode | undefined;

      if (
        tag === "Op" && n["1"] === "not" && leftAfter?.tag === "Op" &&
        relationalOperators[leftAfter["1"] as string] !== undefined
      ) {
        const innerOperator = leftAfter["1"] as string;
        chstate.warnRange(581, n as Range, {
          operator: relationalOperators[innerOperator],
          replacement_operator: replacements[innerOperator],
        });
      }

      if (
        tag === "Paren" &&
        (!listStart || index < listStart || index !== numNodes)
      ) {
        const innerNode = n["1"] as AstNode;

        if (
          innerNode.tag !== "Call" && innerNode.tag !== "Invoke" &&
          innerNode.tag !== "Dots"
        ) {
          nodes[String(index)] = innerNode;
        }
      }
    }
  }
}

export function run(chstate: CheckStateInstance): void {
  handleNodes(chstate, chstate.ast);
}
