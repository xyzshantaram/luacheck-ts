/**
 * Ported from luacheck's lexer.lua. Lexes Lua 5.1-5.4 and LuaJIT syntax
 * (64-bit/complex cdata literals included) from a `Chars` source (see
 * decoder.ts). Keeps Lua's 1-based offset/line indexing throughout — see
 * decoder.ts's file header for why.
 */

import type { Chars } from "./decoder.ts";

const BYTE_0 = "0".charCodeAt(0);
const BYTE_9 = "9".charCodeAt(0);
const BYTE_f = "f".charCodeAt(0);
const BYTE_F = "F".charCodeAt(0);
const BYTE_x = "x".charCodeAt(0);
const BYTE_X = "X".charCodeAt(0);
const BYTE_i = "i".charCodeAt(0);
const BYTE_I = "I".charCodeAt(0);
const BYTE_l = "l".charCodeAt(0);
const BYTE_L = "L".charCodeAt(0);
const BYTE_u = "u".charCodeAt(0);
const BYTE_U = "U".charCodeAt(0);
const BYTE_e = "e".charCodeAt(0);
const BYTE_E = "E".charCodeAt(0);
const BYTE_p = "p".charCodeAt(0);
const BYTE_P = "P".charCodeAt(0);
const BYTE_a = "a".charCodeAt(0);
const BYTE_z = "z".charCodeAt(0);
const BYTE_A = "A".charCodeAt(0);
const BYTE_Z = "Z".charCodeAt(0);
const BYTE_DOT = ".".charCodeAt(0);
const BYTE_COLON = ":".charCodeAt(0);
const BYTE_OBRACK = "[".charCodeAt(0);
const BYTE_CBRACK = "]".charCodeAt(0);
const BYTE_OBRACE = "{".charCodeAt(0);
const BYTE_CBRACE = "}".charCodeAt(0);
const BYTE_QUOTE = "'".charCodeAt(0);
const BYTE_DQUOTE = '"'.charCodeAt(0);
const BYTE_DASH = "-".charCodeAt(0);
const BYTE_LDASH = "_".charCodeAt(0);
const BYTE_SLASH = "/".charCodeAt(0);
const BYTE_BSLASH = "\\".charCodeAt(0);
const BYTE_EQ = "=".charCodeAt(0);
const BYTE_NE = "~".charCodeAt(0);
const BYTE_LT = "<".charCodeAt(0);
const BYTE_GT = ">".charCodeAt(0);
const BYTE_LF = "\n".charCodeAt(0);
const BYTE_CR = "\r".charCodeAt(0);
const BYTE_SPACE = " ".charCodeAt(0);
const BYTE_FF = "\f".charCodeAt(0);
const BYTE_TAB = "\t".charCodeAt(0);
const BYTE_VTAB = "\v".charCodeAt(0);
const BYTE_PLUS = "+".charCodeAt(0);

function toHex(b: number): number | undefined {
  if (BYTE_0 <= b && b <= BYTE_9) return b - BYTE_0;
  if (BYTE_a <= b && b <= BYTE_f) return 10 + b - BYTE_a;
  if (BYTE_A <= b && b <= BYTE_F) return 10 + b - BYTE_A;
  return undefined;
}

function toDec(b: number): number | undefined {
  if (BYTE_0 <= b && b <= BYTE_9) return b - BYTE_0;
  return undefined;
}

/**
 * Encodes `codepoint` using Lua's own (pre-RFC3629, up to 6-byte) UTF-8
 * variant, since `\u{}` string escapes allow codepoints up to 0x7FFFFFFF.
 * This is why `TextEncoder` cannot be used here: it only accepts valid
 * Unicode scalar values and caps out at 4-byte sequences.
 */
function toUtf(codepointIn: number): string {
  let codepoint = codepointIn;
  if (codepoint < 0x80) return String.fromCharCode(codepoint);

  const buf: number[] = [];
  let mfb = 0x3f;

  do {
    buf.push((codepoint % 0x40) + 0x80);
    codepoint = Math.floor(codepoint / 0x40);
    mfb = Math.floor(mfb / 2);
  } while (codepoint > mfb);

  buf.push(0xfe - mfb * 2 + codepoint);
  return buf.reverse().map((b) => String.fromCharCode(b)).join("");
}

function isAlpha(b: number | undefined): boolean {
  return b !== undefined &&
    ((BYTE_a <= b && b <= BYTE_z) || (BYTE_A <= b && b <= BYTE_Z) ||
      b === BYTE_LDASH);
}

function isNewline(b: number | undefined): boolean {
  return b === BYTE_LF || b === BYTE_CR;
}

