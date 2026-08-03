/**
 * Ported from luacheck's stages/linearize.lua: builds a linear control-flow
 * representation ("lines" of "items": Eval/Local/Set/OpSet/Noop/Jump/Cjump)
 * from the AST, resolves variable scoping (locals/upvalues/labels/gotos),
 * and warns about redefined/shadowed locals (411-433) and unused labels
 * (521). Exports the `LineInstance`/`Var`/`Value`/`Item` shapes that later
 * detect_*.lua and resolve_locals.lua ports will consume via
 * `chstate.lines`/`chstate.topLine`.
 *
 * Two Lua naming collisions to watch for when reading this against the
 * original: a `Var`'s `line` field is the enclosing `LineInstance` (the
 * function scope it was declared in), not a source line number - that
 * lives on `var.node.line`. And `LinState.lines`/`.scopes` are shared
 * `Stack`s reused across every nested `buildLine` call (not per-function),
 * which is how `leaveScope` tells a goto/break that escaped its own
 * function apart from one that's merely unresolved within an enclosing
 * scope of the *same* function.
 *
 * `LocalItem.accesses`/`.usedValues`/`.lines` are always-present `Map`s/
 * arrays here (never `undefined`, unlike upstream's `node[2] and {}`),
 * since the only downstream Lua consumers of these fields already gate on
 * `item.rhs` (not on the fields' own presence) or do a truthy-AND-lookup
 * that behaves identically against an empty table - see
 * resolve_locals.lua's `item.accesses and item.accesses[var]`. This drops
 * several `Item` fields from `T | undefined` to `T`, simplifying the port.
 *
 * A handful of upstream `assert()` calls (grammar-guaranteed invariants
 * with no bearing on control flow, e.g. `assert(expr.tag == "Index")`
 * after ruling out `"Id"`, or `assert(not pseudo_labels[name])` for a name
 * no valid Lua label token could ever equal) are dropped rather than
 * ported as runtime checks, per this port's "trust internal guarantees"
 * convention. The two checks at the end of `run` verify a real
 * cross-cutting invariant (the scope/line stacks end up balanced) and are
 * kept.
 */

import {
  type AstNode,
  type AstValue,
  type Range,
  SyntaxError,
} from "../parser.ts";
import type { CheckStateInstance } from "../check_state.ts";
import { arrayToSet, class as classImpl, Stack } from "../utils.ts";
import { luaFind } from "../lua_pattern.ts";

function syntaxError(msg: string, range: Range, prevRange?: Range): never {
  throw SyntaxError(msg, range, prevRange);
}

/** Length of an AST node's 1-based array part (mirrors parser.ts's private `astLen`). */
function astLen(node: AstNode): number {
  let n = 0;
  while (node[String(n + 1)] !== undefined) n++;
  return n;
}

/** Builds a node with a 1-based array part from `items` (mirrors parser.ts's private `arr`). */
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

function redefinedWarning(
  messageFormat: string,
): { message_format: string; fields: string[] } {
  return {
    message_format: messageFormat,
    fields: ["name", "prev_line", "prev_column", "prev_end_column", "self"],
  };
}

export const warnings: Record<
  string,
  { message_format: string; fields: string[] }
> = {
  "411": redefinedWarning(
    "variable {name!} was previously defined on line {prev_line}",
  ),
  "412": redefinedWarning(
    "variable {name!} was previously defined as an argument on line {prev_line}",
  ),
  "413": redefinedWarning(
    "variable {name!} was previously defined as a loop variable on line {prev_line}",
  ),
  "421": redefinedWarning(
    "shadowing definition of variable {name!} on line {prev_line}",
  ),
  "422": redefinedWarning(
    "shadowing definition of argument {name!} on line {prev_line}",
  ),
  "423": redefinedWarning(
    "shadowing definition of loop variable {name!} on line {prev_line}",
  ),
  "431": redefinedWarning("shadowing upvalue {name!} on line {prev_line}"),
  "432": redefinedWarning(
    "shadowing upvalue argument {name!} on line {prev_line}",
  ),
  "433": redefinedWarning(
    "shadowing upvalue loop variable {name!} on line {prev_line}",
  ),
  "521": { message_format: "unused label {label!}", fields: ["label"] },
};

