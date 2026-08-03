/**
 * Ported from luacheck's stages/detect_uninit_accesses.lua: warns about
 * accesses (321) and mutations (341) that never resolve to any value
 * except the initial empty one - i.e. reads/writes of a variable along a
 * control-flow path where it was never actually assigned.
 */

import type { AstNode, Range } from "../parser.ts";
import type {
  EvalItem,
  LineInstance,
  LocalItem,
  SetItem,
  Var,
} from "./linearize.ts";
import type { CheckStateInstance } from "../check_state.ts";

export const warnings: Record<
  string,
  { message_format: string; fields: string[] }
> = {
  "321": {
    message_format: "accessing uninitialized variable {name!}",
    fields: ["name"],
  },
  "341": {
    message_format: "mutating uninitialized variable {name!}",
    fields: ["name"],
  },
};

function warnUninitAccesses(
  chstate: CheckStateInstance,
  item: EvalItem | LocalItem | SetItem,
  itemVarMap: Map<Var, AstNode[]>,
  code: 321 | 341,
): void {
  for (const [variable, accessingNodes] of itemVarMap) {
    // If there are no values at all reaching this access, not even the empty one,
    // this item (or a closure containing it) is not reachable from variable definition.
    // It will be reported as unreachable code, no need to report uninitialized accesses in it.
    const usedValues = item.usedValues.get(variable);
    if (!usedValues) continue;

    // If this variable has only one, empty value then it's already reported as never set,
    // no need to report each access.
    if (variable.values.length === 1 && variable.values[0].empty) continue;

    const allPossibleValuesEmpty = usedValues.every((value) => value.empty);

    if (allPossibleValuesEmpty) {
      for (const accessingNode of accessingNodes) {
        chstate.warnRange(code, accessingNode as Range, {
          name: accessingNode["1"] as string,
        });
      }
    }
  }
}

function detectUninitAccessInLine(
  chstate: CheckStateInstance,
  line: LineInstance,
): void {
  for (let i = 1; i <= line.items.size; i++) {
    const item = line.items[i] as EvalItem | LocalItem | SetItem;

    if ("accesses" in item) {
      warnUninitAccesses(chstate, item, item.accesses, 321);
    }
    if ("mutations" in item) {
      warnUninitAccesses(chstate, item, item.mutations, 341);
    }
  }
}

// Warns about accesses and mutations that don't resolve to any values except initial empty one.
export function run(chstate: CheckStateInstance): void {
  for (const line of chstate.lines) {
    detectUninitAccessInLine(chstate, line);
  }
}