function isSpace(b: number | undefined): boolean {
  return b === BYTE_SPACE || b === BYTE_FF || b === BYTE_TAB || b === BYTE_VTAB;
}

const KEYWORDS = new Set([
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "goto",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while",
]);

const SIMPLE_ESCAPES: Record<number, number> = {
  ["a".charCodeAt(0)]: "\a".charCodeAt(0),
  ["b".charCodeAt(0)]: "\b".charCodeAt(0),
  ["f".charCodeAt(0)]: "\f".charCodeAt(0),
  ["n".charCodeAt(0)]: "\n".charCodeAt(0),
  ["r".charCodeAt(0)]: "\r".charCodeAt(0),
  ["t".charCodeAt(0)]: "\t".charCodeAt(0),
  ["v".charCodeAt(0)]: "\v".charCodeAt(0),
  [BYTE_BSLASH]: BYTE_BSLASH,
  [BYTE_QUOTE]: BYTE_QUOTE,
  [BYTE_DQUOTE]: BYTE_DQUOTE,
};

export interface LexerState {
  src: Chars;
  line: number;
  lineOffsets: number[];
  lineLengths: number[];
  offset: number;
}

function nextByte(state: LexerState): number | undefined {
  const offset = state.offset + 1;
  state.offset = offset;
  return state.src.getCodepoint(offset);
}

// Skipping helpers: take the current character, skip something, return next character.

function skipNewline(
  state: LexerState,
  newline: number | undefined,
): number | undefined {
  const firstNewlineOffset = state.offset;
  let b = nextByte(state);

  if (b !== newline && isNewline(b)) {
    b = nextByte(state);
  }

  const line = state.line;
  const lineOffsets = state.lineOffsets;
  state.lineLengths[line] = firstNewlineOffset - lineOffsets[line];
  const newLine = line + 1;
  state.line = newLine;
  lineOffsets[newLine] = state.offset;
  return b;
}

function skipToNewline(
  state: LexerState,
  bIn: number | undefined,
): number | undefined {
  let b = bIn;
  while (!isNewline(b) && b !== undefined) {
    b = nextByte(state);
  }
  return b;
}

function skipSpace(
  state: LexerState,
  bIn: number | undefined,
): number | undefined {
  let b = bIn;
  while (isSpace(b) || isNewline(b)) {
    b = isNewline(b) ? skipNewline(state, b) : nextByte(state);
  }
  return b;
}

/** Skips "[=*" or "]=*". Returns next character and number of "="s. */
function skipLongBracket(state: LexerState): [number | undefined, number] {
  const start = state.offset;
  let b = nextByte(state);

  while (b === BYTE_EQ) {
    b = nextByte(state);
  }

  return [b, state.offset - start - 1];
}

/**
 * A token handler's result: `[token, value, relativeErrorOffset?]`.
 * `token === null` signals an error; `relativeErrorOffset` is only set by
 * handlers that report a precise erroring span (see `nextToken`'s two
 * error-reporting paths).
 */
type TokenResult = [string | null, string | undefined, number?];

/** Called after the opening "[=*" has been skipped. Takes the "=" count and token type. */
function lexLongString(
  state: LexerState,
  openingLongBracket: number,
  token: string,
): TokenResult {
  let b = nextByte(state);

  if (isNewline(b)) {
    b = skipNewline(state, b);
  }

  const lines: string[] = [];
  let lineStart = state.offset;

  while (true) {
    if (isNewline(b)) {
      lines.push(state.src.getSubstring(lineStart, state.offset - 1));
      b = skipNewline(state, b);
      lineStart = state.offset;
    } else if (b === BYTE_CBRACK) {
      const [nb, longBracket] = skipLongBracket(state);
      b = nb;
      if (b === BYTE_CBRACK && longBracket === openingLongBracket) {
        break;
      }
    } else if (b === undefined) {
      return [
        null,
        token === "string"
          ? "unfinished long string"
          : "unfinished long comment",
      ];
    } else {
      b = nextByte(state);
    }
  }

  lines.push(
    state.src.getSubstring(lineStart, state.offset - openingLongBracket - 2),
  );
  state.offset = state.offset + 1;
  return [token, lines.join("\n")];
}

