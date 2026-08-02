/**
 * Ported from luacheck's stages/name_functions.lua: adds a `name` field to
 * `Function` AST nodes when possible (assigned-to-a-local, assigned-to-a-
 * global, or assigned-to-a-field, including through a table literal), for
 * use by later warning messages. `handleNode` mirrors Lua's `handle_node`
 * exactly, including calling it with no `name` argument for the top-level
 * `ast` and for `Table` keys: when the visited node is itself a `Function`,
 * this still assigns `node.name = name` (i.e. explicitly `undefined`)
 * rather than skipping the assignment, matching upstream.
 */

import type { AstNode } from "../parser.ts";
import type { CheckStateInstance } from "../check_state.ts";

/** Length of an AST node's 1-based array part (mirrors parser.ts's private `astLen`). */
function astLen(node: AstNode): number {
  let n = 0;
  while (node[String(n + 1)] !== undefined) n++;
  return n;
}

function getIndexName(
  baseName: string,
  keyNode: AstNode,
): string | undefined {
  if (keyNode.tag === "String") {
    return `${baseName}.${keyNode["1"] as string}`;
  }
  return undefined;
}

function getFullFieldName(node: AstNode): string | undefined {
  if (node.tag === "Id") {
    return node["1"] as string;
  } else if (node.tag === "Index") {
    const baseName = getFullFieldName(node["1"] as AstNode);
    return baseName && getIndexName(baseName, node["2"] as AstNode);
  }
  return undefined;
}

function handleNodes(nodes: AstNode): void {
  const length = astLen(nodes);

  for (let i = 1; i <= length; i++) {
    const node = nodes[String(i)];

    if (typeof node === "object" && node !== null) {
      handleNode(node as AstNode);
    }
  }
}

function handleNode(node: AstNode, name?: string): void {
  if (node.tag === "Function") {
    node.name = name;
    handleNodes(node["2"] as AstNode);
  } else if (
    node.tag === "Set" || node.tag === "Local" || node.tag === "Localrec"
  ) {
    const lhs = node["1"] as AstNode;
    const rhs = node["2"] as AstNode | undefined;

    // No need to handle LHS if there is no RHS, it's always just a list of locals in that case.
    if (rhs) {
      handleNodes(lhs);

      const rhsLength = astLen(rhs);
      for (let index = 1; index <= rhsLength; index++) {
        const rhsNode = rhs[String(index)] as AstNode;
        const lhsNode = lhs[String(index)] as AstNode | undefined;
        const fieldName = lhsNode && getFullFieldName(lhsNode);
        handleNode(rhsNode, fieldName);
      }
    }
  } else if (node.tag === "Table" && name) {
    const length = astLen(node);

    for (let i = 1; i <= length; i++) {
      const pairNode = node[String(i)] as AstNode;

      if (pairNode.tag === "Pair") {
        const keyNode = pairNode["1"] as AstNode;
        const valueNode = pairNode["2"] as AstNode;
        handleNode(keyNode);
        handleNode(valueNode, getIndexName(name, keyNode));
      } else {
        handleNode(pairNode);
      }
    }
  } else {
    handleNodes(node);
  }
}

/**
 * Adds `name` field to `Function` ast nodes when possible:
 * - Function assigned to a variable (doesn't matter if local or global): "foo".
 * - Function assigned to a field: "foo.bar.baz".
 *   Function can be in a table assigned to a variable or a field, e.g.
 *   `foo.bar = {baz = function() ... end}`.
 * - Otherwise: `undefined`.
 */
export function run(chstate: CheckStateInstance): void {
  handleNodes(chstate.ast);
}
