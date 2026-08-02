/**
 * Ported busted spec: .reference/luacheck/spec/lexer_spec.lua
 *
 * Translation notes:
 *
 * - Source snippets that were Lua long-bracket (`[[...]]`) literals in the
 *   original spec (used there to avoid escaping quotes/backslashes) are
 *   written here with `String.raw` template literals, which preserve
 *   backslashes and newlines verbatim, matching how `[[...]]` performs no
 *   escape processing. This is a mechanical, low-risk translation: the
 *   template's raw text is the same bytes the busted spec embeds.
 * - Expected *values* (where the original spec used a regular, escape-
 *   processing Lua string, e.g. `"\r\n"`) are written as plain (non-raw)
 *   TS strings, since JS escape processing matches Lua's for the simple
 *   escapes used here (`\r \n \t \0 \xHH`).
 * - `get_token` (no line/offset) and `get_tokens` (line/offset included)
 *   map to `getToken`/`getTokens` returning objects with `tokenValue`
 *   present only when the original token had a value (mirrors Lua's nil
 *   field being simply absent from the table, for exact `assertEquals`).
 */

import { assertEquals } from "@std/assert";
import { decode } from "./decoder.ts";
import { type LexerState, newState, nextToken } from "./lexer.ts";

function newStateFromSourceBytes(bytes: string): LexerState {
  return newState(decode(bytes));
}

interface Token {
  token: string;
  tokenValue?: string;
  line?: number;
  offset?: number;
}

function getTokens(source: string): Token[] {
  const state = newStateFromSourceBytes(source);
  const tokens: Token[] = [];
  let token: Token;

  do {
    const [t, v, line, offset] = nextToken(state);
    token = {
      token: t as string,
      ...(v !== undefined ? { tokenValue: v } : {}),
      line,
      offset,
    };
    tokens.push(token);
  } while (token.token !== "eof");

  return tokens;
}

function getToken(source: string): { token: string; tokenValue?: string } {
  const state = newStateFromSourceBytes(source);
  const [t, v] = nextToken(state);
  return { token: t as string, ...(v !== undefined ? { tokenValue: v } : {}) };
}

interface LexError {
  msg: string;
  line: number;
  offset: number;
  endOffset: number;
}

function maybeError(state: LexerState): LexError | undefined {
  const [ok, msg, line, offset, endOffset] = nextToken(state);
  return ok === null
    ? { msg: msg as string, line, offset, endOffset: endOffset as number }
    : undefined;
}

function getError(source: string): LexError | undefined {
  return maybeError(newStateFromSourceBytes(source));
}

function getLastError(source: string): LexError | undefined {
  const state = newStateFromSourceBytes(source);
  let err: LexError | undefined;

  do {
    err = maybeError(state);
  } while (!err);

  return err;
}