function lexShortString(state: LexerState, quote: number): TokenResult {
  let b = nextByte(state);
  let chunks: string[] | undefined;
  let chunkStart = state.offset;

  while (b !== quote) {
    if (b === BYTE_BSLASH) {
      if (!chunks) chunks = [];

      if (chunkStart !== state.offset) {
        chunks.push(state.src.getSubstring(chunkStart, state.offset - 1));
      }

      b = nextByte(state);
      let s: string | undefined;

      const escapeByte = b !== undefined ? SIMPLE_ESCAPES[b] : undefined;

      if (escapeByte !== undefined) {
        b = nextByte(state);
        s = String.fromCharCode(escapeByte);
      } else if (isNewline(b)) {
        b = skipNewline(state, b);
        s = "\n";
      } else if (b === BYTE_x) {
        b = nextByte(state);
        let c1: number | undefined;
        let c2: number | undefined;

        if (b !== undefined) c1 = toHex(b);
        if (c1 === undefined) {
          return [null, "invalid hexadecimal escape sequence", -2];
        }

        b = nextByte(state);
        if (b !== undefined) c2 = toHex(b);
        if (c2 === undefined) {
          return [null, "invalid hexadecimal escape sequence", -3];
        }

        b = nextByte(state);
        s = String.fromCharCode(c1 * 16 + c2);
      } else if (b === BYTE_u) {
        b = nextByte(state);
        if (b !== BYTE_OBRACE) {
          return [null, "invalid UTF-8 escape sequence", -2];
        }

        b = nextByte(state);
        let codepoint: number | undefined;
        if (b !== undefined) codepoint = toHex(b);
        if (codepoint === undefined) {
          return [null, "invalid UTF-8 escape sequence", -3];
        }

        let hexdigits = 0;

        while (true) {
          b = nextByte(state);
          const hex = b !== undefined ? toHex(b) : undefined;

          if (hex !== undefined) {
            hexdigits += 1;
            codepoint = codepoint * 16 + hex;

            if (codepoint > 0x7fffffff) {
              return [null, "invalid UTF-8 escape sequence", -hexdigits - 3];
            }
          } else {
            break;
          }
        }

        if (b !== BYTE_CBRACE) {
          return [null, "invalid UTF-8 escape sequence", -hexdigits - 4];
        }

        b = nextByte(state);
        s = toUtf(codepoint);
      } else if (b === "z".charCodeAt(0)) {
        b = skipSpace(state, nextByte(state));
      } else {
        let cb: number | undefined;
        if (b !== undefined) cb = toDec(b);
        if (cb === undefined) return [null, "invalid escape sequence", -1];

        b = nextByte(state);

        if (b !== undefined) {
          const c2 = toDec(b);
          if (c2 !== undefined) {
            cb = 10 * cb + c2;
            b = nextByte(state);

            if (b !== undefined) {
              const c3 = toDec(b);
              if (c3 !== undefined) {
                cb = 10 * cb + c3;
                if (cb > 255) {
                  return [null, "invalid decimal escape sequence", -3];
                }
                b = nextByte(state);
              }
            }
          }
        }

        s = String.fromCharCode(cb);
      }

      if (s !== undefined) chunks.push(s);
      chunkStart = state.offset;
    } else if (b === undefined || isNewline(b)) {
      return [null, "unfinished string"];
    } else {
      b = nextByte(state);
    }
  }

  let stringValue: string;

  if (chunks) {
    if (chunkStart !== state.offset) {
      chunks.push(state.src.getSubstring(chunkStart, state.offset - 1));
    }
    stringValue = chunks.join("");
  } else {
    stringValue = state.src.getSubstring(chunkStart, state.offset - 1);
  }

  state.offset = state.offset + 1;
  return ["string", stringValue];
}

/**
 * Payload for a number is simply a substring: luacheck stays
 * forward-compatible with Lua 5.3/LuaJIT syntax by not parsing it into an
 * actual number (not needed since luacheck does not statically evaluate).
 */
