/**
 * Ported from luacheck's parser.lua. A recursive-descent Lua 5.1-5.4 parser
 * driven token-by-token off lexer.ts, producing a MetaLua-style AST.
 *
 * AST node shape: Lua's parser builds nodes as tables mixing a 1-based
 * array part (children/raw values) with named fields (`tag`, `line`,
 * `offset`, `end_offset`, and occasionally e.g. `end_range`, `implicit`).
 * This is ported as plain objects with numeric string keys for the array
 * part (kept 1-based, per decoder.ts's indexing convention) plus the named
 * fields - not real JS arrays, since JS arrays are inherently 0-based and
 * would force an error-prone index shift throughout this file. `astPush`/
 * `astLen`/`astLast`/`arr` stand in for Lua's `t[#t+1] = x` / `#t` idiom.
 * Not every node has a `tag`: blocks (loop/if bodies) are plain range (or
 * even rangeless) containers with statements as their array part only.
 */

import * as lexer from "./lexer.ts";
import type { LexerState } from "./lexer.ts";
import type { Chars } from "./decoder.ts";
import { Stack } from "./utils.ts";

export interface Range {
  line: number;
  offset: number;
  endOffset: number;
}

export interface AstNode {
  tag?: string;
  line?: number;
  offset?: number;
  endOffset?: number;
  endRange?: Range;
  implicit?: boolean;
  [key: string]: unknown;
}

export type AstValue = AstNode | string | undefined;

export interface CommentEntry extends Range {
  contents: string;
}

export interface ParserState extends Range {
  lexer: LexerState;
  codeLines: Record<number, boolean>;
  lineEndings: Record<number, "comment" | "string">;
  comments: CommentEntry[];
  hangingSemicolons: Range[];
  token: string;
  tokenValue: string | undefined;
  unpairedTokenGuesser?: UnpairedTokenGuesserInstance;
}

export interface ParseResult {
  ast: AstNode;
  comments: CommentEntry[];
  codeLines: Record<number, boolean>;
  lineEndings: Record<number, "comment" | "string">;
  hangingSemicolons: Range[];
  lineOffsets: number[];
  lineLengths: number[];
}

export interface SyntaxErrorInstance {
  msg: string;
  line: number;
  offset: number;
  endOffset: number;
  prevLine?: number;
  prevOffset?: number;
  prevEndOffset?: number;
  [key: string]: unknown;
}

export class SyntaxError implements SyntaxErrorInstance {
  msg: string;
  line: number;
  offset: number;
  endOffset: number;
  declare prevLine?: number;
  declare prevOffset?: number;
  declare prevEndOffset?: number;
  [key: string]: unknown;

  constructor(msg: string, range: Range, prevRange?: Range) {
    this.msg = msg;
    this.line = range.line;
    this.offset = range.offset;
    this.endOffset = range.endOffset;

    if (prevRange) {
      this.prevLine = prevRange.line;
      this.prevOffset = prevRange.offset;
      this.prevEndOffset = prevRange.endOffset;
    }
  }
}

function syntaxError(msg: string, range: Range, prevRange?: Range): never {
  throw new SyntaxError(msg, range, prevRange);
}

function markLineEndings(
  state: ParserState,
  tokenType: "comment" | "string",
): void {
  for (let line = state.line; line <= state.lexer.line - 1; line++) {
    state.lineEndings[line] = tokenType;
  }
}

function skipToken(state: ParserState): void {
  while (true) {
    const [token, tokenValue, line, offset, errorEndOffset] = lexer.nextToken(
      state.lexer,
    );
    state.token = token as string;
    state.tokenValue = tokenValue;
    state.line = line;
    state.offset = offset;
    state.endOffset = errorEndOffset ?? (state.lexer.offset - 1);

    if (token === null) {
      syntaxError(tokenValue as string, state);
    }

    if (token === "short_comment") {
      state.comments.push({
        contents: tokenValue as string,
        line,
        offset,
        endOffset: state.endOffset,
      });
      state.lineEndings[line] = "comment";
    } else if (token === "long_comment") {
      markLineEndings(state, "comment");
    } else {
      if (token !== "eof") {
        markLineEndings(state, "string");
        state.codeLines[line] = true;
        state.codeLines[state.lexer.line] = true;
      }
      return;
    }
  }
}

