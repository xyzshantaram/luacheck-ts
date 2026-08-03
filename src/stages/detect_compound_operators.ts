/**
 * Ported from luacheck's stages/detect_compound_operators.lua: warns
 * about assignments that use a compound operator such as `+=` or `..=`
 * (warning 033). It walks `chstate.lines` via `eachStatement` from
 * core_utils.ts.
 */

import type { AstNode, Range } from "../parser.ts";
import type { CheckStateInstance } from "../check_state.ts";
import { eachStatement } from "../core_utils.ts";

export const warnings: Record<
  string,
  { message_format: string; fields: string[] }
> = {
  "033": {
    message_format: "assignment uses compound operator {operator}",
    fields: ["operator"],
  },
};

// The reverse of parser.ts's own `compoundOperators` table.
const reverseCompoundOperators: Record<string, string> = {
  add: "+=",
  sub: "-=",
  mul: "*=",
  mod: "%=",
  pow: "^=",
  div: "/=",
  idiv: "//=",
  band: "&=",
  bor: "|=",
  bxor: "~=",
  shl: "<<=",
  shr: ">>=",
  concat: "..=",
};

function checkNode(chstate: CheckStateInstance, node: AstNode): void {
  const operator = reverseCompoundOperators[node["3"] as string];
  chstate.warnRange(33, node as Range, { operator });
}

export function run(chstate: CheckStateInstance): void {
  eachStatement(
    chstate,
    ["OpSet"],
    (cs, node) => checkNode(cs as CheckStateInstance, node),
  );
}
