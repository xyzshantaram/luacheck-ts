/**
 * Ported from luacheck's stages/detect_empty_blocks.lua: warns about
 * empty `do..end` blocks (541) and empty if branches (542). It walks
 * `chstate.lines` via `eachStatement` from core_utils.ts.
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

export const warnings: Record<
  string,
  { message_format: string; fields: string[] }
> = {
  "541": { message_format: "empty do..end block", fields: [] },
  "542": { message_format: "empty if branch", fields: [] },
};

function checkBlock(
  chstate: CheckStateInstance,
  block: AstNode,
  code: number,
): void {
  if (astLen(block) === 0) {
    chstate.warnRange(code, block as Range);
  }
}

function checkNode(chstate: CheckStateInstance, node: AstNode): void {
  if (node.tag === "Do") {
    checkBlock(chstate, node, 541);
    return;
  }

  for (let index = 2; index <= astLen(node); index += 2) {
    checkBlock(chstate, node[String(index)] as AstNode, 542);
  }

  if (astLen(node) % 2 === 1) {
    checkBlock(chstate, node[String(astLen(node))] as AstNode, 542);
  }
}

export function run(chstate: CheckStateInstance): void {
  eachStatement(
    chstate,
    ["Do", "If"],
    (cs, node) => checkNode(cs as CheckStateInstance, node),
  );
}