Deno.test("lexer", async (t) => {
  await t.step("parses EOS correctly", () => {
    assertEquals(getToken(" "), { token: "eof" });
  });

  await t.step("parses names correctly", () => {
    assertEquals(getToken("foo"), { token: "name", tokenValue: "foo" });
    assertEquals(getToken("_"), { token: "name", tokenValue: "_" });
    assertEquals(getToken("foo1_2"), { token: "name", tokenValue: "foo1_2" });
    assertEquals(getToken("foo!"), { token: "name", tokenValue: "foo" });
  });

  await t.step("parses keywords correctly", () => {
    assertEquals(getToken("do"), { token: "do" });
    assertEquals(getToken("goto fail;"), { token: "goto" });
  });

  await t.step("parses operators and special tokens correctly", () => {
    assertEquals(getToken("= ="), { token: "=" });
    assertEquals(getToken("=="), { token: "==" });
    assertEquals(getToken("< ="), { token: "<" });
    assertEquals(getToken("<="), { token: "<=" });
    assertEquals(getToken("<<"), { token: "<<" });
    assertEquals(getToken("> ="), { token: ">" });
    assertEquals(getToken(">="), { token: ">=" });
    assertEquals(getToken(">>"), { token: ">>" });
    assertEquals(getToken("/ /"), { token: "/" });
    assertEquals(getToken("//"), { token: "//" });
    assertEquals(getToken(".?."), { token: "." });
    assertEquals(getToken("."), { token: "." });
    assertEquals(getToken("..%"), { token: ".." });
    assertEquals(getToken("..."), { token: "...", tokenValue: "..." });
    assertEquals(getToken(":.:"), { token: ":" });
    assertEquals(getToken("::."), { token: "::" });
  });

  await t.step("parses single character tokens correctly", () => {
    assertEquals(getToken("(("), { token: "(" });
    assertEquals(getToken("[x]"), { token: "[" });
    assertEquals(getToken("$$$"), { token: "$" });
  });

  await t.step("when parsing short strings", async (t) => {
    await t.step("parses empty short strings correctly", () => {
      assertEquals(getToken('""'), { token: "string", tokenValue: "" });
      assertEquals(getToken("''"), { token: "string", tokenValue: "" });
    });

    await t.step(
      "parses short strings containing quotation marks correctly",
      () => {
        assertEquals(getToken(String.raw`"'"`), {
          token: "string",
          tokenValue: "'",
        });
        assertEquals(getToken(String.raw`'"'`), {
          token: "string",
          tokenValue: '"',
        });
      },
    );

    await t.step("parses simple short strings correctly", () => {
      assertEquals(getToken(String.raw`"foo"`), {
        token: "string",
        tokenValue: "foo",
      });
    });

    await t.step("parses simple escape sequences correctly", () => {
      assertEquals(getToken(String.raw`"\r\n"`), {
        token: "string",
        tokenValue: "\r\n",
      });
      assertEquals(getToken(String.raw`"foo\\bar"`), {
        token: "string",
        tokenValue: "foo\\bar",
      });
      assertEquals(getToken(String.raw`"a\'\'b\"\""`), {
        token: "string",
        tokenValue: `a''b""`,
      });
    });

    await t.step("parses escaped newline correctly", () => {
      assertEquals(
        getToken(String.raw`"foo \
bar"`),
        { token: "string", tokenValue: "foo \nbar" },
      );
      assertEquals(
        getToken(String.raw`"foo \
\
\
bar"`),
        { token: "string", tokenValue: "foo \n\n\nbar" },
      );
    });

    await t.step("parses \\z correctly", () => {
      assertEquals(getToken(String.raw`"foo \z"`), {
        token: "string",
        tokenValue: "foo ",
      });
      assertEquals(getToken(String.raw`"foo \zbar"`), {
        token: "string",
        tokenValue: "foo bar",
      });
      assertEquals(getToken(String.raw`"foo \z bar"`), {
        token: "string",
        tokenValue: "foo bar",
      });
      assertEquals(
        getToken(String.raw`"foo \z 

            bar\z "`),
        { token: "string", tokenValue: "foo bar" },
      );
    });

    await t.step("parses decimal escape sequences correctly", () => {
      assertEquals(getToken(String.raw`"\0buffer exploit"`), {
        token: "string",
        tokenValue: "\0buffer exploit",
      });
      assertEquals(getToken(String.raw`"foo b\97r"`), {
        token: "string",
        tokenValue: "foo bar",
      });
      assertEquals(getToken(String.raw`"\1234"`), {
        token: "string",
        tokenValue: "\x7B4",
      });
      assertEquals(getError(String.raw`"\300"`), {
        line: 1,
        offset: 2,
        endOffset: 5,
        msg: "invalid decimal escape sequence '\\300'",
      });
      // A trailing lone backslash can't appear right before the closing
      // backtick of a String.raw template (JS's tokenizer always reads
      // `\`` as an escaped backtick when scanning for the template's end),
      // so this one case is built by concatenation instead.
      assertEquals(getError('"' + "\\"), {
        line: 1,
        offset: 2,
        endOffset: 2,
        msg: "invalid escape sequence '\\'",
      });
    });

    await t.step("parses hexadecimal escape sequences correctly", () => {
      assertEquals(getToken(String.raw`"\x00buffer exploit"`), {
        token: "string",
        tokenValue: "\0buffer exploit",
      });
      assertEquals(getToken(String.raw`"foo\x20bar"`), {
        token: "string",
        tokenValue: "foo bar",
      });
      assertEquals(getToken(String.raw`"\x6a\x6A"`), {
        token: "string",
        tokenValue: "jj",
      });
      assertEquals(getError(String.raw`"\XFF"`), {
        line: 1,
        offset: 2,
        endOffset: 3,
        msg: "invalid escape sequence '\\X'",
      });
      assertEquals(getError(String.raw`"\x"`), {
        line: 1,
        offset: 2,
        endOffset: 4,
        msg: "invalid hexadecimal escape sequence '\\x\"'",
      });
      assertEquals(getError(String.raw`"\x1"`), {
        line: 1,
        offset: 2,
        endOffset: 5,
        msg: "invalid hexadecimal escape sequence '\\x1\"'",
      });
      assertEquals(getError(String.raw`"\x1`), {
        line: 1,
        offset: 2,
        endOffset: 4,
        msg: "invalid hexadecimal escape sequence '\\x1'",
      });
      assertEquals(getError(String.raw`"\xxx"`), {
        line: 1,
        offset: 2,
        endOffset: 4,
        msg: "invalid hexadecimal escape sequence '\\xx'",
      });
    });

    await t.step("parses utf-8 escape sequences correctly", () => {
      assertEquals(getToken(String.raw`"\u{0}\u{00000000}"`), {
        token: "string",
        tokenValue: "\0\0",
      });
      assertEquals(getToken(String.raw`"\u{0}\u{7F}"`), {
        token: "string",
        tokenValue: "\0\x7F",
      });
      assertEquals(getToken(String.raw`"\u{80}\u{7fF}"`), {
        token: "string",
        tokenValue: "\xC2\x80\xDF\xBF",
      });
      assertEquals(getToken(String.raw`"\u{800}\u{FFFF}"`), {
        token: "string",
        tokenValue: "\xE0\xA0\x80\xEF\xBF\xBF",
      });
      assertEquals(getToken(String.raw`"\u{10000}\u{10FFFF}"`), {
        token: "string",
        tokenValue: "\xF0\x90\x80\x80\xF4\x8F\xBF\xBF",
      });
      assertEquals(getError(String.raw`"\u{110000000}"`), {
        line: 1,
        offset: 2,
        endOffset: 13,
        msg: "invalid UTF-8 escape sequence '\\u{110000000'",
      });
      assertEquals(getError(String.raw`"\u"`), {
        line: 1,
        offset: 2,
        endOffset: 4,
        msg: "invalid UTF-8 escape sequence '\\u\"'",
      });
      assertEquals(getError(String.raw`"\unrelated"`), {
        line: 1,
        offset: 2,
        endOffset: 4,
        msg: "invalid UTF-8 escape sequence '\\un'",
      });
      assertEquals(getError(String.raw`"\u{11unrelated"`), {
        line: 1,
        offset: 2,
        endOffset: 7,
        msg: "invalid UTF-8 escape sequence '\\u{11u'",
      });
      assertEquals(getError(String.raw`"\u{11`), {
        line: 1,
        offset: 2,
        endOffset: 6,
        msg: "invalid UTF-8 escape sequence '\\u{11'",
      });
      assertEquals(getError(String.raw`"\u{unrelated}"`), {
        line: 1,
        offset: 2,
        endOffset: 5,
        msg: "invalid UTF-8 escape sequence '\\u{u'",
      });
      assertEquals(getError(String.raw`"\u{`), {
        line: 1,
        offset: 2,
        endOffset: 4,
        msg: "invalid UTF-8 escape sequence '\\u{'",
      });
    });

    await t.step("detects unknown escape sequences", () => {
      assertEquals(getError(String.raw`"\c"`), {
        line: 1,
        offset: 2,
        endOffset: 3,
        msg: "invalid escape sequence '\\c'",
      });
    });

    await t.step("detects unfinished strings", () => {
      assertEquals(getError(String.raw`"`), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "unfinished string",
      });
      assertEquals(getError(String.raw`"'`), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "unfinished string",
      });
      assertEquals(
        getError(String.raw`"
"`),
        { line: 1, offset: 1, endOffset: 1, msg: "unfinished string" },
      );
    });
  });

  await t.step("when parsing long strings", async (t) => {
    await t.step("parses empty long strings correctly", () => {
      assertEquals(getToken("[[]]"), { token: "string", tokenValue: "" });
      assertEquals(getToken("[===[]===]"), { token: "string", tokenValue: "" });
    });

    await t.step("parses simple long strings correctly", () => {
      assertEquals(getToken("[[foo]]"), { token: "string", tokenValue: "foo" });
      assertEquals(getToken("[===['foo'\n'bar'\n]===]"), {
        token: "string",
        tokenValue: "'foo'\n'bar'\n",
      });
    });

    await t.step("skips first newline", () => {
      assertEquals(getToken("[[\n]]"), { token: "string", tokenValue: "" });
      assertEquals(getToken("[===[\n\n]===]"), {
        token: "string",
        tokenValue: "\n",
      });
    });

    await t.step("ignores closing brackets of unrelated length", () => {
      assertEquals(getToken("[[]=] ]]"), {
        token: "string",
        tokenValue: "]=] ",
      });
      assertEquals(getToken("[===[foo]]\n]=== ]]]===]"), {
        token: "string",
        tokenValue: "foo]]\n]=== ]]",
      });
    });

    await t.step("detects invalid opening brackets", () => {
      assertEquals(getError("[="), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "invalid long string delimiter",
      });
      assertEquals(getError("[=|"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "invalid long string delimiter",
      });
    });

    await t.step("detects unfinished long strings", () => {
      assertEquals(getError("[=[\n"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "unfinished long string",
      });
      assertEquals(getError("[[]"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "unfinished long string",
      });
    });
  });

  await t.step("when parsing numbers", async (t) => {
    await t.step("parses decimal integers correctly", () => {
      assertEquals(getToken("0"), { token: "number", tokenValue: "0" });
      assertEquals(getToken("123456789"), {
        token: "number",
        tokenValue: "123456789",
      });
    });

    await t.step("parses hexadecimal integers correctly", () => {
      assertEquals(getToken("0x0"), { token: "number", tokenValue: "0x0" });
      assertEquals(getToken("0X0"), { token: "number", tokenValue: "0X0" });
      assertEquals(getToken("0xFfab"), {
        token: "number",
        tokenValue: "0xFfab",
      });
      assertEquals(getError("0x"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
    });

    await t.step("parses decimal floats correctly", () => {
      assertEquals(getToken("0.0"), { token: "number", tokenValue: "0.0" });
      assertEquals(getToken("0."), { token: "number", tokenValue: "0." });
      assertEquals(getToken(".1234"), { token: "number", tokenValue: ".1234" });
    });

    await t.step("parses hexadecimal floats correctly", () => {
      assertEquals(getToken("0xf.A"), { token: "number", tokenValue: "0xf.A" });
      assertEquals(getToken("0x9."), { token: "number", tokenValue: "0x9." });
      assertEquals(getToken("0x.b"), { token: "number", tokenValue: "0x.b" });
      assertEquals(getError("0x."), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
    });

    await t.step("parses decimal floats with exponent correctly", () => {
      assertEquals(getToken("1.8e1"), { token: "number", tokenValue: "1.8e1" });
      assertEquals(getToken(".8e-1"), { token: "number", tokenValue: ".8e-1" });
      assertEquals(getToken("1.E+20"), {
        token: "number",
        tokenValue: "1.E+20",
      });
      assertEquals(getError("1.8e"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
      assertEquals(getError("1.8e-"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
      assertEquals(getError("1.8E+"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
      assertEquals(getError("1.8ee"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
      assertEquals(getError("1.8e-e"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
      assertEquals(getError("1.8E+i"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
    });

    await t.step("parses hexadecimal floats with exponent correctly", () => {
      assertEquals(getToken("0x1.8p1"), {
        token: "number",
        tokenValue: "0x1.8p1",
      });
      assertEquals(getToken("0x.8P-1"), {
        token: "number",
        tokenValue: "0x.8P-1",
      });
      assertEquals(getToken("0x1.p+20"), {
        token: "number",
        tokenValue: "0x1.p+20",
      });
      assertEquals(getError("0x1.8p"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
      assertEquals(getError("0x1.8p-"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
      assertEquals(getError("0x1.8P+"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
      assertEquals(getError("0x1.8pF"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
      assertEquals(getError("0x1.8p-F"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
      assertEquals(getError("0x1.8p+LL"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
      assertEquals(getError("0x.p1"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "malformed number",
      });
    });

    await t.step("parses 64 bits cdata literals correctly", () => {
      assertEquals(getToken("1LL"), { token: "number", tokenValue: "1LL" });
      assertEquals(getToken("1ll"), { token: "number", tokenValue: "1ll" });
      assertEquals(getToken("1Ll"), { token: "number", tokenValue: "1Ll" });
      assertEquals(getToken("1lL"), { token: "number", tokenValue: "1lL" });
      assertEquals(getToken("1ULL"), { token: "number", tokenValue: "1ULL" });
      assertEquals(getToken("1uLl"), { token: "number", tokenValue: "1uLl" });
      assertEquals(getToken("1LLu"), { token: "number", tokenValue: "1LLu" });
      assertEquals(getToken("1L"), { token: "number", tokenValue: "1" });
      assertEquals(getToken("1LLG"), { token: "number", tokenValue: "1LL" });
      assertEquals(getToken("1LUL"), { token: "number", tokenValue: "1" });
      assertEquals(getToken("0x1LL"), { token: "number", tokenValue: "0x1LL" });
      assertEquals(getToken("1.0LL"), { token: "number", tokenValue: "1.0" });
    });

    await t.step("parses complex cdata literals correctly", () => {
      assertEquals(getToken("1i"), { token: "number", tokenValue: "1i" });
      assertEquals(getToken("1I"), { token: "number", tokenValue: "1I" });
      assertEquals(getToken("1j"), { token: "number", tokenValue: "1" });
      assertEquals(getToken("1LLi"), { token: "number", tokenValue: "1LL" });
      assertEquals(getToken("0x1i"), { token: "number", tokenValue: "0x1i" });
      assertEquals(getToken("0x1.0i"), {
        token: "number",
        tokenValue: "0x1.0i",
      });
    });
  });

  await t.step("parses short comments correctly", () => {
    assertEquals(getToken("--"), { token: "short_comment", tokenValue: "" });
    assertEquals(getToken("--foo\nbar"), {
      token: "short_comment",
      tokenValue: "foo",
    });
    assertEquals(getToken("--["), { token: "short_comment", tokenValue: "[" });
    assertEquals(getToken("--[=foo\nbar"), {
      token: "short_comment",
      tokenValue: "[=foo",
    });
  });

  await t.step("parses long comments correctly", () => {
    assertEquals(getToken("--[[]]"), { token: "long_comment", tokenValue: "" });
    assertEquals(getToken("--[[\n]]"), {
      token: "long_comment",
      tokenValue: "",
    });
    assertEquals(getToken("--[[foo\nbar]]"), {
      token: "long_comment",
      tokenValue: "foo\nbar",
    });
    assertEquals(getError("--[=[]]"), {
      line: 1,
      offset: 1,
      endOffset: 1,
      msg: "unfinished long comment",
    });
  });

  await t.step("provides correct location info", () => {
    const source = String.raw`local function foo(bar)
   return bar:get_foo[=[
long string
]=]
end
-- hello
print "1\z
       2\z
       3\n"
-- this comment ends just before EOF`;

    assertEquals(getTokens(source), [
      { token: "local", line: 1, offset: 1 },
      { token: "function", line: 1, offset: 7 },
      { token: "name", tokenValue: "foo", line: 1, offset: 16 },
      { token: "(", line: 1, offset: 19 },
      { token: "name", tokenValue: "bar", line: 1, offset: 20 },
      { token: ")", line: 1, offset: 23 },
      { token: "return", line: 2, offset: 28 },
      { token: "name", tokenValue: "bar", line: 2, offset: 35 },
      { token: ":", line: 2, offset: 38 },
      { token: "name", tokenValue: "get_foo", line: 2, offset: 39 },
      { token: "string", tokenValue: "long string\n", line: 2, offset: 46 },
      { token: "end", line: 5, offset: 66 },
      { token: "short_comment", tokenValue: " hello", line: 6, offset: 70 },
      { token: "name", tokenValue: "print", line: 7, offset: 79 },
      { token: "string", tokenValue: "123\n", line: 7, offset: 85 },
      {
        token: "short_comment",
        tokenValue: " this comment ends just before EOF",
        line: 10,
        offset: 113,
      },
      { token: "eof", line: 10, offset: 149 },
    ]);
  });

  await t.step("provides correct location info for errors", () => {
    assertEquals(
      getLastError(String.raw`local function foo(bar)
   return bar:get_foo[=[
long string
]=]
end

print "1\g
       2\z
       3\n"
`),
      {
        line: 7,
        offset: 79,
        endOffset: 80,
        msg: "invalid escape sequence '\\g'",
      },
    );

    assertEquals(
      getLastError(String.raw`local function foo(bar)
   return bar:get_foo[=[
long string
]=]
end

print "1\
       2\300
       3\n"
`),
      {
        line: 8,
        offset: 89,
        endOffset: 92,
        msg: "invalid decimal escape sequence '\\300'",
      },
    );

    assertEquals(
      getLastError(String.raw`local function foo(bar)
   return bar:get_foo[=[
long string
]=]
end

print (
0xx)
`),
      { line: 8, offset: 79, endOffset: 79, msg: "malformed number" },
    );

    assertEquals(
      getLastError(String.raw`local function foo(bar)
   return bar:get_foo[=[
long string
]=]
end

print "1\z
       2\z
       3\n
`),
      { line: 7, offset: 77, endOffset: 77, msg: "unfinished string" },
    );
  });

  await t.step("parses minified source correctly", () => {
    assertEquals(getTokens("a,b=4llf=''function _()return 1or''end"), [
      { token: "name", tokenValue: "a", line: 1, offset: 1 },
      { token: ",", line: 1, offset: 2 },
      { token: "name", tokenValue: "b", line: 1, offset: 3 },
      { token: "=", line: 1, offset: 4 },
      { token: "number", tokenValue: "4ll", line: 1, offset: 5 },
      { token: "name", tokenValue: "f", line: 1, offset: 8 },
      { token: "=", line: 1, offset: 9 },
      { token: "string", tokenValue: "", line: 1, offset: 10 },
      { token: "function", line: 1, offset: 12 },
      { token: "name", tokenValue: "_", line: 1, offset: 21 },
      { token: "(", line: 1, offset: 22 },
      { token: ")", line: 1, offset: 23 },
      { token: "return", line: 1, offset: 24 },
      { token: "number", tokenValue: "1", line: 1, offset: 31 },
      { token: "or", line: 1, offset: 32 },
      { token: "string", tokenValue: "", line: 1, offset: 34 },
      { token: "end", line: 1, offset: 36 },
      { token: "eof", line: 1, offset: 39 },
    ]);
  });

  await t.step("handles argparse sample", () => {
    const fileBytes = Deno.readFileSync(
      new URL("./testdata/argparse-0.2.0.lua", import.meta.url),
    );
    let bytes = "";
    for (const b of fileBytes) bytes += String.fromCharCode(b);
    getTokens(bytes);
  });
});