function tokenName(token: string): string {
  if (token === "name") return "identifier";
  if (token === "eof") return "<eof>";
  return `'${token}'`;
}

function parseError(
  state: ParserState,
  msg: string,
  prevRange?: Range,
  tokenPrefix?: string,
  messageSuffix?: string,
): never {
  let tokenRepr = state.token === "eof"
    ? "<eof>"
    : lexer.getQuotedSubstringOrLine(
      state.lexer,
      state.line,
      state.offset,
      state.endOffset,
    );

  if (tokenPrefix !== undefined) {
    tokenRepr = `${tokenPrefix} ${tokenRepr}`;
  }

  let fullMsg = `${msg} near ${tokenRepr}`;

  if (messageSuffix !== undefined) {
    fullMsg = `${fullMsg} ${messageSuffix}`;
  }

  syntaxError(fullMsg, state, prevRange);
}

function checkToken(state: ParserState, token: string): void {
  if (state.token !== token) {
    parseError(state, `expected ${tokenName(token)}`);
  }
}

function checkAndSkipToken(state: ParserState, token: string): void {
  checkToken(state, token);
  skipToken(state);
}

function testAndSkipToken(state: ParserState, token: string): boolean {
  if (state.token === token) {
    skipToken(state);
    return true;
  }
  return false;
}

function copyRange(range: Range): Range {
  return { line: range.line, offset: range.offset, endOffset: range.endOffset };
}

const openingTokenToClosing: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "do": "end",
  "if": "end",
  "else": "end",
  "elseif": "end",
  "while": "end",
  "repeat": "until",
  "for": "end",
  "function": "end",
};

function getIndentation(state: ParserState, line: number): number {
  const [wsStart, wsEnd] = state.lexer.src.find(
    "^[ \t\v\f]*",
    state.lexer.lineOffsets[line],
  )!;
  return wsEnd - wsStart;
}

interface OpeningTokenWrapper extends Range {
  token: string;
  closingToken: string | undefined;
  eligible: boolean;
  indentation: number;
  errorToken?: string;
  errorRange?: Range;
}

type StackInstance = InstanceType<typeof Stack>;

export interface UnpairedTokenGuesserInstance {
  oldState: ParserState;
  errorOffset: number;
  errorOpeningRange: Range;
  errorClosingToken: string;
  openingTokensStack: StackInstance;
  state: ParserState;
  guessed?: OpeningTokenWrapper;
  guess(): void;
  onBlockStart(openingTokenRange: Range, openingToken: string): void;
  setGuessed(): void;
  checkToken(): void;
  onBlockEnd(): void;
  onStatement(): void;
  [key: string]: unknown;
}

class UnpairedTokenGuesser implements UnpairedTokenGuesserInstance {
  oldState: ParserState;
  errorOffset: number;
  errorOpeningRange: Range;
  errorClosingToken: string;
  openingTokensStack: StackInstance;
  declare state: ParserState;
  declare guessed?: OpeningTokenWrapper;
  [key: string]: unknown;

  constructor(
    state: ParserState,
    errorOpeningRange: Range,
    errorClosingToken: string,
  ) {
    this.oldState = state;
    this.errorOffset = state.offset;
    this.errorOpeningRange = errorOpeningRange;
    this.errorClosingToken = errorClosingToken;
    this.openingTokensStack = new Stack();
  }

  guess(): void {
    this.state = newParserState(this.oldState.lexer.src);
    this.state.unpairedTokenGuesser = this;
    skipToken(this.state);
    parseBlock(this.state);
    throw "No syntax error in second parse";
  }

  onBlockStart(
    openingTokenRange: Range,
    openingToken: string,
  ): void {
    const tokenWrapper = copyRange(openingTokenRange) as OpeningTokenWrapper;
    tokenWrapper.token = openingToken;
    tokenWrapper.closingToken = openingTokenToClosing[openingToken];
    tokenWrapper.eligible =
      tokenWrapper.closingToken === this.errorClosingToken;
    tokenWrapper.indentation = getIndentation(
      this.state,
      openingTokenRange.line,
    );
    this.openingTokensStack.push(tokenWrapper);
  }

