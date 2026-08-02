/**
 * Ported from luacheck's stages/resolve_locals.lua: connects assignments to
 * locals/upvalues with accesses that may use the assigned value, by
 * propagating each assignment/closure-creation forward along the flow
 * graph built by linearize.ts and recording every access/mutation it can
 * reach. See the Lua source's own header comment (kept below per-function)
 * for the main/closure, access/assignment terminology this file uses.
 *
 * `resolve_locals.lua` mutates `Value` objects with `used`/`mutated`/
 * `overwriting_item` fields that aren't part of the shape linearize.ts
 * constructs them with; `ResolvedValue` below is a local, optional-fields
 * superset used instead of widening linearize.ts's exported `Value`.
 *
 * `main_assignment_propagation_callback`/`closure_creation_propagation_callback`
 * are passed to `LineInstance.walk`, whose `WalkCallback` type only
 * declares `...args: unknown[]` for callback-specific extra arguments; both
 * are cast to `WalkCallback` at their `line.walk(...)` call sites since
 * their concrete extra-argument types are narrower than `unknown[]`.
 */

import type { AstNode } from "../parser.ts";
import type { CheckStateInstance } from "../check_state.ts";
import type {
  Item,
  LineInstance,
  LocalItem,
  ScanningItem,
  SetItem,
  Value,
  Var,
  WalkCallback,
} from "./linearize.ts";

/** Length of an AST node's 1-based array part (mirrors parser.ts's private `astLen`). */
function astLen(node: AstNode): number {
  let n = 0;
  while (node[String(n + 1)] !== undefined) n++;
  return n;
}

/** Fields resolve_locals.lua adds to a `Value` at analysis time. */
type ResolvedValue = Value & {
  used?: boolean;
  mutated?: boolean;
  overwritingItem?: LocalItem | SetItem | false;
};

function registerValue(
  usedValues: Map<Var, Value[]>,
  variable: Var,
  value: Value,
): void {
  if (!usedValues.has(variable)) {
    usedValues.set(variable, []);
  }

  usedValues.get(variable)!.push(value);
}

/**
 * Called when assignment of `value` is connected to an access. `item`
 * contains the access, and `line` contains the item.
 */
function addResolution(
  line: LineInstance,
  item: ScanningItem,
  variable: Var,
  value: ResolvedValue,
  isMutation?: boolean,
): void {
  registerValue(item.usedValues, variable, value);

  if (isMutation) {
    value.mutated = true;
  } else {
    value.used = true;
  }

  value.usingLines.add(line);

  if (value.secondaries) {
    value.secondaries.used = true;
  }
}

/**
 * Connects accesses in the given items array with an assignment of
 * `value`. `items` may be `undefined` instead of empty.
 */
function addResolutions(
  line: LineInstance,
  items: Item[] | undefined,
  variable: Var,
  value: ResolvedValue,
  isMutation?: boolean,
): void {
  if (!items) return;

  for (const item of items) {
    addResolution(line, item as ScanningItem, variable, value, isMutation);
  }
}

/**
 * Connects all accesses (and mutations) in `accessLine` with corresponding
 * assignments in `setLine`.
 */
function crossResolveClosures(
  accessLine: LineInstance,
  setLine: LineInstance,
): void {
  for (const [variable, settingItems] of setLine.setUpvalues) {
    for (const settingItem of settingItems) {
      const value = (settingItem as SetItem).setVariables!.get(variable)!;

      addResolutions(
        accessLine,
        accessLine.accessedUpvalues.get(variable),
        variable,
        value,
      );
      addResolutions(
        accessLine,
        accessLine.mutatedUpvalues.get(variable),
        variable,
        value,
        true,
      );
    }
  }
}

function inScope(variable: Var, index: number): boolean {
  return variable.scopeStart <= index && index <= variable.scopeEnd!;
}

function containsCall(node: AstNode): boolean {
  const cached = node["_contains_call"];

  if (cached !== undefined) {
    return cached as boolean;
  }

  if (node.tag === "Call" || node.tag === "Invoke") {
    node["_contains_call"] = true;
    return true;
  }

  if (node.tag !== "Function") {
    const length = astLen(node);

    for (let i = 1; i <= length; i++) {
      const subNode = node[String(i)];

      if (
        typeof subNode === "object" && subNode !== null &&
        containsCall(subNode as AstNode)
      ) {
        node["_contains_call"] = true;
        return true;
      }
    }
  }

  node["_contains_call"] = false;
  return false;
}

function isCircularReference(item: Item, variable: Var): boolean {
  // OpSet is circular by definition.
  if (item.tag !== "Set" && item.tag !== "Local") {
    return false;
  }

  // No support for matching multiple assignment to the specific assignment.
  if (
    !item.lhs || astLen(item.lhs) !== 1 || !item.rhs || astLen(item.rhs) !== 1
  ) {
    return false;
  }

  // Case t[t.function()] = t.func(). Functions can have side-effects, so this isn't purely circular.
  const rightAssignment = item.rhs["1"] as AstNode;

  if (containsCall(rightAssignment)) {
    return false;
  }

  const leftAssignment = item.lhs["1"] as AstNode;

  if (containsCall(leftAssignment)) {
    return false;
  }

  const node = leftAssignment["1"] as AstNode;
  return node.var === variable;
}

