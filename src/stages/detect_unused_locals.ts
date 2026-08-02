/**
 * Ported from luacheck's stages/detect_unused_locals.lua: warns about
 * unused local variables and their values, locals that are accessed but
 * never set (or set but never accessed), and unused (mutually) recursive
 * functions. Reads the `used`/`mutated`/`overwritingItem` fields that
 * resolve_locals.ts adds to a `Value` (see `ResolvedValue` there), so this
 * stage must run after both linearize.ts and resolve_locals.ts.
 *
 * `mark_reachable_lines`'s two callers rely on Lua's
 * `setmetatable({}, {__index = marked})` to make a fresh, empty overlay
 * table transparently fall back to an outer `marked` table on reads while
 * writes (`marked[connected_line] = true`, no `__newindex`) land on the
 * overlay alone; `rawget` after both DFS calls then reads only what the
 * overlay itself collected. There is no direct JS equivalent, so
 * `markReachableLines` below takes the overlay (`marked`, always written
 * to and iterated) and the outer table (`globallyMarked`, read-only, used
 * only to short-circuit the DFS) as two separate parameters instead: the
 * two top-level calls in `detectUnusedRecFuncs` that operate on the real
 * `marked` set pass no `globallyMarked`, while the two per-closure calls
 * that build `forwardMarked`/`backwardMarked` overlays pass the outer
 * `marked` set as `globallyMarked`.
 */

import type { AstNode, Range } from "../parser.ts";
import type { CheckStateInstance, Warning } from "../check_state.ts";
import type {
  Item,
  LineInstance,
  LocalItem,
  SetItem,
  Value,
  Var,
} from "./linearize.ts";
import type { ResolvedValue } from "./resolve_locals.ts";
import { arrayToSet } from "../utils.ts";

/** Length of an AST node's 1-based array part (mirrors parser.ts's private `astLen`). */
function astLen(node: AstNode): number {
  let n = 0;
  while (node[String(n + 1)] !== undefined) n++;
  return n;
}

function unusedLocalMessageFormat(warning: Warning): string {
  if (warning.func) {
    if (warning.recursive) {
      return "unused recursive function {name!}";
    } else if (warning.mutually_recursive) {
      return "unused mutually recursive function {name!}";
    } else {
      return "unused function {name!}";
    }
  } else {
    return "unused variable {name!}";
  }
}

function unusedArgMessageFormat(warning: Warning): string {
  if (warning.name === "...") {
    return "unused variable length argument";
  } else {
    return "unused argument {name!}";
  }
}

/**
 * Wider than the `{message_format: string; fields: string[]}` shape used
 * by other stages' `warnings` exports: several of this stage's entries
 * have a `message_format` function instead of a plain string.
 */
interface WarningEntry {
  message_format: string | ((warning: Warning) => string);
  fields: string[];
}

function unusedOrOverwrittenWarning(messageFormat: string): WarningEntry {
  return {
    message_format: (warning: Warning): string => {
      if (warning.overwritten_line) {
        return `${messageFormat} is overwritten on line ` +
          "{overwritten_line} before use";
      } else {
        return `${messageFormat} is unused`;
      }
    },
    fields: [
      "name",
      "secondary",
      "overwritten_line",
      "overwritten_column",
      "overwritten_end_column",
    ],
  };
}