  setGuessed(): void {
    if (this.guessed) return;
    this.guessed = this.openingTokensStack.top as OpeningTokenWrapper;
    this.guessed.errorToken = this.state.token;
    this.guessed.errorRange = copyRange(this.state);
  }

  checkToken(): void {
    const top = this.openingTokensStack.top as OpeningTokenWrapper | undefined;

    if (top && top.eligible && this.state.line > top.line) {
      const tokenIndentation = getIndentation(this.state, this.state.line);

      if (tokenIndentation < top.indentation) {
        this.setGuessed();
      } else if (tokenIndentation === top.indentation) {
        const token = this.state.token;

        if (
          token !== top.closingToken &&
          ((top.token !== "if" && top.token !== "elseif") ||
            (token !== "elseif" && token !== "else"))
        ) {
          this.setGuessed();
        }
      }
    }

    if (this.state.offset === this.errorOffset) {
      if (
        this.guessed && this.guessed.errorRange!.offset !== this.state.offset
      ) {
        this.state.line = this.guessed.errorRange!.line;
        this.state.offset = this.guessed.errorRange!.offset;
        this.state.endOffset = this.guessed.errorRange!.endOffset;
        this.state.token = this.guessed.errorToken!;
        missingClosingTokenError(
          this.state,
          this.guessed,
          this.guessed.token,
          this.guessed.closingToken,
          true,
        );
      }
    }
  }

  onBlockEnd(): void {
    this.checkToken();
    this.openingTokensStack.pop();

    if (!this.openingTokensStack.top) {
      this.guessed = undefined;
    }
  }

  onStatement(): void {
    this.checkToken();
  }
}

function missingClosingTokenError(
  state: ParserState,
  openingRange: Range | undefined,
  openingToken: string | undefined,
  closingToken: string | undefined,
  isGuess?: boolean,
): void {
  let msg = `expected ${tokenName(closingToken!)}`;

  if (openingRange && openingRange.line !== state.line) {
    msg = `${msg} (to close ${
      tokenName(openingToken!)
    } on line ${openingRange.line})`;
  }

  let tokenPrefix: string | undefined;
  let messageSuffix: string | undefined;

  if (isGuess) {
    if (state.token === closingToken) {
      tokenPrefix = "less indented";
    }
    messageSuffix = "(indentation-based guess)";
  }

  parseError(state, msg, openingRange, tokenPrefix, messageSuffix);
}

function checkClosingToken(
  state: ParserState,
  openingRange: Range | undefined,
  openingToken: string | undefined,
): void {
  const closingToken =
    (openingToken !== undefined
      ? openingTokenToClosing[openingToken]
      : undefined) ?? "eof";

  if (state.token === closingToken) return;

  if (
    (openingToken === "if" || openingToken === "elseif") &&
    (state.token === "else" || state.token === "elseif")
  ) {
    return;
  }

  if (closingToken === "end" || closingToken === "until") {
    if (!state.unpairedTokenGuesser) {
      new UnpairedTokenGuesser(state, openingRange as Range, closingToken)
        .guess();
    }
  }

  missingClosingTokenError(state, openingRange, openingToken, closingToken);
}

function checkAndSkipClosingToken(
  state: ParserState,
  openingRange: Range,
  openingToken: string,
): void {
  checkClosingToken(state, openingRange, openingToken);
  skipToken(state);
}

function checkName(state: ParserState): string {
  checkToken(state, "name");
  return state.tokenValue as string;
}

function newOuterNode(range: Range, tag: string, node: AstNode = {}): AstNode {
  node.line = range.line;
  node.offset = range.offset;
  node.endOffset = range.endOffset;
  node.tag = tag;
  return node;
}

function newInnerNode(
  startRange: Range,
  endRange: Range,
  tag: string,
  node: AstNode = {},
): AstNode {
  node.line = startRange.line;
  node.offset = startRange.offset;
  node.endOffset = endRange.endOffset;
  node.tag = tag;
  return node;
}

/** Builds a node with a 1-based array part from `items`, skipping trailing `undefined`s (mirrors a Lua `{a, b, nil}` constructor, where the nil slot is simply absent). */
function arr(...items: AstValue[]): AstNode {
  const node: AstNode = {};
  items.forEach((item, i) => {
    if (item !== undefined) node[String(i + 1)] = item;
  });
  return node;
}