export type VarKind = "var" | "arg" | "loop" | "loopi";
export type ValueKind = VarKind | "func";

/** Middle and last digit of the nine redefinition warning codes 411-433. */
const redefinedCodes = {
  "11": 411,
  "12": 412,
  "13": 413,
  "21": 421,
  "22": 422,
  "23": 423,
  "31": 431,
  "32": 432,
  "33": 433,
} as const;

const typeCodes = {
  var: "1",
  func: "1",
  arg: "2",
  loop: "3",
  loopi: "3",
} as const;

const pseudoLabels = arrayToSet(["do", "else", "break", "end", "return"]);

const tagToBoolean: Record<string, boolean> = {
  Nil: false,
  False: false,
  True: true,
  Number: true,
  String: true,
  Table: true,
  Function: true,
};

export interface Var {
  name: string;
  node: AstNode;
  type: VarKind;
  self?: boolean;
  /** The enclosing function scope, not a source line number - see module header. */
  line: LineInstance;
  hintUnused: boolean;
  scopeStart: number;
  scopeEnd?: number;
  values: Value[];
  accessed?: boolean;
  mutated?: boolean;
}

/** An array of secondary (unpacked) values, with a `used` flag stored directly on it. */
export type Secondaries = Value[] & { used?: boolean };

export interface Value {
  var: Var;
  varNode: AstNode;
  type: ValueKind;
  node?: AstNode;
  usingLines: Set<LineInstance>;
  empty: boolean;
  item: LocalItem | SetItem;
  secondaries?: Secondaries;
}

interface Label {
  name: string;
  range?: Range;
  index: number;
  used?: boolean;
}

interface GotoEntry {
  name: string;
  jump: JumpItem;
  range?: Range;
}

interface Scope {
  vars: Record<string, Var>;
  labels: Record<string, Label>;
  gotos: GotoEntry[];
  line: LineInstance;
}

export interface JumpItem {
  tag: "Jump" | "Cjump";
  to?: number;
}

export interface EvalItem {
  tag: "Eval";
  node: AstNode;
  accesses: Map<Var, AstNode[]>;
  usedValues: Map<Var, Value[]>;
  lines: LineInstance[];
}

export interface NoopItem {
  tag: "Noop";
  node: AstNode;
  loopEnd?: boolean;
}

export interface LocalItem {
  tag: "Local";
  node: AstNode;
  lhs: AstNode;
  rhs?: AstNode;
  accesses: Map<Var, AstNode[]>;
  usedValues: Map<Var, Value[]>;
  lines: LineInstance[];
  setVariables?: Map<Var, Value>;
}

export interface SetItem {
  tag: "Set" | "OpSet";
  node: AstNode;
  lhs: AstNode;
  rhs: AstNode;
  accesses: Map<Var, AstNode[]>;
  mutations: Map<Var, AstNode[]>;
  usedValues: Map<Var, Value[]>;
  lines: LineInstance[];
  setVariables?: Map<Var, Value>;
}

export type Item = JumpItem | EvalItem | NoopItem | LocalItem | SetItem;

/** Item shapes that can carry expression-scan results (`mark_access`/`mark_mutation` targets). */
export type ScanningItem = EvalItem | LocalItem | SetItem;

export type WalkCallback = (
  line: LineInstance,
  index: number,
  item: Item | undefined,
  ...args: unknown[]
) => boolean | void;

type StackInstance = ReturnType<typeof Stack>;

export interface LineInstance {
  accessedUpvalues: Map<Var, Item[]>;
  mutatedUpvalues: Map<Var, Item[]>;
  setUpvalues: Map<Var, Item[]>;
  lines: LineInstance[];
  node: AstNode;
  parent?: LineInstance;
  value?: Value;
  items: StackInstance;
  walk(
    visited: Record<number, boolean>,
    index: number,
    callback: WalkCallback,
    ...args: unknown[]
  ): void;
  [key: string]: unknown;
}

const Line = classImpl<LineInstance>();