export const warnings: Record<string, WarningEntry> = {
  "211": {
    message_format: unusedLocalMessageFormat,
    fields: [
      "name",
      "func",
      "secondary",
      "useless",
      "recursive",
      "mutually_recursive",
    ],
  },
  "212": { message_format: unusedArgMessageFormat, fields: ["name", "self"] },
  "213": { message_format: "unused loop variable {name!}", fields: ["name"] },
  "214": {
    message_format: "used variable {name!} with unused hint",
    fields: ["name"],
  },
  "221": {
    message_format: "variable {name!} is never set",
    fields: ["name", "secondary"],
  },
  "231": {
    message_format: "variable {name!} is never accessed",
    fields: ["name", "secondary"],
  },
  "232": {
    message_format: "argument {name!} is never accessed",
    fields: ["name"],
  },
  "233": {
    message_format: "loop variable {name!} is never accessed",
    fields: ["name"],
  },
  "241": {
    message_format: "variable {name!} is mutated but never accessed",
    fields: ["name", "secondary"],
  },
  "311": unusedOrOverwrittenWarning("value assigned to variable {name!}"),
  "312": unusedOrOverwrittenWarning("value of argument {name!}"),
  "313": unusedOrOverwrittenWarning("value of loop variable {name!}"),
  "331": {
    message_format:
      "value assigned to variable {name!} is mutated but never accessed",
    fields: ["name", "secondary"],
  },
};

function isSecondary(value: Value): boolean | undefined {
  return value.secondaries?.used;
}

const typeCodes: Record<string, string> = {
  var: "1",
  func: "1",
  arg: "2",
  loop: "3",
  loopi: "3",
};

function varRef(variable: Var): { node: Range; name: string } {
  return { node: variable.node as Range, name: variable.name };
}