function astLen(node: AstNode): number {
  let n = 0;
  while (node[String(n + 1)] !== undefined) n++;
  return n;
}

function astPush(node: AstNode, value: AstValue): void {
  node[String(astLen(node) + 1)] = value;
}

function astLast(node: AstNode): AstValue {
  return node[String(astLen(node))] as AstValue;
}

function astInsertAt(node: AstNode, pos: number, value: AstValue): void {
  for (let i = astLen(node) + 1; i > pos; i--) {
    node[String(i)] = node[String(i - 1)];
  }
  node[String(pos)] = value;
}

function parseExpressionList(state: ParserState, list: AstNode = {}): AstNode {
  do {
    astPush(list, parseExpression(state));
  } while (testAndSkipToken(state, ","));
  return list;
}

function parseId(state: ParserState, tag = "Id"): AstNode {
  const astNode = newOuterNode(state, tag);
  astNode["1"] = checkName(state);
  skipToken(state);
  return astNode;
}

function atom(tag: string): (state: ParserState) => AstNode {
  return (state: ParserState): AstNode => {
    const astNode = newOuterNode(state, tag);
    if (state.tokenValue !== undefined) astNode["1"] = state.tokenValue;
    skipToken(state);
    return astNode;
  };
}

type ExpressionHandler = (state: ParserState) => AstNode;

const simpleExpressions: Record<string, ExpressionHandler> = {};

simpleExpressions.number = atom("Number");
simpleExpressions.string = atom("String");
simpleExpressions["nil"] = atom("Nil");
simpleExpressions["true"] = atom("True");
simpleExpressions["false"] = atom("False");
simpleExpressions["..."] = atom("Dots");

simpleExpressions["{"] = function (state: ParserState): AstNode {
  const startRange = copyRange(state);
  const astNode: AstNode = {};
  skipToken(state);

  do {
    if (state.token === "}") break;

    let keyNode: AstNode | undefined;
    let valueNode: AstNode;
    const firstTokenRange = copyRange(state);

    if (state.token === "name") {
      const name = state.tokenValue as string;
      skipToken(state);

      if (testAndSkipToken(state, "=")) {
        keyNode = newOuterNode(firstTokenRange, "String", arr(name));
        valueNode = parseExpression(state);
      } else {
        state.lexer.line = firstTokenRange.line;
        state.lexer.offset = firstTokenRange.offset;
        skipToken(state);
        valueNode = parseExpression(state);
      }
    } else if (state.token === "[") {
      skipToken(state);
      keyNode = parseExpression(state);
      checkAndSkipClosingToken(state, firstTokenRange, "[");
      checkAndSkipToken(state, "=");
      valueNode = parseExpression(state);
    } else {
      valueNode = parseExpression(state);
    }

    if (keyNode) {
      astPush(
        astNode,
        newInnerNode(
          firstTokenRange,
          valueNode as Range,
          "Pair",
          arr(keyNode, valueNode),
        ),
      );
    } else {
      astPush(astNode, valueNode);
    }
  } while (testAndSkipToken(state, ",") || testAndSkipToken(state, ";"));

  newInnerNode(startRange, state, "Table", astNode);
  checkAndSkipClosingToken(state, startRange, "{");
  return astNode;
};

function parseFunction(state: ParserState, functionRange: Range): AstNode {
  const parenRange = copyRange(state);
  checkAndSkipToken(state, "(");
  const args: AstNode = {};

  if (state.token !== ")") {
    do {
      if (state.token === "name") {
        astPush(args, parseId(state));
      } else if (state.token === "...") {
        astPush(args, simpleExpressions["..."](state));
        break;
      } else {
        parseError(state, "expected argument");
      }
    } while (testAndSkipToken(state, ","));
  }

  checkAndSkipClosingToken(state, parenRange, "(");
  const body = parseBlock(state, functionRange, "function");
  const endRange = copyRange(state);
  skipToken(state);
  const node = arr(args, body);
  node.endRange = endRange;
  return newInnerNode(functionRange, endRange, "Function", node);
}