/** Called when main assignment propagation reaches a line item. */
function mainAssignmentPropagationCallback(
  line: LineInstance,
  index: number,
  item: Item | undefined,
  variable: Var,
  value: ResolvedValue,
): boolean | void {
  // Check entrance condition.
  if (!inScope(variable, index)) {
    // Assignment reaches the end of variable scope, so it can't be dominated by any assignment.
    value.overwritingItem = false;
    return true;
  }

  // Assignment reaches this item, apply its effect. `variable.scopeEnd` is
  // always <= the line's item count (set by linearize.ts's leaveScope), so
  // `inScope` returning true here guarantees `item` is defined.
  const definedItem = item!;

  // Accesses (and mutations) of the variable can resolve to reaching assignment.
  if ("accesses" in definedItem && definedItem.accesses.has(variable)) {
    if (!isCircularReference(definedItem, variable)) {
      addResolution(line, definedItem, variable, value);
    }
  }

  if ("mutations" in definedItem && definedItem.mutations.has(variable)) {
    addResolution(line, definedItem, variable, value, true);
  }

  // Accesses (and mutations) of the variable inside closures created in
  // this item can resolve to reaching assignment.
  if ("lines" in definedItem) {
    for (const createdLine of definedItem.lines) {
      if (!isCircularReference(definedItem, variable)) {
        addResolutions(
          createdLine,
          createdLine.accessedUpvalues.get(variable),
          variable,
          value,
        );
      }

      addResolutions(
        createdLine,
        createdLine.mutatedUpvalues.get(variable),
        variable,
        value,
        true,
      );
    }
  }

  // Check exit condition.
  if (
    "setVariables" in definedItem && definedItem.setVariables &&
    definedItem.setVariables.has(variable)
  ) {
    if (value.overwritingItem !== false) {
      if (value.overwritingItem && value.overwritingItem !== definedItem) {
        value.overwritingItem = false;
      } else {
        value.overwritingItem = definedItem;
      }
    }

    return true;
  }
}

/**
 * Connects main assignments with main accesses and closure accesses in
 * reachable closures. Additionally, sets the `overwritingItem` field of
 * values to an item with an assignment overwriting the value, but only if
 * the overwriting is not avoidable (i.e. it's impossible to reach the end
 * of the function from the first assignment without going through the
 * second one). Otherwise the value of the field may be `false` or
 * `undefined`.
 */
function propagateMainAssignments(line: LineInstance): void {
  for (let i = 1; i <= line.items.size; i++) {
    const item = line.items[i] as Item;

    if ("setVariables" in item && item.setVariables) {
      for (const [variable, value] of item.setVariables) {
        if (variable.line === line) {
          // Assignments are not live at their own item, because assignments
          // take effect only after all accesses are evaluated. Items with
          // assignments can't be jumps, so they have a single following
          // item with incremented index.
          line.walk(
            {},
            i + 1,
            mainAssignmentPropagationCallback as WalkCallback,
            variable,
            value,
          );
        }
      }
    }
  }
}

/** Called when closure creation propagation reaches a line item. */
function closureCreationPropagationCallback(
  line: LineInstance,
  _index: number,
  item: Item | undefined,
  propagatedLine: LineInstance,
): boolean | void {
  if (!item) {
    return true;
  }

  // Closure creation reaches this item, apply its effects.

  // Accesses (and mutations) of upvalues in the propagated closure can resolve to assignments in the item.
  if ("setVariables" in item && item.setVariables) {
    for (const [variable, value] of item.setVariables) {
      addResolutions(
        propagatedLine,
        propagatedLine.accessedUpvalues.get(variable),
        variable,
        value,
      );
      addResolutions(
        propagatedLine,
        propagatedLine.mutatedUpvalues.get(variable),
        variable,
        value,
        true,
      );
    }
  }

  if ("lines" in item) {
    for (const createdLine of item.lines) {
      // Accesses (and mutations) of upvalues in the propagated closure can
      // resolve to assignments in closures created in the item.
      crossResolveClosures(propagatedLine, createdLine);

      // Accesses (and mutations) of upvalues in closures created in the
      // item can resolve to assignments in the propagated closure.
      crossResolveClosures(createdLine, propagatedLine);
    }
  }

  // Accesses (and mutations) of locals in the item can resolve to assignments in the propagated closure.
  for (const [variable, settingItems] of propagatedLine.setUpvalues) {
    if ("accesses" in item && item.accesses.has(variable)) {
      for (const settingItem of settingItems) {
        const value = (settingItem as SetItem).setVariables!.get(variable)!;
        addResolution(line, item, variable, value);
      }
    }

    if ("mutations" in item && item.mutations.has(variable)) {
      for (const settingItem of settingItems) {
        const value = (settingItem as SetItem).setVariables!.get(variable)!;
        addResolution(line, item, variable, value, true);
      }
    }
  }
}

/**
 * Connects main assignments with closure accesses in reaching closures.
 * Connects closure assignments with main accesses and with closure accesses
 * in reachable closures. Connects closure accesses with closure assignments
 * in reachable closures.
 */
function propagateClosureCreations(line: LineInstance): void {
  for (let i = 1; i <= line.items.size; i++) {
    const item = line.items[i] as Item;

    if ("lines" in item) {
      for (const createdLine of item.lines) {
        // Closures are live at the item they are created, as they can be called immediately.
        line.walk(
          {},
          i,
          closureCreationPropagationCallback as WalkCallback,
          createdLine,
        );
      }
    }
  }
}

function analyzeLine(line: LineInstance): void {
  propagateMainAssignments(line);
  propagateClosureCreations(line);
}

/** Finds reaching assignments for all local variable accesses. */
export function run(chstate: CheckStateInstance): void {
  for (const line of chstate.lines) {
    analyzeLine(line);
  }
}