Line.__init = function (
  obj: Record<string, unknown>,
  node: unknown,
  parent?: unknown,
  value?: unknown,
) {
  const self = obj as LineInstance;
  self.accessedUpvalues = new Map();
  self.mutatedUpvalues = new Map();
  self.setUpvalues = new Map();
  self.lines = [];
  self.node = node as AstNode;
  self.parent = parent as LineInstance | undefined;
  self.value = value as Value | undefined;
  self.items = Stack();
};

Line.walk = function (
  this: LineInstance,
  visited: Record<number, boolean>,
  index: number,
  callback: WalkCallback,
  ...args: unknown[]
): void {
  if (visited[index]) return;
  visited[index] = true;

  const item = this.items[index] as Item | undefined;

  if (callback(this, index, item, ...args)) return;

  if (!item) return;

  if (item.tag === "Jump") {
    this.walk(visited, item.to!, callback, ...args);
    return;
  } else if (item.tag === "Cjump") {
    this.walk(visited, item.to!, callback, ...args);
  }

  this.walk(visited, index + 1, callback, ...args);
};

function warnRedefined(
  chstate: CheckStateInstance,
  variable: Var,
  prevVar: Var,
  isSameScope: boolean,
): void {
  const middleDigit = isSameScope
    ? "1"
    : variable.line === prevVar.line
    ? "2"
    : "3";
  const code = redefinedCodes[`${middleDigit}${typeCodes[prevVar.type]}`];

  chstate.warnVar(
    code,
    { node: variable.node as Range, name: variable.name },
    compact({
      self: variable.self === true && prevVar.self === true ? true : undefined,
      prev_line: prevVar.node.line as number,
      prev_column: chstate.offsetToColumn(
        prevVar.node.line as number,
        prevVar.node.offset as number,
      ),
      prev_end_column: chstate.offsetToColumn(
        prevVar.node.line as number,
        prevVar.node.endOffset as number,
      ),
    }),
  );
}

function warnUnusedLabel(chstate: CheckStateInstance, label: Label): void {
  chstate.warnRange(521, label.range as Range, { label: label.name });
}

function newScope(line: LineInstance): Scope {
  return { vars: {}, labels: {}, gotos: [], line };
}

function newVar(line: LineInstance, node: AstNode, type_: VarKind): Var {
  const name = node["1"] as string;
  return {
    name,
    node,
    type: type_,
    self: node.implicit,
    line,
    hintUnused: type_ === "arg" && luaFind(name, "^_%a") !== undefined,
    scopeStart: line.items.size + 1,
    values: [],
  };
}

function newValue(
  varNode: AstNode,
  valueNode: AstNode | undefined,
  item: LocalItem | SetItem,
  isInit: boolean,
): Value {
  const varRef = varNode.var as Var;
  const value: Value = {
    var: varRef,
    varNode,
    type: isInit ? varRef.type : "var",
    node: valueNode,
    usingLines: new Set(),
    empty: isInit && !valueNode && varRef.type === "var",
    item,
  };

  if (valueNode && valueNode.tag === "Function") {
    value.type = "func";
    valueNode.value = value;
  }

  return value;
}

function newLabel(line: LineInstance, name: string, range?: Range): Label {
  return { name, range, index: line.items.size + 1 };
}

function newGoto(name: string, jump: JumpItem, range?: Range): GotoEntry {
  return { name, jump, range };
}

function newJumpItem(isConditional: boolean): JumpItem {
  return { tag: isConditional ? "Cjump" : "Jump" };
}

function newEvalItem(node: AstNode): EvalItem {
  return {
    tag: "Eval",
    node,
    accesses: new Map(),
    usedValues: new Map(),
    lines: [],
  };
}

function newNoopItem(node: AstNode, loopEnd?: boolean): NoopItem {
  return { tag: "Noop", node, loopEnd };
}

function newLocalItem(node: AstNode): LocalItem {
  return {
    tag: "Local",
    node,
    lhs: node["1"] as AstNode,
    rhs: node["2"] as AstNode | undefined,
    accesses: new Map(),
    usedValues: new Map(),
    lines: [],
  };
}