simpleExpressions["function"] = function (state: ParserState): AstNode {
  const functionRange = copyRange(state);
  skipToken(state);
  return parseFunction(state, functionRange);
};

type CallHandler = (
  state: ParserState,
  baseNode: AstNode,
  tag: string,
  node: AstNode,
) => AstNode;

const callHandlers: Record<string, CallHandler> = {};

callHandlers["("] = function (state, baseNode, tag, node) {
  const parenRange = copyRange(state);
  skipToken(state);

  if (state.token !== ")") {
    parseExpressionList(state, node);
  }

  newInnerNode(baseNode as Range, state, tag, node);
  checkAndSkipClosingToken(state, parenRange, "(");
  return node;
};

callHandlers["{"] = function (state, baseNode, tag, node) {
  const argNode = simpleExpressions[state.token](state);
  astPush(node, argNode);
  return newInnerNode(baseNode as Range, argNode as Range, tag, node);
};

callHandlers.string = callHandlers["{"];

type SuffixHandler = (state: ParserState, baseNode: AstNode) => AstNode;

const suffixHandlers: Record<string, SuffixHandler> = {};

suffixHandlers["."] = function (state, baseNode) {
  skipToken(state);
  const indexNode = parseId(state, "String");
  return newInnerNode(
    baseNode as Range,
    indexNode as Range,
    "Index",
    arr(baseNode, indexNode),
  );
};

suffixHandlers["["] = function (state, baseNode) {
  const bracketRange = copyRange(state);
  skipToken(state);
  const indexNode = parseExpression(state);
  const astNode = newInnerNode(
    baseNode as Range,
    state,
    "Index",
    arr(baseNode, indexNode),
  );
  checkAndSkipClosingToken(state, bracketRange, "[");
  return astNode;
};

suffixHandlers[":"] = function (state, baseNode) {
  skipToken(state);
  const methodName = parseId(state, "String");
  const callHandler = callHandlers[state.token];

  if (!callHandler) {
    parseError(state, "expected method arguments");
  }

  return callHandler(state, baseNode, "Invoke", arr(baseNode, methodName));
};

suffixHandlers["("] = function (state, baseNode) {
  return callHandlers[state.token](state, baseNode, "Call", arr(baseNode));
};

suffixHandlers["{"] = suffixHandlers["("];
suffixHandlers.string = suffixHandlers["("];

function parseSimpleExpression(
  state: ParserState,
  kind?: string,
  noLiterals?: boolean,
): AstNode {
  let expression: AstNode;

  if (state.token === "(") {
    const parenRange = copyRange(state);
    skipToken(state);
    const innerExpression = parseExpression(state);
    expression = newInnerNode(parenRange, state, "Paren", arr(innerExpression));
    checkAndSkipClosingToken(state, parenRange, "(");
  } else if (state.token === "name") {
    expression = parseId(state);
  } else {
    const literalHandler = simpleExpressions[state.token];

    if (!literalHandler || noLiterals) {
      parseError(state, `expected ${kind ?? "expression"}`);
    }

    return literalHandler(state);
  }

  while (true) {
    const suffixHandler = suffixHandlers[state.token];
    if (suffixHandler) {
      expression = suffixHandler(state, expression);
    } else {
      return expression;
    }
  }
}

const unaryOperators: Record<string, string> = {
  "not": "not",
  "-": "unm",
  "~": "bnot",
  "#": "len",
};

const unaryPriority = 12;

const binaryOperators: Record<string, string> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "%": "mod",
  "^": "pow",
  "/": "div",
  "//": "idiv",
  "&": "band",
  "|": "bor",
  "~": "bxor",
  "<<": "shl",
  ">>": "shr",
  "..": "concat",
  "~=": "ne",
  "==": "eq",
  "<": "lt",
  "<=": "le",
  ">": "gt",
  ">=": "ge",
  "and": "and",
  "or": "or",
};

const compoundOperators: Record<string, string> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "%": "mod",
  "^": "pow",
  "/": "div",
  "//": "idiv",
  "&": "band",
  "|": "bor",
  "~": "bxor",
  "<<": "shl",
  ">>": "shr",
  "..": "concat",
};