function lexNumber(state: LexerState, bIn: number | undefined): TokenResult {
  const start = state.offset;
  let b = bIn;

  let expLower = BYTE_e;
  let expUpper = BYTE_E;
  let isDigit = toDec;
  let hasDigits = false;
  let isFloat = false;

  if (b === BYTE_0) {
    b = nextByte(state);

    if (b === BYTE_x || b === BYTE_X) {
      expLower = BYTE_p;
      expUpper = BYTE_P;
      isDigit = toHex;
      b = nextByte(state);
    } else {
      hasDigits = true;
    }
  }

  while (b !== undefined && isDigit(b) !== undefined) {
    b = nextByte(state);
    hasDigits = true;
  }

  if (b === BYTE_DOT) {
    isFloat = true;
    b = nextByte(state);

    while (b !== undefined && isDigit(b) !== undefined) {
      b = nextByte(state);
      hasDigits = true;
    }
  }

  if (b === expLower || b === expUpper) {
    isFloat = true;
    b = nextByte(state);

    if (b === BYTE_PLUS || b === BYTE_DASH) {
      b = nextByte(state);
    }

    if (b === undefined || toDec(b) === undefined) {
      return [null, "malformed number"];
    }

    do {
      b = nextByte(state);
    } while (b !== undefined && toDec(b) !== undefined);
  }

  if (!hasDigits) {
    return [null, "malformed number"];
  }

  if (b === BYTE_i || b === BYTE_I) {
    state.offset = state.offset + 1;
  } else if (!isFloat) {
    if (b === BYTE_u || b === BYTE_U) {
      const b1 = state.src.getCodepoint(state.offset + 1);
      if (b1 === BYTE_l || b1 === BYTE_L) {
        const b2 = state.src.getCodepoint(state.offset + 2);
        if (b2 === BYTE_l || b2 === BYTE_L) {
          state.offset = state.offset + 3;
        }
      }
    } else if (b === BYTE_l || b === BYTE_L) {
      const b1 = state.src.getCodepoint(state.offset + 1);
      if (b1 === BYTE_l || b1 === BYTE_L) {
        const b2 = state.src.getCodepoint(state.offset + 2);
        if (b2 === BYTE_u || b2 === BYTE_U) {
          state.offset = state.offset + 3;
        } else {
          state.offset = state.offset + 2;
        }
      }
    }
  }

  return ["number", state.src.getSubstring(start, state.offset - 1)];
}

function lexIdent(state: LexerState): TokenResult {
  const start = state.offset;
  let b = nextByte(state);

  while (b !== undefined && (isAlpha(b) || toDec(b) !== undefined)) {
    b = nextByte(state);
  }

  const ident = state.src.getSubstring(start, state.offset - 1);

  if (KEYWORDS.has(ident)) {
    return [ident, undefined];
  }
  return ["name", ident];
}

function lexDash(state: LexerState): TokenResult {
  let b = nextByte(state);

  if (b !== BYTE_DASH) {
    return ["-", undefined];
  }

  b = nextByte(state);
  const start = state.offset;

  if (b === BYTE_OBRACK) {
    const [nb, longBracket] = skipLongBracket(state);
    b = nb;
    if (b === BYTE_OBRACK) {
      return lexLongString(state, longBracket, "long_comment");
    }
  }

  skipToNewline(state, b);
  const commentValue = state.src.getSubstring(start, state.offset - 1);
  return ["short_comment", commentValue];
}

function lexBracket(state: LexerState): TokenResult {
  const [b, longBracket] = skipLongBracket(state);

  if (b === BYTE_OBRACK) {
    return lexLongString(state, longBracket, "string");
  } else if (longBracket === 0) {
    return ["[", undefined];
  } else {
    return [null, "invalid long string delimiter"];
  }
}

function lexEq(state: LexerState): TokenResult {
  const b = nextByte(state);
  if (b === BYTE_EQ) {
    state.offset = state.offset + 1;
    return ["==", undefined];
  }
  return ["=", undefined];
}

function lexLt(state: LexerState): TokenResult {
  const b = nextByte(state);
  if (b === BYTE_EQ) {
    state.offset = state.offset + 1;
    return ["<=", undefined];
  } else if (b === BYTE_LT) {
    state.offset = state.offset + 1;
    return ["<<", undefined];
  }
  return ["<", undefined];
}

function lexGt(state: LexerState): TokenResult {
  const b = nextByte(state);
  if (b === BYTE_EQ) {
    state.offset = state.offset + 1;
    return [">=", undefined];
  } else if (b === BYTE_GT) {
    state.offset = state.offset + 1;
    return [">>", undefined];
  }
  return [">", undefined];
}

function lexDiv(state: LexerState): TokenResult {
  const b = nextByte(state);
  if (b === BYTE_SLASH) {
    state.offset = state.offset + 1;
    return ["//", undefined];
  }
  return ["/", undefined];
}

function lexNe(state: LexerState): TokenResult {
  const b = nextByte(state);
  if (b === BYTE_EQ) {
    state.offset = state.offset + 1;
    return ["~=", undefined];
  }
  return ["~", undefined];
}

function lexColon(state: LexerState): TokenResult {
  const b = nextByte(state);
  if (b === BYTE_COLON) {
    state.offset = state.offset + 1;
    return ["::", undefined];
  }
  return [":", undefined];
}

