/**
 * Ported from luacheck's stages/detect_unbalanced_assignments.lua: warns
 * about assignments whose right side has more values than the left side
 * expects (531) or fewer (532, for plain `Set` statements only). It
 * walks `chstate.lines` via `eachStatement` from core_utils.ts.
 */

import type { AstNode, Range } from "../parser.ts";
import type { CheckStateInstance } from "../check_state.ts";
import { eachStatement } from "../core_utils.ts";

/** Length of an AST node's 1-based array part (mirrors parser.ts's private `astLen`). */
function astLen(node: AstNode): number {
  let n = 0;
  while (node[String(n + 1)] !== undefined) n++;
  return n;
}

function isUnpacking(node: AstNode): boolean {
  return node.tag === "Dots" || node.tag === "Call" || node.tag === "Invoke";
}

export const warnings: Record<
  string,
  { message_format: string; fields: string[] }
> = {
  "531": {
    message_format:
      "right side of assignment has more values than left side expects",
    fields: [],
  },
  "532": {
    message_format:
      "right side of assignment has less values than left side expects",
    fields: [],
  },
};

function checkAssignment(chstate: CheckStateInstance, node: AstNode): void {
  const rhs = node["2"] as AstNode | undefined;

  if (!rhs) {
    return;
  }

  const lhs = node["1"] as AstNode;

  if (astLen(rhs) > astLen(lhs)) {
    chstate.warnRange(531, node as Range);
  } else if (
    astLen(rhs) < astLen(lhs) && node.tag === "Set" &&
    !isUnpacking(rhs[String(astLen(rhs))] as AstNode)
  ) {
    chstate.warnRange(532, node as Range);
  }
}

export function run(chstate: CheckStateInstance): void {
  eachStatement(
    chstate,
    ["Set", "Local"],
    (cs, node) => checkAssignment(cs as CheckStateInstance, node),
  );
}