const leftPriorities: Record<string, number> = {
  add: 10,
  sub: 10,
  mul: 11,
  mod: 11,
  pow: 14,
  div: 11,
  idiv: 11,
  band: 6,
  bor: 4,
  bxor: 5,
  shl: 7,
  shr: 7,
  concat: 9,
  ne: 3,
  eq: 3,
  lt: 3,
  le: 3,
  gt: 3,
  ge: 3,
  "and": 2,
  "or": 1,
};

const rightPriorities: Record<string, number> = {
  add: 10,
  sub: 10,
  mul: 11,
  mod: 11,
  pow: 13,
  div: 11,
  idiv: 11,
  band: 6,
  bor: 4,
  bxor: 5,
  shl: 7,
  shr: 7,
  concat: 8,
  ne: 3,
  eq: 3,
  lt: 3,
  le: 3,
  gt: 3,
  ge: 3,
  "and": 2,
  "or": 1,
};

function parseSubexpression(
  state: ParserState,
  limit: number,
  kind?: string,
): AstNode {
  let expression: AstNode;
  const unaryOperator = unaryOperators[state.token];

  if (unaryOperator) {
    const operatorRange = copyRange(state);
    skipToken(state);
    const operand = parseSubexpression(state, unaryPriority);
    expression = newInnerNode(
      operatorRange,
      operand as Range,
      "Op",
      arr(unaryOperator, operand),
    );
  } else {
    expression = parseSimpleExpression(state, kind);
  }

  while (true) {
    const binaryOperator = binaryOperators[state.token];

    if (!binaryOperator || leftPriorities[binaryOperator] <= limit) {
      break;
    }

    skipToken(state);
    const subexpression = parseSubexpression(
      state,
      rightPriorities[binaryOperator],
    );
    expression = newInnerNode(
      expression as Range,
      subexpression as Range,
      "Op",
      arr(binaryOperator, expression, subexpression),
    );
  }

  return expression;
}

function parseExpression(state: ParserState, kind?: string): AstNode {
  return parseSubexpression(state, 0, kind);
}

type StatementHandler = (state: ParserState) => AstNode;

const statements: Record<string, StatementHandler> = {};

statements["if"] = function (state) {
  const startRange = copyRange(state);
  skipToken(state);
  const astNode: AstNode = {};

  let blockStartToken: string | undefined = "if";
  let blockStartRange: Range = startRange;

  while (true) {
    astPush(astNode, parseExpression(state, "condition"));
    let branchRange = copyRange(state);
    checkAndSkipToken(state, "then");
    astPush(
      astNode,
      parseBlock(
        state,
        blockStartRange,
        blockStartToken,
        branchRange as AstNode,
      ),
    );

    if (state.token === "else") {
      branchRange = copyRange(state);
      blockStartToken = "else";
      blockStartRange = branchRange;
      skipToken(state);
      astPush(
        astNode,
        parseBlock(
          state,
          blockStartRange,
          blockStartToken,
          branchRange as AstNode,
        ),
      );
      break;
    } else if (state.token === "elseif") {
      blockStartToken = "elseif";
      blockStartRange = copyRange(state);
      skipToken(state);
    } else {
      break;
    }
  }

  newInnerNode(startRange, state, "If", astNode);
  skipToken(state);
  return astNode;
};

statements["while"] = function (state) {
  const startRange = copyRange(state);
  skipToken(state);
  const condition = parseExpression(state, "condition");
  checkAndSkipToken(state, "do");
  const block = parseBlock(state, startRange, "while");
  const astNode = newInnerNode(
    startRange,
    state,
    "While",
    arr(condition, block),
  );
  skipToken(state);
  return astNode;
};

statements["do"] = function (state) {
  const startRange = copyRange(state);
  skipToken(state);
  const block = parseBlock(state, startRange, "do");
  const astNode = newInnerNode(startRange, state, "Do", block);
  skipToken(state);
  return astNode;
};

