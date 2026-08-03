/**
 * Ported from luacheck's stages/detect_cyclomatic_complexity.lua: warns
 * about functions whose cyclomatic complexity is too high (561), counting
 * decision points (`and`/`or` operators, `if`/`while`/`repeat`/`for`
 * branches) plus one per function, and naming the function via the
 * `Function` AST node's `name` field set by stages/name_functions.ts.
 *
 * One metric instance is created per `run` call and reused across every
 * line in `chstate.lines`; `report` resets its `count` to 1 per line,
 * mirrors upstream's single `ccmetric` created once outside the loop.
 * The `calcStmt`/`calcItem` dispatch skips tags without a handler: only
 * the five statement tags and three item tags upstream handles count.
 */

import type { AstNode, Range } from "../parser.ts";
import type { CheckStateInstance, Warning } from "../check_state.ts";
import type {
  EvalItem,
  Item,
  LineInstance,
  LocalItem,
  SetItem,
} from "./linearize.ts";
import { class as classImpl } from "../utils.ts";
import type { Stack } from "../utils.ts";

/** Length of an AST node's 1-based array part (mirrors parser.ts's private `astLen`). */
function astLen(node: AstNode): number {
  let n = 0;
  while (node[String(n + 1)] !== undefined) n++;
  return n;
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

function cyclomaticComplexityMessageFormat(warning: Warning): string {
  // Registered for code 561 only.
  if (warning.code !== 561) {
    return "cyclomatic complexity is too high ({complexity} > {max_complexity})";
  }

  let functionDescr: string;

  if (warning.function_type === "main_chunk") {
    functionDescr = "main chunk";
  } else if (warning.function_name) {
    functionDescr = "{function_type} {function_name!}";
  } else {
    functionDescr = "function";
  }

  return `cyclomatic complexity of ${functionDescr} is too high ` +
    "({complexity} > {max_complexity})";
}

/** Wider than the plain `{message_format: string; fields: string[]}` shape: 561 has a function format. */
interface WarningEntry {
  message_format: string | ((warning: Warning) => string);
  fields: string[];
}

export const warnings: Record<string, WarningEntry> = {
  "561": {
    message_format: cyclomaticComplexityMessageFormat,
    fields: [
      "complexity",
      "function_type",
      "function_name",
      "max_complexity",
    ],
  },
};

function warnCyclomaticComplexity(
  chstate: CheckStateInstance,
  line: LineInstance,
  complexity: number,
): void {
  if (line === chstate.topLine) {
    chstate.warn(561, 1, 1, 1, {
      complexity,
      function_type: "main_chunk",
    });
  } else {
    const node = line.node;
    const firstArg = (node["1"] as AstNode)["1"] as AstNode | undefined;

    chstate.warnRange(
      561,
      node as Range,
      compact({
        complexity,
        function_type: firstArg && firstArg.implicit ? "method" : "function",
        function_name: node.name as string | undefined,
      }),
    );
  }
}

type StackInstance = ReturnType<typeof Stack>;

interface CyclomaticComplexityMetricInstance {
  count: number;
  incrDecisions(count: number): void;
  calcExpr(node: AstNode): void;
  calcExprs(exprs: AstNode): void;
  calcItemEval(item: EvalItem): void;
  calcItemLocal(item: LocalItem): void;
  calcItemSet(item: SetItem): void;
  calcItem(item: Item): void;
  calcItems(items: StackInstance): void;
  calcStmtIf(node: AstNode): void;
  calcStmtWhile(node: AstNode): void;
  calcStmtRepeat(node: AstNode): void;
  calcStmtForin(node: AstNode): void;
  calcStmtFornum(node: AstNode): void;
  calcStmt(node: AstNode): void;
  calcStmts(stmts: AstNode): void;
  report(chstate: CheckStateInstance, line: LineInstance): void;
  [key: string]: unknown;
}

const CyclomaticComplexityMetric = classImpl<
  CyclomaticComplexityMetricInstance
>();

CyclomaticComplexityMetric.incrDecisions = function (
  this: CyclomaticComplexityMetricInstance,
  count: number,
): void {
  this.count = this.count + count;
};

CyclomaticComplexityMetric.calcExpr = function (
  this: CyclomaticComplexityMetricInstance,
  node: AstNode,
): void {
  if (node.tag === "Op" && (node["1"] === "and" || node["1"] === "or")) {
    this.incrDecisions(1);
  }

  if (node.tag !== "Function") {
    this.calcExprs(node);
  }
};

CyclomaticComplexityMetric.calcExprs = function (
  this: CyclomaticComplexityMetricInstance,
  exprs: AstNode,
): void {
  const length = astLen(exprs);

  for (let i = 1; i <= length; i++) {
    const expr = exprs[String(i)];
    if (typeof expr === "object" && expr !== null) {
      this.calcExpr(expr as AstNode);
    }
  }
};

CyclomaticComplexityMetric.calcItemEval = function (
  this: CyclomaticComplexityMetricInstance,
  item: EvalItem,
): void {
  this.calcExpr(item.node);
};

CyclomaticComplexityMetric.calcItemLocal = function (
  this: CyclomaticComplexityMetricInstance,
  item: LocalItem,
): void {
  if (item.rhs) {
    this.calcExprs(item.rhs);
  }
};

CyclomaticComplexityMetric.calcItemSet = function (
  this: CyclomaticComplexityMetricInstance,
  item: SetItem,
): void {
  this.calcExprs(item.rhs);
};

CyclomaticComplexityMetric.calcItem = function (
  this: CyclomaticComplexityMetricInstance,
  item: Item,
): void {
  const handler = this[`calcItem${item.tag}`] as
    | ((this: CyclomaticComplexityMetricInstance, item: Item) => void)
    | undefined;

  if (handler) {
    handler.call(this, item);
  }
};

CyclomaticComplexityMetric.calcItems = function (
  this: CyclomaticComplexityMetricInstance,
  items: StackInstance,
): void {
  for (let i = 1; i <= items.size; i++) {
    this.calcItem(items[i] as Item);
  }
};

// stmt if: {condition, block; condition, block; ... else_block}
CyclomaticComplexityMetric.calcStmtIf = function (
  this: CyclomaticComplexityMetricInstance,
  node: AstNode,
): void {
  const length = astLen(node);

  for (let i = 1; i <= length - 1; i += 2) {
    this.incrDecisions(1);
    this.calcStmts(node[String(i + 1)] as AstNode);
  }

  if (length % 2 === 1) {
    this.calcStmts(node[String(length)] as AstNode);
  }
};

// stmt while: {condition, block}
CyclomaticComplexityMetric.calcStmtWhile = function (
  this: CyclomaticComplexityMetricInstance,
  node: AstNode,
): void {
  this.incrDecisions(1);
  this.calcStmts(node["2"] as AstNode);
};

// stmt repeat: {block, condition}
CyclomaticComplexityMetric.calcStmtRepeat = function (
  this: CyclomaticComplexityMetricInstance,
  node: AstNode,
): void {
  this.incrDecisions(1);
  this.calcStmts(node["1"] as AstNode);
};

// stmt forin: {iter_vars, expression_list, block}
CyclomaticComplexityMetric.calcStmtForin = function (
  this: CyclomaticComplexityMetricInstance,
  node: AstNode,
): void {
  this.incrDecisions(1);
  this.calcStmts(node["3"] as AstNode);
};

// stmt fornum: {first_var, expression, expression, expression[optional], block}
CyclomaticComplexityMetric.calcStmtFornum = function (
  this: CyclomaticComplexityMetricInstance,
  node: AstNode,
): void {
  this.incrDecisions(1);
  this.calcStmts((node["5"] ?? node["4"]) as AstNode);
};

CyclomaticComplexityMetric.calcStmt = function (
  this: CyclomaticComplexityMetricInstance,
  node: AstNode,
): void {
  const handler = this[`calcStmt${node.tag}`] as
    | ((this: CyclomaticComplexityMetricInstance, node: AstNode) => void)
    | undefined;

  if (handler) {
    handler.call(this, node);
  }
};

CyclomaticComplexityMetric.calcStmts = function (
  this: CyclomaticComplexityMetricInstance,
  stmts: AstNode,
): void {
  const length = astLen(stmts);

  for (let i = 1; i <= length; i++) {
    this.calcStmt(stmts[String(i)] as AstNode);
  }
};

// Cyclomatic complexity of a function equals to the number of decision points plus 1.
CyclomaticComplexityMetric.report = function (
  this: CyclomaticComplexityMetricInstance,
  chstate: CheckStateInstance,
  line: LineInstance,
): void {
  this.count = 1;
  this.calcStmts(line.node["2"] as AstNode);
  this.calcItems(line.items);
  warnCyclomaticComplexity(chstate, line, this.count);
};

/**
 * Warns about functions whose cyclomatic complexity is too high.
 */
export function run(chstate: CheckStateInstance): void {
  const ccmetric = CyclomaticComplexityMetric();

  for (const line of chstate.lines) {
    ccmetric.report(chstate, line);
  }
}
