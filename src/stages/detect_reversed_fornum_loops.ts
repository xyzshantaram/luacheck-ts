/**
 * Ported from luacheck's stages/detect_reversed_fornum_loops.lua: warns
 * about numeric for loops going from `#(expr)` down to a limit of 1 or
 * less with a non-negative step (warning 571). It walks `chstate.lines`
 * via `eachStatement` from core_utils.ts.
 */

import type { AstNode, Range } from "../parser.ts";
import type { CheckStateInstance } from "../check_state.ts";
import { eachStatement, evalConstNode } from "../core_utils.ts";

export const warnings: Record<
  string,
  { message_format: string; fields: string[] }
> = {
  "571": {
    message_format:
      "numeric for loop goes from #(expr) down to {limit} but loop step is not negative",
    fields: ["limit"],
  },
};

function checkFornum(chstate: CheckStateInstance, node: AstNode): void {
  const start = node["2"] as AstNode;

  if (start.tag !== "Op" || start["1"] !== "len") {
    return;
  }

  const limitResult = evalConstNode(node["3"] as AstNode);
  const limit = limitResult?.[0];
  const limitRepr = limitResult?.[1];

  if (limit === undefined || (limit as number) > 1) {
    return;
  }

  let step: string | number | boolean | undefined = 1;

  if (node["5"] !== undefined) {
    step = evalConstNode(node["4"] as AstNode)?.[0];
  }

  if (step !== undefined && (step as number) >= 0) {
    chstate.warnRange(571, node as Range, { limit: limitRepr });
  }
}

export function run(chstate: CheckStateInstance): void {
  eachStatement(
    chstate,
    ["Fornum"],
    (cs, node) => checkFornum(cs as CheckStateInstance, node),
  );
}