statements["for"] = function (state) {
  const startRange = copyRange(state);
  skipToken(state);

  const astNode: AstNode = {};
  let tag: string;
  const firstVar = parseId(state);

  if (state.token === "=") {
    tag = "Fornum";
    skipToken(state);
    astNode["1"] = firstVar;
    astNode["2"] = parseExpression(state);
    checkAndSkipToken(state, ",");
    astNode["3"] = parseExpression(state);

    if (testAndSkipToken(state, ",")) {
      astNode["4"] = parseExpression(state);
    }

    checkAndSkipToken(state, "do");
    astPush(astNode, parseBlock(state, startRange, "for"));
  } else if (state.token === "," || state.token === "in") {
    tag = "Forin";

    const iterVars = arr(firstVar);
    while (testAndSkipToken(state, ",")) {
      astPush(iterVars, parseId(state));
    }

    astNode["1"] = iterVars;
    checkAndSkipToken(state, "in");
    astNode["2"] = parseExpressionList(state);
    checkAndSkipToken(state, "do");
    astNode["3"] = parseBlock(state, startRange, "for");
  } else {
    parseError(state, "expected '=', ',' or 'in'");
  }

  newInnerNode(startRange, state, tag, astNode);
  skipToken(state);
  return astNode;
};

statements["repeat"] = function (state) {
  const startRange = copyRange(state);
  skipToken(state);
  const block = parseBlock(state, startRange, "repeat");
  skipToken(state);
  const condition = parseExpression(state, "condition");
  return newInnerNode(
    startRange,
    condition as Range,
    "Repeat",
    arr(block, condition),
  );
};

statements["function"] = function (state) {
  const startRange = copyRange(state);
  skipToken(state);
  let lhs = parseId(state);
  let implicitSelfRange: Range | undefined;

  while (!implicitSelfRange && (state.token === "." || state.token === ":")) {
    implicitSelfRange = state.token === ":" ? copyRange(state) : undefined;
    skipToken(state);
    const indexNode = parseId(state, "String");
    lhs = newInnerNode(
      lhs as Range,
      indexNode as Range,
      "Index",
      arr(lhs, indexNode),
    );
  }

  const functionNode = parseFunction(state, startRange);

  if (implicitSelfRange) {
    const selfArg = newOuterNode(implicitSelfRange, "Id", arr("self"));
    selfArg.implicit = true;
    astInsertAt(functionNode["1"] as AstNode, 1, selfArg);
  }

  return newInnerNode(
    startRange,
    functionNode as Range,
    "Set",
    arr(arr(lhs), arr(functionNode)),
  );
};

statements["local"] = function (state) {
  const startRange = copyRange(state);
  skipToken(state);

  if (state.token === "function") {
    const functionRange = copyRange(state);
    skipToken(state);
    const varNode = parseId(state);
    const functionNode = parseFunction(state, functionRange);
    return newInnerNode(
      startRange,
      functionNode as Range,
      "Localrec",
      arr(arr(varNode), arr(functionNode)),
    );
  }

  const lhs: AstNode = {};
  let rhs: AstNode | undefined;

  do {
    astPush(lhs, parseId(state));

    if (state.token === "<") {
      skipToken(state);
      checkName(state);
      skipToken(state);
      checkAndSkipToken(state, ">");
    }
  } while (testAndSkipToken(state, ","));

  if (testAndSkipToken(state, "=")) {
    rhs = parseExpressionList(state);
  }

  const endRange = (rhs ? astLast(rhs) : astLast(lhs)) as Range;
  return newInnerNode(startRange, endRange, "Local", arr(lhs, rhs));
};

statements["::"] = function (state) {
  const startRange = copyRange(state);
  skipToken(state);
  const name = checkName(state);
  skipToken(state);
  const astNode = newInnerNode(startRange, state, "Label", arr(name));
  checkAndSkipToken(state, "::");
  return astNode;
};

const closingTokens = new Set(["end", "eof", "else", "elseif", "until"]);

statements["return"] = function (state) {
  const startRange = copyRange(state);
  skipToken(state);

  if (closingTokens.has(state.token) || state.token === ";") {
    return newOuterNode(startRange, "Return");
  }

  const returns = parseExpressionList(state);
  return newInnerNode(startRange, astLast(returns) as Range, "Return", returns);
};

statements["break"] = function (state) {
  const astNode = newOuterNode(state, "Break");
  skipToken(state);
  return astNode;
};