function newSetItem(node: AstNode): SetItem {
  return {
    tag: "Set",
    node,
    lhs: node["1"] as AstNode,
    rhs: node["2"] as AstNode,
    accesses: new Map(),
    mutations: new Map(),
    usedValues: new Map(),
    lines: [],
  };
}

function newOpsetItem(node: AstNode): SetItem {
  return {
    tag: "OpSet",
    node,
    lhs: node["1"] as AstNode,
    rhs: node["2"] as AstNode,
    accesses: new Map(),
    mutations: new Map(),
    usedValues: new Map(),
    lines: [],
  };
}

function isUnpacking(node: AstNode): boolean {
  return node.tag === "Dots" || node.tag === "Call" || node.tag === "Invoke";
}

export interface LinStateInstance {
  chstate: CheckStateInstance;
  lines: StackInstance;
  scopes: StackInstance;
  enterScope(): void;
  leaveScope(): void;
  registerVar(node: AstNode, type_: VarKind): Var;
  registerVars(nodes: AstNode, type_: VarKind): void;
  resolveVar(name: string): Var | undefined;
  checkVar(node: AstNode): Var | undefined;
  registerLabel(name: string, range?: Range): void;
  emit(item: Item): void;
  emitGoto(name: string, isConditional?: boolean, range?: Range): void;
  emitCondGoto(name: string, condNode: AstNode): void;
  emitNoop(node: AstNode, loopEnd?: boolean): void;
  emitStmt(stmt: AstNode): void;
  emitStmts(stmts: AstNode): void;
  emitBlock(block: AstNode): void;
  emitExpr(node: AstNode): void;
  emitExprs(exprs: AstNode): void;
  scanExpr(item: Item, node: AstNode): void;
  scanExprs(item: Item, nodes: AstNode): void;
  registerUpvalueAction(
    item: Item,
    variable: Var,
    key: "accessedUpvalues" | "mutatedUpvalues" | "setUpvalues",
  ): void;
  markAccess(item: ScanningItem, node: AstNode): void;
  markMutation(item: SetItem, node: AstNode): void;
  scanLhsIndex(item: SetItem, node: AstNode): void;
  registerSetVariables(): void;
  buildLine(node: AstNode): LineInstance;
  [key: string]: unknown;
}

const LinState = classImpl<LinStateInstance>();

LinState.__init = function (obj: Record<string, unknown>, chstate: unknown) {
  const self = obj as LinStateInstance;
  self.chstate = chstate as CheckStateInstance;
  self.lines = Stack();
  self.scopes = Stack();
};

LinState.enterScope = function (this: LinStateInstance) {
  this.scopes.push(newScope(this.lines.top as LineInstance));
};

LinState.leaveScope = function (this: LinStateInstance) {
  const leftScope = this.scopes.pop() as Scope;
  const prevScope = this.scopes.top as Scope | undefined;

  for (const goto_ of leftScope.gotos) {
    const label = leftScope.labels[goto_.name];

    if (label) {
      goto_.jump.to = label.index;
      label.used = true;
    } else {
      if (!prevScope || prevScope.line !== (this.lines.top as LineInstance)) {
        if (goto_.name === "break") {
          syntaxError("'break' is not inside a loop", goto_.range!);
        } else {
          syntaxError(`no visible label '${goto_.name}'`, goto_.range!);
        }
      }

      prevScope!.gotos.push(goto_);
    }
  }

  for (const name of Object.keys(leftScope.labels)) {
    const label = leftScope.labels[name];
    if (!label.used && !pseudoLabels[name]) {
      warnUnusedLabel(this.chstate, label);
    }
  }

  for (const name of Object.keys(leftScope.vars)) {
    leftScope.vars[name].scopeEnd = (this.lines.top as LineInstance).items
      .size;
  }
};