function valueRef(value: Value): { varNode: Range; var: { name: string } } {
  return { varNode: value.varNode as Range, var: { name: value.var.name } };
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

function warnUnusedVar(
  chstate: CheckStateInstance,
  value: ResolvedValue,
  isUseless?: boolean,
): void {
  chstate.warnValue(
    Number(`21${typeCodes[value.var.type]}`),
    valueRef(value),
    compact({
      secondary: isSecondary(value) || undefined,
      func: value.type === "func" || undefined,
      self: value.var.self,
      useless: (value.var.name === "_" && isUseless) ? isUseless : undefined,
    }),
  );
}

function warnUnaccessedVar(
  chstate: CheckStateInstance,
  variable: Var,
  isMutated?: boolean,
): void {
  // Mark as secondary if all assigned values are secondary.
  // It is guaranteed that there are at least two values.
  let secondary: true | undefined = true;

  for (const value of variable.values) {
    if (!value.empty && !isSecondary(value)) {
      secondary = undefined;
      break;
    }
  }

  chstate.warnVar(
    Number(`2${isMutated ? "4" : "3"}${typeCodes[variable.type]}`),
    varRef(variable),
    compact({ secondary }),
  );
}

function warnUnusedValue(
  chstate: CheckStateInstance,
  value: ResolvedValue,
  overwritingNode?: AstNode,
): void {
  const warning = chstate.warnValue(
    Number(`3${value.mutated ? "3" : "1"}${typeCodes[value.type]}`),
    valueRef(value),
    compact({ secondary: isSecondary(value) || undefined }),
  );

  if (overwritingNode) {
    warning.overwritten_line = overwritingNode.line;
    warning.overwritten_column = chstate.offsetToColumn(
      overwritingNode.line as number,
      overwritingNode.offset as number,
    );
    warning.overwritten_end_column = chstate.offsetToColumn(
      overwritingNode.line as number,
      overwritingNode.endOffset as number,
    );
  }
}

/**
 * Returns `true` if a variable should be reported as a function instead of
 * simply local, `false` otherwise. A variable is considered a function if
 * it has a single assignment and the value is a function, or if there is a
 * forward declaration with a function assignment later.
 */
function isFunctionVar(variable: Var): boolean {
  return (
    (variable.values.length === 1 && variable.values[0].type === "func") ||
    (variable.values.length === 2 && variable.values[0].empty &&
      variable.values[1].type === "func")
  );
}

const externallyAccessibleTags = arrayToSet([
  "Id",
  "Index",
  "Call",
  "Invoke",
  "Op",
  "Paren",
  "Dots",
]);

function isExternallyAccessible(value: Value): boolean {
  return value.type !== "var" ||
    !!(value.node && externallyAccessibleTags[value.node.tag as string]);
}

function getOverwritingLhsNode(
  item: LocalItem | SetItem,
  value: Value,
): AstNode | undefined {
  const length = astLen(item.lhs);

  for (let i = 1; i <= length; i++) {
    const node = item.lhs[String(i)] as AstNode;

    if ((node.var as Var | undefined) === value.var) {
      return node;
    }
  }

  return undefined;
}

function getSecondOverwritingLhsNode(
  item: LocalItem | SetItem,
  value: Value,
): AstNode | undefined {
  let afterValueNode = false;
  const length = astLen(item.lhs);

  for (let i = 1; i <= length; i++) {
    const node = item.lhs[String(i)] as AstNode;

    if ((node.var as Var | undefined) === value.var) {
      if (afterValueNode) {
        return node;
      } else if (node === value.varNode) {
        afterValueNode = true;
      }
    }
  }

  return undefined;
}

function detectUnusedLocal(chstate: CheckStateInstance, variable: Var): void {
  const values = variable.values as ResolvedValue[];

  if (isFunctionVar(variable)) {
    const value = values[1] ?? values[0];

    if (!value.used) {
      warnUnusedVar(chstate, value);
    }
  } else if (values.length === 1) {
    const value = values[0];

    if (variable.hintUnused && variable.name !== "_ENV") {
      if (value.used) {
        chstate.warnVar(214, varRef(variable));
      }
    } else if (!value.used) {
      if (value.mutated) {
        if (!isExternallyAccessible(value)) {
          warnUnaccessedVar(chstate, variable, true);
        }
      } else {
        warnUnusedVar(chstate, value, value.empty);
      }
    } else if (value.empty) {
      chstate.warnVar(221, varRef(variable));
    }
  } else if (!variable.accessed && !variable.mutated) {
    warnUnaccessedVar(chstate, variable);
  } else {
    let noValuesExternallyAccessible = true;

    for (const value of values) {
      if (isExternallyAccessible(value)) {
        noValuesExternallyAccessible = false;
      }
    }

    if (!variable.accessed && noValuesExternallyAccessible) {
      warnUnaccessedVar(chstate, variable, true);
    }

    for (const value of values) {
      if (!value.empty && !value.used) {
        if (!value.mutated) {
          let overwritingNode: AstNode | undefined;

          if (value.overwritingItem) {
            if (value.overwritingItem !== value.item) {
              overwritingNode = getOverwritingLhsNode(
                value.overwritingItem,
                value,
              );
            }
          } else {
            overwritingNode = getSecondOverwritingLhsNode(value.item, value);
          }

          warnUnusedValue(chstate, value, overwritingNode);
        } else if (!isExternallyAccessible(value)) {
          if (variable.accessed || !noValuesExternallyAccessible) {
            warnUnusedValue(chstate, value);
          }
        }
      }
    }
  }
}

function detectUnusedLocalsInLine(
  chstate: CheckStateInstance,
  line: LineInstance,
): void {
  for (let i = 1; i <= line.items.size; i++) {
    const item = line.items[i] as Item;

    if (item.tag === "Local") {
      for (const variable of item.setVariables!.keys()) {
        // Do not check the implicit top level vararg.
        if (variable.node.line) {
          detectUnusedLocal(chstate, variable);
        }
      }
    }
  }
}

function detectUnusedLocals(chstate: CheckStateInstance): void {
  for (const line of chstate.lines) {
    detectUnusedLocalsInLine(chstate, line);
  }
}

type EdgeMap = Map<LineInstance, Set<LineInstance>>;

/**
 * DFS-marks lines reachable from `line` via `edges` into the `marked`
 * overlay. `globallyMarked`, when given, is consulted (but never written)
 * to short-circuit descending into lines some outer call already marked -
 * see the module header for why this replaces a Lua `setmetatable`/
 * `__index` overlay.
 */
function markReachableLines(
  edges: EdgeMap,
  marked: Set<LineInstance>,
  line: LineInstance,
  globallyMarked?: Set<LineInstance>,
): void {
  for (const connectedLine of edges.get(line)!) {
    if (!marked.has(connectedLine) && !globallyMarked?.has(connectedLine)) {
      marked.add(connectedLine);
      markReachableLines(edges, marked, connectedLine, globallyMarked);
    }
  }
}

/**
 * Build a graph of usage relations of all closures. Closure A is used by
 * closure B iff either B is parent of A and A is not assigned to a
 * local/upvalue, or B uses local/upvalue value that is A. Closures not
 * reachable from root closure are unused, report corresponding
 * values/variables if not done already.
 */
function detectUnusedRecFuncs(chstate: CheckStateInstance): void {
  const line = chstate.topLine;

  // Initialize edges maps.
  const forwardEdges: EdgeMap = new Map([[line, new Set()]]);
  const backwardEdges: EdgeMap = new Map([[line, new Set()]]);

  for (const nestedLine of line.lines) {
    forwardEdges.set(nestedLine, new Set());
    backwardEdges.set(nestedLine, new Set());
  }

  // Add edges leading to each nested line.
  for (const nestedLine of line.lines) {
    const value = nestedLine.node.value as ResolvedValue | undefined;

    if (value) {
      for (const usingLine of value.usingLines) {
        forwardEdges.get(usingLine)!.add(nestedLine);
        backwardEdges.get(nestedLine)!.add(usingLine);
      }
    } else if (nestedLine.parent) {
      forwardEdges.get(nestedLine.parent)!.add(nestedLine);
      backwardEdges.get(nestedLine)!.add(nestedLine.parent);
    }
  }

  // Recursively mark all closures reachable from root closure and unused
  // closures. Closures reachable from main chunk are used; closures
  // reachable from unused closures depend on that closure, that is, fixing
  // the warning about the parent unused closure fixes the warning about
  // the child one, so issuing a warning for the child is superfluous.
  const marked = new Set<LineInstance>([line]);
  markReachableLines(forwardEdges, marked, line);

  for (const nestedLine of line.lines) {
    const value = nestedLine.node.value as ResolvedValue | undefined;

    if (value && !value.used) {
      marked.add(nestedLine);
      markReachableLines(forwardEdges, marked, nestedLine);
    }
  }

  // Deal with unused closures.
  for (const nestedLine of line.lines) {
    let value = nestedLine.node.value as ResolvedValue | undefined;

    if (value && value.used && !marked.has(nestedLine)) {
      // This closure is used by some closure, but is not marked as
      // reachable from main chunk or any of reported closures. Find the
      // candidate group of mutually recursive functions containing this
      // one: mark the sets of closures reachable from it by forward and
      // backward edges, intersect them. Ignore already marked closures in
      // the process to avoid issuing superfluous, dependent warnings.
      const forwardMarked = new Set<LineInstance>();
      const backwardMarked = new Set<LineInstance>();
      markReachableLines(forwardEdges, forwardMarked, nestedLine, marked);
      markReachableLines(backwardEdges, backwardMarked, nestedLine, marked);

      // Iterate over closures in the group.
      for (const mutRecLine of forwardMarked) {
        if (backwardMarked.has(mutRecLine)) {
          marked.add(mutRecLine);
          value = mutRecLine.node.value as ResolvedValue | undefined;

          if (value) {
            // Report this closure as self recursive or mutually recursive.
            const isSelfRecursive = forwardEdges.get(mutRecLine)!.has(
              mutRecLine,
            );

            if (isFunctionVar(value.var)) {
              chstate.warnValue(
                211,
                valueRef(value),
                compact({
                  func: true,
                  mutually_recursive: !isSelfRecursive || undefined,
                  recursive: isSelfRecursive || undefined,
                }),
              );
            } else {
              chstate.warnValue(311, valueRef(value));
            }
          }
        }
      }
    }
  }
}

/**
 * Warns about unused local variables and their values as well as locals
 * that are accessed but never set or set but never accessed. Warns about
 * unused recursive functions.
 */
export function run(chstate: CheckStateInstance): void {
  detectUnusedLocals(chstate);
  detectUnusedRecFuncs(chstate);
}