statements["goto"] = function (state) {
  const startRange = copyRange(state);
  skipToken(state);
  const name = checkName(state);
  const astNode = newOuterNode(startRange, "Goto", arr(name));
  skipToken(state);
  return astNode;
};

function parseExpressionStatement(state: ParserState): AstNode {
  let lhs: AstNode | undefined;
  const startRange = copyRange(state);

  do {
    const itemStartRange = lhs ? copyRange(state) : startRange;
    const expected = lhs ? "identifier or field" : "statement";
    const primaryExpression = parseSimpleExpression(state, expected, true);

    if (primaryExpression.tag === "Paren") {
      syntaxError(`expected ${expected} near '('`, itemStartRange);
    }

    if (
      primaryExpression.tag === "Call" || primaryExpression.tag === "Invoke"
    ) {
      if (lhs) {
        parseError(state, "expected call or indexing");
      } else {
        return primaryExpression;
      }
    }

    lhs = lhs ?? {};
    astPush(lhs, primaryExpression);
  } while (testAndSkipToken(state, ","));

  const compoundOperator = compoundOperators[state.token];

  if (compoundOperator) {
    if (astLen(lhs!) !== 1) {
      parseError(
        state,
        `compound assignment not allowed on tuples near ${compoundOperator}=`,
      );
    }

    skipToken(state);
    checkAndSkipToken(state, "=");
    const rhs = parseExpressionList(state);

    if (astLen(rhs) !== 1) {
      parseError(
        state,
        `compound assignment not allowed on tuples near ${compoundOperator}=`,
      );
    }

    return newInnerNode(
      startRange,
      rhs["1"] as Range,
      "OpSet",
      arr(lhs!, rhs, compoundOperator),
    );
  }

  checkAndSkipToken(state, "=");
  const rhs = parseExpressionList(state);
  return newInnerNode(startRange, astLast(rhs) as Range, "Set", arr(lhs!, rhs));
}

function parseStatement(state: ParserState): AstNode {
  const handler = statements[state.token] ?? parseExpressionStatement;
  return handler(state);
}

function parseBlock(
  state: ParserState,
  openingTokenRange?: Range,
  openingToken?: string,
  block: AstNode = {},
): AstNode {
  const unpairedTokenGuesser = state.unpairedTokenGuesser;

  if (unpairedTokenGuesser && openingToken) {
    unpairedTokenGuesser.onBlockStart(openingTokenRange!, openingToken);
  }

  let afterStatement = false;

  while (!closingTokens.has(state.token)) {
    const firstToken = state.token;

    if (firstToken === ";") {
      if (!afterStatement) {
        state.hangingSemicolons.push(copyRange(state));
      }

      skipToken(state);
      afterStatement = false;
    } else {
      if (unpairedTokenGuesser) {
        unpairedTokenGuesser.onStatement();
      }

      const statement = parseStatement(state);
      afterStatement = true;
      astPush(block, statement);

      if (statement.tag === "Return") {
        testAndSkipToken(state, ";");
        break;
      }
    }
  }

  if (unpairedTokenGuesser && openingToken) {
    unpairedTokenGuesser.onBlockEnd();
  }

  checkClosingToken(state, openingTokenRange, openingToken);
  return block;
}

function newParserState(
  src: Chars,
  lineOffsets?: number[],
  lineLengths?: number[],
): ParserState {
  return {
    lexer: lexer.newState(src, lineOffsets, lineLengths),
    codeLines: {},
    lineEndings: {},
    comments: [],
    hangingSemicolons: [],
    token: "",
    tokenValue: undefined,
    line: 0,
    offset: 0,
    endOffset: 0,
  };
}

/**
 * Parses source characters. On error throws a `SyntaxError` instance
 * (detect it with `instanceof SyntaxError`).
 */
export function parse(
  src: Chars,
  lineOffsets?: number[],
  lineLengths?: number[],
): ParseResult {
  const state = newParserState(src, lineOffsets, lineLengths);
  skipToken(state);
  const ast = parseBlock(state);
  return {
    ast,
    comments: state.comments,
    codeLines: state.codeLines,
    lineEndings: state.lineEndings,
    hangingSemicolons: state.hangingSemicolons,
    lineOffsets: state.lexer.lineOffsets,
    lineLengths: state.lexer.lineLengths,
  };
}