LinState.registerVar = function (
  this: LinStateInstance,
  node: AstNode,
  type_: VarKind,
): Var {
  const variable = newVar(this.lines.top as LineInstance, node, type_);
  const prevVar = this.resolveVar(variable.name);

  if (prevVar) {
    const isSameScope = (this.scopes.top as Scope).vars[variable.name];

    if (variable.name !== "...") {
      warnRedefined(this.chstate, variable, prevVar, !!isSameScope);
    }

    if (isSameScope) {
      prevVar.scopeEnd = (this.lines.top as LineInstance).items.size;
    }
  }

  (this.scopes.top as Scope).vars[variable.name] = variable;
  node.var = variable;
  return variable;
};

LinState.registerVars = function (
  this: LinStateInstance,
  nodes: AstNode,
  type_: VarKind,
) {
  const length = astLen(nodes);
  for (let i = 1; i <= length; i++) {
    this.registerVar(nodes[String(i)] as AstNode, type_);
  }
};

LinState.resolveVar = function (
  this: LinStateInstance,
  name: string,
): Var | undefined {
  for (let i = this.scopes.size; i >= 1; i--) {
    const scope = this.scopes[i] as Scope;
    const variable = scope.vars[name];
    if (variable) return variable;
  }
  return undefined;
};

LinState.checkVar = function (
  this: LinStateInstance,
  node: AstNode,
): Var | undefined {
  if (!node.var) {
    node.var = this.resolveVar(node["1"] as string);
  }

  return node.var as Var | undefined;
};

LinState.registerLabel = function (
  this: LinStateInstance,
  name: string,
  range?: Range,
) {
  const scope = this.scopes.top as Scope;
  const prevLabel = scope.labels[name];

  if (prevLabel) {
    syntaxError(
      `label '${name}' already defined on line ${prevLabel.range!.line}`,
      range!,
      prevLabel.range,
    );
  }

  scope.labels[name] = newLabel(this.lines.top as LineInstance, name, range);
};

LinState.emit = function (this: LinStateInstance, item: Item) {
  (this.lines.top as LineInstance).items.push(item);
};

LinState.emitGoto = function (
  this: LinStateInstance,
  name: string,
  isConditional?: boolean,
  range?: Range,
) {
  const jump = newJumpItem(!!isConditional);
  this.emit(jump);
  (this.scopes.top as Scope).gotos.push(newGoto(name, jump, range));
};

LinState.emitCondGoto = function (
  this: LinStateInstance,
  name: string,
  condNode: AstNode,
) {
  const condBool = condNode.tag !== undefined
    ? tagToBoolean[condNode.tag]
    : undefined;

  if (condBool !== true) {
    this.emitGoto(name, condBool !== false, condNode as Range);
  }
};

LinState.emitNoop = function (
  this: LinStateInstance,
  node: AstNode,
  loopEnd?: boolean,
) {
  this.emit(newNoopItem(node, loopEnd));
};

LinState.emitStmt = function (this: LinStateInstance, stmt: AstNode) {
  const handler = this[`emitStmt${stmt.tag}`] as (
    this: LinStateInstance,
    node: AstNode,
  ) => void;
  handler.call(this, stmt);
};

LinState.emitStmts = function (this: LinStateInstance, stmts: AstNode) {
  const length = astLen(stmts);
  for (let i = 1; i <= length; i++) {
    this.emitStmt(stmts[String(i)] as AstNode);
  }
};

LinState.emitBlock = function (this: LinStateInstance, block: AstNode) {
  this.enterScope();
  this.emitStmts(block);
  this.leaveScope();
};

LinState.emitStmtDo = function (this: LinStateInstance, node: AstNode) {
  this.emitNoop(node);
  this.emitBlock(node);
};

LinState.emitStmtWhile = function (this: LinStateInstance, node: AstNode) {
  this.emitNoop(node);
  this.enterScope();
  this.registerLabel("do");
  this.emitExpr(node["1"] as AstNode);
  this.emitCondGoto("break", node["1"] as AstNode);
  this.emitBlock(node["2"] as AstNode);
  this.emitNoop(node, true);
  this.emitGoto("do");
  this.registerLabel("break");
  this.leaveScope();
};