function lexDot(state: LexerState): TokenResult {
  let b = nextByte(state);

  if (b === BYTE_DOT) {
    b = nextByte(state);
    if (b === BYTE_DOT) {
      state.offset = state.offset + 1;
      return ["...", "..."];
    }
    return ["..", undefined];
  } else if (b !== undefined && toDec(b) !== undefined) {
    state.offset = state.offset - 2;
    return lexNumber(state, nextByte(state));
  }
  return [".", undefined];
}

function lexAny(state: LexerState, bIn: number): TokenResult {
  state.offset = state.offset + 1;
  const b = bIn > 255 ? 255 : bIn;
  return [String.fromCharCode(b), undefined];
}

type ByteHandler = (state: LexerState, b: number) => TokenResult;

const BYTE_HANDLERS: Record<number, ByteHandler> = {
  [BYTE_DOT]: lexDot,
  [BYTE_COLON]: lexColon,
  [BYTE_OBRACK]: lexBracket,
  [BYTE_QUOTE]: lexShortString,
  [BYTE_DQUOTE]: lexShortString,
  [BYTE_DASH]: lexDash,
  [BYTE_SLASH]: lexDiv,
  [BYTE_EQ]: lexEq,
  [BYTE_NE]: lexNe,
  [BYTE_LT]: lexLt,
  [BYTE_GT]: lexGt,
  [BYTE_LDASH]: lexIdent,
};

for (let b = BYTE_0; b <= BYTE_9; b++) BYTE_HANDLERS[b] = lexNumber;
for (let b = BYTE_a; b <= BYTE_z; b++) BYTE_HANDLERS[b] = lexIdent;
for (let b = BYTE_A; b <= BYTE_Z; b++) BYTE_HANDLERS[b] = lexIdent;

/** Creates lexer state for `src`. */
export function newState(
  src: Chars,
  lineOffsets?: number[],
  lineLengths?: number[],
): LexerState {
  const state: LexerState = {
    src,
    line: 1,
    lineOffsets: lineOffsets ?? [],
    lineLengths: lineLengths ?? [],
    offset: 1,
  };

  state.lineOffsets[1] = 1;

  if (src.getLength() >= 2 && src.getSubstring(1, 2) === "#!") {
    state.offset = 2;
    skipToNewline(state, nextByte(state));
  }

  return state;
}

export function getQuotedSubstringOrLine(
  state: LexerState,
  line: number,
  offsetIn: number,
  endOffsetIn: number,
): string {
  const lineLength = state.lineLengths[line];
  let endOffset = endOffsetIn;

  if (lineLength !== undefined) {
    const lineEndOffset = state.lineOffsets[line] + lineLength - 1;
    if (lineEndOffset < endOffset) {
      endOffset = lineEndOffset;
    }
  }

  return "'" + state.src.getPrintableSubstring(offsetIn, endOffset) + "'";
}

/**
 * Result of `nextToken`: `[token, value, line, offset, endOffsetOrErrorEnd]`.
 * On success, `token` is the token name (or `null` only together with a
 * falsy 5th slot for the rare "no detailed offset" error path — see below).
 * On error, `token` is `null` and `value` is the error message; the 5th
 * slot is the error's end offset.
 */
export type NextTokenResult = [
  string | null,
  string | undefined,
  number,
  number,
  number | undefined,
];

/**
 * Looks for the next token starting from `state.line`/`state.offset`.
 * Mutates `state` to the token's end location + 1, and fills
 * `state.lineOffsets`/`state.lineLengths`.
 */
export function nextToken(state: LexerState): NextTokenResult {
  const lineOffsets = state.lineOffsets;
  const b = skipSpace(state, state.src.getCodepoint(state.offset));

  const tokenLine = state.line;
  const lineOffset = lineOffsets[tokenLine];
  const tokenOffset = state.offset;

  if (b === undefined) {
    state.offset = state.offset + 1;
    state.lineLengths[tokenLine] = tokenOffset - lineOffset;
    return ["eof", undefined, tokenLine, tokenOffset, undefined];
  }

  const handler = BYTE_HANDLERS[b] ?? lexAny;
  const [token, tokenValue, relativeErrorOffset] = handler(state, b);

  if (relativeErrorOffset !== undefined) {
    const errorOffset = state.offset + relativeErrorOffset;
    const errorEndOffset = Math.min(state.offset, state.src.getLength());
    const errorMessage = `${tokenValue} ${
      getQuotedSubstringOrLine(state, state.line, errorOffset, errorEndOffset)
    }`;
    return [null, errorMessage, state.line, errorOffset, errorEndOffset];
  }

  return [
    token,
    tokenValue,
    tokenLine,
    tokenOffset,
    token === null ? tokenOffset : undefined,
  ];
}