LinState.emitStmtRepeat = function (this: LinStateInstance, node: AstNode) {
  this.emitNoop(node);
  this.enterScope();
  this.registerLabel("do");
  this.enterScope();
  this.emitStmts(node["1"] as AstNode);
  this.emitExpr(node["2"] as AstNode);
  this.leaveScope();
  this.emitCondGoto("do", node["2"] as AstNode);
  this.registerLabel("break");
  this.leaveScope();
};

LinState.emitStmtFornum = function (this: LinStateInstance, node: AstNode) {
  this.emitNoop(node);
  this.emitExpr(node["2"] as AstNode);
  this.emitExpr(node["3"] as AstNode);

  if (node["5"] !== undefined) {
    this.emitExpr(node["4"] as AstNode);
  }

  this.enterScope();
  this.registerLabel("do");
  this.emitGoto("break", true);
  this.enterScope();
  this.emit(newLocalItem(arr(arr(node["1"] as AstNode))));
  this.registerVar(node["1"] as AstNode, "loopi");
  this.emitStmts((node["5"] ?? node["4"]) as AstNode);
  this.leaveScope();
  this.emitNoop(node, true);
  this.emitGoto("do");
  this.registerLabel("break");
  this.leaveScope();
};

LinState.emitStmtForin = function (this: LinStateInstance, node: AstNode) {
  this.emitNoop(node);
  this.emitExprs(node["2"] as AstNode);
  this.enterScope();
  this.registerLabel("do");
  this.emitGoto("break", true);
  this.enterScope();
  this.emit(newLocalItem(arr(node["1"] as AstNode)));
  this.registerVars(node["1"] as AstNode, "loop");
  this.emitStmts(node["3"] as AstNode);
  this.leaveScope();
  this.emitNoop(node, true);
  this.emitGoto("do");
  this.registerLabel("break");
  this.leaveScope();
};

LinState.emitStmtIf = function (this: LinStateInstance, node: AstNode) {
  this.emitNoop(node);
  this.enterScope();

  const length = astLen(node);
  for (let i = 1; i <= length - 1; i += 2) {
    this.enterScope();
    this.emitExpr(node[String(i)] as AstNode);
    this.emitCondGoto("else", node[String(i)] as AstNode);
    this.emitBlock(node[String(i + 1)] as AstNode);
    this.emitGoto("end");
    this.registerLabel("else");
    this.leaveScope();
  }

  if (length % 2 === 1) {
    this.emitBlock(node[String(length)] as AstNode);
  }

  this.registerLabel("end");
  this.leaveScope();
};

LinState.emitStmtLabel = function (this: LinStateInstance, node: AstNode) {
  this.registerLabel(node["1"] as string, node as Range);
};

LinState.emitStmtGoto = function (this: LinStateInstance, node: AstNode) {
  this.emitNoop(node);
  this.emitGoto(node["1"] as string, false, node as Range);
};

LinState.emitStmtBreak = function (this: LinStateInstance, node: AstNode) {
  this.emitGoto("break", false, node as Range);
};

LinState.emitStmtReturn = function (this: LinStateInstance, node: AstNode) {
  this.emitNoop(node);
  this.emitExprs(node);
  this.emitGoto("return");
};

LinState.emitExpr = function (this: LinStateInstance, node: AstNode) {
  const item = newEvalItem(node);
  this.scanExpr(item, node);
  this.emit(item);
};

LinState.emitExprs = function (this: LinStateInstance, exprs: AstNode) {
  const length = astLen(exprs);
  for (let i = 1; i <= length; i++) {
    this.emitExpr(exprs[String(i)] as AstNode);
  }
};

LinState.emitStmtCall = LinState.emitExpr;
LinState.emitStmtInvoke = LinState.emitExpr;

LinState.emitStmtLocal = function (this: LinStateInstance, node: AstNode) {
  const item = newLocalItem(node);
  this.emit(item);

  if (node["2"] !== undefined) {
    this.scanExprs(item, node["2"] as AstNode);
  }

  this.registerVars(node["1"] as AstNode, "var");
};

LinState.emitStmtLocalrec = function (this: LinStateInstance, node: AstNode) {
  const item = newLocalItem(node);
  this.registerVar((node["1"] as AstNode)["1"] as AstNode, "var");
  this.emit(item);
  this.scanExpr(item, (node["2"] as AstNode)["1"] as AstNode);
};

function emitSetLike(
  linstate: LinStateInstance,
  item: SetItem,
  node: AstNode,
): void {
  linstate.scanExprs(item, node["2"] as AstNode);

  const lhs = node["1"] as AstNode;
  const length = astLen(lhs);
  for (let i = 1; i <= length; i++) {
    const expr = lhs[String(i)] as AstNode;

    if (expr.tag === "Id") {
      const variable = linstate.checkVar(expr);

      if (variable) {
        linstate.registerUpvalueAction(item, variable, "setUpvalues");
      }
    } else {
      linstate.scanLhsIndex(item, expr);
    }
  }

  linstate.emit(item);
}

LinState.emitStmtSet = function (this: LinStateInstance, node: AstNode) {
  emitSetLike(this, newSetItem(node), node);
};

LinState.emitStmtOpSet = function (this: LinStateInstance, node: AstNode) {
  emitSetLike(this, newOpsetItem(node), node);
};

LinState.scanExpr = function (
  this: LinStateInstance,
  item: Item,
  node: AstNode,
) {
  const scanner = this[`scanExpr${node.tag}`] as
    | ((this: LinStateInstance, item: Item, node: AstNode) => void)
    | undefined;

  if (scanner) {
    scanner.call(this, item, node);
  }
};

LinState.scanExprs = function (
  this: LinStateInstance,
  item: Item,
  nodes: AstNode,
) {
  const length = astLen(nodes);
  for (let i = 1; i <= length; i++) {
    this.scanExpr(item, nodes[String(i)] as AstNode);
  }
};

LinState.registerUpvalueAction = function (
  this: LinStateInstance,
  item: Item,
  variable: Var,
  key: "accessedUpvalues" | "mutatedUpvalues" | "setUpvalues",
) {
  for (let i = this.lines.size; i >= 1; i--) {
    const line = this.lines[i] as LineInstance;
    if (line === variable.line) break;

    const map = line[key];
    if (!map.has(variable)) {
      map.set(variable, []);
    }
    map.get(variable)!.push(item);
  }
};

LinState.markAccess = function (
  this: LinStateInstance,
  item: ScanningItem,
  node: AstNode,
) {
  const variable = node.var as Var;
  variable.accessed = true;

  if (!item.accesses.has(variable)) {
    item.accesses.set(variable, []);
  }

  item.accesses.get(variable)!.push(node);
  this.registerUpvalueAction(item, variable, "accessedUpvalues");
};

LinState.markMutation = function (
  this: LinStateInstance,
  item: SetItem,
  node: AstNode,
) {
  const variable = node.var as Var;
  variable.mutated = true;

  if (!item.mutations.has(variable)) {
    item.mutations.set(variable, []);
  }

  item.mutations.get(variable)!.push(node);
  this.registerUpvalueAction(item, variable, "mutatedUpvalues");
};

LinState.scanExprId = function (
  this: LinStateInstance,
  item: ScanningItem,
  node: AstNode,
) {
  if (this.checkVar(node)) {
    this.markAccess(item, node);
  }
};

LinState.scanExprDots = function (
  this: LinStateInstance,
  item: ScanningItem,
  node: AstNode,
) {
  const dots = this.checkVar(node);

  if (!dots || dots.line !== (this.lines.top as LineInstance)) {
    syntaxError("cannot use '...' outside a vararg function", node as Range);
  }

  this.markAccess(item, node);
};

LinState.scanLhsIndex = function (
  this: LinStateInstance,
  item: SetItem,
  node: AstNode,
) {
  const base = node["1"] as AstNode;

  if (base.tag === "Id") {
    if (this.checkVar(base)) {
      this.markMutation(item, base);
    }
  } else if (base.tag === "Index") {
    this.scanLhsIndex(item, base);
  } else {
    this.scanExpr(item, base);
  }

  this.scanExpr(item, node["2"] as AstNode);
};

LinState.scanExprIndex = LinState.scanExprs;
LinState.scanExprCall = LinState.scanExprs;
LinState.scanExprInvoke = LinState.scanExprs;
LinState.scanExprParen = LinState.scanExprs;
LinState.scanExprTable = LinState.scanExprs;
LinState.scanExprPair = LinState.scanExprs;

LinState.scanExprOp = function (
  this: LinStateInstance,
  item: ScanningItem,
  node: AstNode,
) {
  this.scanExpr(item, node["2"] as AstNode);

  if (node["3"] !== undefined) {
    this.scanExpr(item, node["3"] as AstNode);
  }
};

LinState.scanExprOpSet = LinState.scanExprOp;

LinState.registerSetVariables = function (this: LinStateInstance) {
  const line = this.lines.top as LineInstance;

  for (let i = 1; i <= line.items.size; i++) {
    const item = line.items[i] as Item;

    if (item.tag !== "Local" && item.tag !== "Set" && item.tag !== "OpSet") {
      continue;
    }

    item.setVariables = new Map();

    const isInit = item.tag === "Local";
    let unpackingItem: AstNode | undefined;

    if (item.rhs) {
      const rhsLength = astLen(item.rhs);
      const lastRhsItem = item.rhs[String(rhsLength)] as AstNode;

      if (isUnpacking(lastRhsItem)) {
        unpackingItem = lastRhsItem;
      }
    }

    const lhsLength = astLen(item.lhs);
    const rhsLength = item.rhs ? astLen(item.rhs) : 0;
    let secondaries: Secondaries | undefined;

    if (unpackingItem && lhsLength > rhsLength) {
      secondaries = [];
    }

    for (let j = 1; j <= lhsLength; j++) {
      const node = item.lhs[String(j)] as AstNode;
      let value: Value | undefined;

      if (node.var) {
        if (item.tag === "OpSet") {
          this.markAccess(item, node);
        }

        const rhsNode = (item.rhs?.[String(j)] as AstNode | undefined) ??
          unpackingItem;
        value = newValue(node, rhsNode, item, isInit);
        item.setVariables.set(node.var as Var, value);
        (node.var as Var).values.push(value);
      }

      if (secondaries && j >= rhsLength) {
        if (value) {
          value.secondaries = secondaries;
          secondaries.push(value);
        } else {
          secondaries.used = true;
        }
      }
    }
  }
};

LinState.buildLine = function (
  this: LinStateInstance,
  node: AstNode,
): LineInstance {
  this.lines.push(Line(node, this.lines.top));
  this.enterScope();
  this.emit(newLocalItem(arr(node["1"] as AstNode)));
  this.enterScope();
  this.registerVars(node["1"] as AstNode, "arg");
  this.emitStmts(node["2"] as AstNode);
  this.leaveScope();
  this.registerLabel("return");
  this.leaveScope();
  this.registerSetVariables();
  const line = this.lines.pop() as LineInstance;

  for (let i = 1; i <= this.lines.size; i++) {
    (this.lines[i] as LineInstance).lines.push(line);
  }

  return line;
};

LinState.scanExprFunction = function (
  this: LinStateInstance,
  item: ScanningItem,
  node: AstNode,
) {
  const line = this.buildLine(node);
  item.lines.push(line);

  for (const nestedLine of line.lines) {
    item.lines.push(nestedLine);
  }
};

/**
 * Builds a linear representation ("line") of the AST and assigns it as
 * `chstate.topLine`. Assigns an array of all lines as `chstate.lines`.
 * Adds warnings for redefined/shadowed locals and unused labels.
 */
export function run(chstate: CheckStateInstance): void {
  const linstate = LinState(chstate);
  const dotsNode: AstNode = { tag: "Dots", "1": "..." };
  chstate.topLine = linstate.buildLine(arr(arr(dotsNode), chstate.ast));

  if (linstate.lines.size !== 0 || linstate.scopes.size !== 0) {
    throw new Error(
      "linearize: internal error, unbalanced lines/scopes stack",
    );
  }

  chstate.lines = [chstate.topLine as LineInstance];

  for (const nestedLine of (chstate.topLine as LineInstance).lines) {
    chstate.lines.push(nestedLine);
  }
}
