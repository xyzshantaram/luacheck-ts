/**
 * Ported busted spec: .reference/luacheck/spec/parser_spec.lua
 *
 * Translation notes:
 *
 * - Source snippets that were Lua long-bracket (`[[...]]`) literals in the
 *   original spec are written here with `String.raw` template literals
 *   (same convention as lexer_test.ts), with one exception: when Lua's
 *   `[[` is immediately followed by a newline, that newline is stripped by
 *   the language and is *not* part of the string, so the corresponding
 *   `String.raw` template starts directly with the first line of content
 *   (no leading blank line) to keep line/offset numbers identical.
 * - AST nodes are plain objects with a 1-based array part (see parser.ts's
 *   header comment), so a Lua node literal `{tag = "X", {tag = "Y", "z"}}`
 *   becomes `{ tag: "X", 1: { tag: "Y", 1: "z" } }` here: Lua's positional
 *   table-constructor slots become explicit numeric keys.
 * - `assert.same(expected, actual)` (Lua) has swapped argument order from
 *   `assertEquals(actual, expected)` (here) - preserved throughout.
 * - `get_error` in the original spec just returns whatever `pcall` caught,
 *   untyped. Here it asserts a `SyntaxError` was thrown and returns a
 *   *plain* shallow copy of its own fields: `assertEquals` (unlike
 *   busted's `assert.same`) treats values with different prototypes as
 *   unequal even when their fields match, so comparing the thrown
 *   `SyntaxError` instance directly against a plain expected object
 *   literal would always fail.
 */

import { assertEquals } from "@std/assert";
import { decode } from "./decoder.ts";
import {
  type AstNode,
  parse,
  type ParseResult,
  SyntaxError,
} from "./parser.ts";

function stripLocations(node: AstNode): void {
  delete node.line;
  delete node.offset;
  delete node.endOffset;
  delete node.endRange;

  let i = 1;
  while (node[String(i)] !== undefined) {
    const sub = node[String(i)];
    if (sub && typeof sub === "object") {
      stripLocations(sub as AstNode);
    }
    i++;
  }
}

function getAll(srcBytes: string): ParseResult {
  return parse(decode(srcBytes));
}

function getFullAst(src: string): AstNode {
  return getAll(src).ast;
}

function getAst(src: string): AstNode {
  const ast = getAll(src).ast;
  stripLocations(ast);
  return ast;
}

function getNode(src: string): AstNode {
  return getAst(src)["1"] as AstNode;
}

function getExpr(src: string): AstNode {
  return getNode("return " + src)["1"] as AstNode;
}

function getComments(src: string) {
  return getAll(src).comments;
}

function getCodeLines(src: string) {
  return getAll(src).codeLines;
}

function getLineEndings(src: string) {
  return getAll(src).lineEndings;
}

function getError(src: string): Record<string, unknown> {
  try {
    getAll(src);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return { ...(err as Record<string, unknown>) };
    }
    throw err;
  }
  throw new Error("expected a parse error, got none");
}

Deno.test("parser", async (t) => {
  await t.step("parses empty source correctly", () => {
    assertEquals(getAst(" "), {});
  });

  await t.step("does not allow extra ending keywords", () => {
    assertEquals(getError("end"), {
      line: 1,
      offset: 1,
      endOffset: 3,
      msg: "expected <eof> near 'end'",
    });
  });

  await t.step("parses return statement correctly", () => {
    assertEquals(getNode("return"), { tag: "Return" });
    assertEquals(getNode("return 1"), {
      tag: "Return",
      1: { tag: "Number", 1: "1" },
    });
    assertEquals(getNode("return 1, 'foo'"), {
      tag: "Return",
      1: { tag: "Number", 1: "1" },
      2: { tag: "String", 1: "foo" },
    });
    assertEquals(getError("return 1,"), {
      line: 1,
      offset: 10,
      endOffset: 10,
      msg: "expected expression near <eof>",
    });
  });

  await t.step("parses labels correctly", () => {
    assertEquals(getNode("::fail::"), { tag: "Label", 1: "fail" });
    assertEquals(getNode("::\nfail\n::"), { tag: "Label", 1: "fail" });
    assertEquals(getError("::::"), {
      line: 1,
      offset: 3,
      endOffset: 4,
      msg: "expected identifier near '::'",
    });
    assertEquals(getError("::1::"), {
      line: 1,
      offset: 3,
      endOffset: 3,
      msg: "expected identifier near '1'",
    });
  });

  await t.step("parses goto correctly", () => {
    assertEquals(getNode("goto fail"), { tag: "Goto", 1: "fail" });
    assertEquals(getError("goto"), {
      line: 1,
      offset: 5,
      endOffset: 5,
      msg: "expected identifier near <eof>",
    });
    assertEquals(getError("goto foo, bar"), {
      line: 1,
      offset: 9,
      endOffset: 9,
      msg: "expected statement near ','",
    });
  });

  await t.step("parses break correctly", () => {
    assertEquals(getNode("break"), { tag: "Break" });
    assertEquals(getError("break fail"), {
      line: 1,
      offset: 11,
      endOffset: 11,
      msg: "expected '=' near <eof>",
    });
  });

  await t.step("parses do end correctly", () => {
    assertEquals(getNode("do end"), { tag: "Do" });
    assertEquals(getError("do"), {
      line: 1,
      offset: 3,
      endOffset: 3,
      prevLine: 1,
      prevOffset: 1,
      prevEndOffset: 2,
      msg: "expected 'end' near <eof>",
    });
    assertEquals(getError("do until false"), {
      line: 1,
      offset: 4,
      endOffset: 8,
      prevLine: 1,
      prevOffset: 1,
      prevEndOffset: 2,
      msg: "expected 'end' near 'until'",
    });
    assertEquals(getError("do\nuntil false"), {
      line: 2,
      offset: 4,
      endOffset: 8,
      prevLine: 1,
      prevOffset: 1,
      prevEndOffset: 2,
      msg: "expected 'end' (to close 'do' on line 1) near 'until'",
    });
  });

  await t.step("parses while do end correctly", () => {
    assertEquals(getNode("while true do end"), {
      tag: "While",
      1: { tag: "True" },
      2: {},
    });
    assertEquals(getError("while"), {
      line: 1,
      offset: 6,
      endOffset: 6,
      msg: "expected condition near <eof>",
    });
    assertEquals(getError("while true"), {
      line: 1,
      offset: 11,
      endOffset: 11,
      msg: "expected 'do' near <eof>",
    });
    assertEquals(getError("while true do"), {
      line: 1,
      offset: 14,
      endOffset: 14,
      prevLine: 1,
      prevOffset: 1,
      prevEndOffset: 5,
      msg: "expected 'end' near <eof>",
    });
    assertEquals(getError("while true\ndo"), {
      line: 2,
      offset: 14,
      endOffset: 14,
      prevLine: 1,
      prevOffset: 1,
      prevEndOffset: 5,
      msg: "expected 'end' (to close 'while' on line 1) near <eof>",
    });
    assertEquals(getError("while do end"), {
      line: 1,
      offset: 7,
      endOffset: 8,
      msg: "expected condition near 'do'",
    });
    assertEquals(getError("while true, false do end"), {
      line: 1,
      offset: 11,
      endOffset: 11,
      msg: "expected 'do' near ','",
    });
  });

  await t.step("parses repeat until correctly", () => {
    assertEquals(getNode("repeat until true"), {
      tag: "Repeat",
      1: {},
      2: { tag: "True" },
    });
    assertEquals(getError("repeat"), {
      line: 1,
      offset: 7,
      endOffset: 7,
      prevLine: 1,
      prevOffset: 1,
      prevEndOffset: 6,
      msg: "expected 'until' near <eof>",
    });
    assertEquals(getError("repeat\n--"), {
      line: 2,
      offset: 10,
      endOffset: 10,
      prevLine: 1,
      prevOffset: 1,
      prevEndOffset: 6,
      msg: "expected 'until' (to close 'repeat' on line 1) near <eof>",
    });
    assertEquals(getError("repeat until"), {
      line: 1,
      offset: 13,
      endOffset: 13,
      msg: "expected condition near <eof>",
    });
    assertEquals(getError("repeat until true, false"), {
      line: 1,
      offset: 18,
      endOffset: 18,
      msg: "expected statement near ','",
    });
  });

  await t.step("when parsing if", async (t) => {
    await t.step("parses if then end correctly", () => {
      assertEquals(getNode("if true then end"), {
        tag: "If",
        1: { tag: "True" },
        2: {},
      });
      assertEquals(getError("if"), {
        line: 1,
        offset: 3,
        endOffset: 3,
        msg: "expected condition near <eof>",
      });
      assertEquals(getError("if true"), {
        line: 1,
        offset: 8,
        endOffset: 8,
        msg: "expected 'then' near <eof>",
      });
      assertEquals(getError("if true then"), {
        line: 1,
        offset: 13,
        endOffset: 13,
        prevLine: 1,
        prevOffset: 1,
        prevEndOffset: 2,
        msg: "expected 'end' near <eof>",
      });
      assertEquals(getError("if true\nthen"), {
        line: 2,
        offset: 13,
        endOffset: 13,
        prevLine: 1,
        prevOffset: 1,
        prevEndOffset: 2,
        msg: "expected 'end' (to close 'if' on line 1) near <eof>",
      });
      assertEquals(getError("if then end"), {
        line: 1,
        offset: 4,
        endOffset: 7,
        msg: "expected condition near 'then'",
      });
      assertEquals(getError("if true, false then end"), {
        line: 1,
        offset: 8,
        endOffset: 8,
        msg: "expected 'then' near ','",
      });
    });

    await t.step("parses if then else end correctly", () => {
      assertEquals(getNode("if true then else end"), {
        tag: "If",
        1: { tag: "True" },
        2: {},
        3: {},
      });
      assertEquals(getError("if true then else"), {
        line: 1,
        offset: 18,
        endOffset: 18,
        prevLine: 1,
        prevOffset: 14,
        prevEndOffset: 17,
        msg: "expected 'end' near <eof>",
      });
      assertEquals(getError("if true\nthen else\n"), {
        line: 3,
        offset: 19,
        endOffset: 19,
        prevLine: 2,
        prevOffset: 14,
        prevEndOffset: 17,
        msg: "expected 'end' (to close 'else' on line 2) near <eof>",
      });
      assertEquals(getError("if true then else else end"), {
        line: 1,
        offset: 19,
        endOffset: 22,
        prevLine: 1,
        prevOffset: 14,
        prevEndOffset: 17,
        msg: "expected 'end' near 'else'",
      });
    });

    await t.step("parses if then elseif then end correctly", () => {
      assertEquals(getNode("if true then elseif false then end"), {
        tag: "If",
        1: { tag: "True" },
        2: {},
        3: { tag: "False" },
        4: {},
      });
      assertEquals(getError("if true then elseif end"), {
        line: 1,
        offset: 21,
        endOffset: 23,
        msg: "expected condition near 'end'",
      });
      assertEquals(getError("if true then elseif then end"), {
        line: 1,
        offset: 21,
        endOffset: 24,
        msg: "expected condition near 'then'",
      });
      assertEquals(getError("if true then elseif a\nthen"), {
        line: 2,
        offset: 27,
        endOffset: 27,
        prevLine: 1,
        prevOffset: 14,
        prevEndOffset: 19,
        msg: "expected 'end' (to close 'elseif' on line 1) near <eof>",
      });
    });

    await t.step("parses if then elseif then else end correctly", () => {
      assertEquals(getNode("if true then elseif false then else end"), {
        tag: "If",
        1: { tag: "True" },
        2: {},
        3: { tag: "False" },
        4: {},
        5: {},
      });
      assertEquals(getError("if true then elseif false then else"), {
        line: 1,
        offset: 36,
        endOffset: 36,
        prevLine: 1,
        prevOffset: 32,
        prevEndOffset: 35,
        msg: "expected 'end' near <eof>",
      });
    });
  });

  await t.step("when parsing for", async (t) => {
    await t.step("parses fornum correctly", () => {
      assertEquals(getNode("for i=1, #t do end"), {
        tag: "Fornum",
        1: { tag: "Id", 1: "i" },
        2: { tag: "Number", 1: "1" },
        3: { tag: "Op", 1: "len", 2: { tag: "Id", 1: "t" } },
        4: {},
      });
      assertEquals(getError("for"), {
        line: 1,
        offset: 4,
        endOffset: 4,
        msg: "expected identifier near <eof>",
      });
      assertEquals(getError("for i"), {
        line: 1,
        offset: 6,
        endOffset: 6,
        msg: "expected '=', ',' or 'in' near <eof>",
      });
      assertEquals(getError("for i ~= 2"), {
        line: 1,
        offset: 7,
        endOffset: 8,
        msg: "expected '=', ',' or 'in' near '~='",
      });
      assertEquals(getError("for i = 2 do end"), {
        line: 1,
        offset: 11,
        endOffset: 12,
        msg: "expected ',' near 'do'",
      });
      assertEquals(getError("for i=1, #t do"), {
        line: 1,
        offset: 15,
        endOffset: 15,
        prevLine: 1,
        prevOffset: 1,
        prevEndOffset: 3,
        msg: "expected 'end' near <eof>",
      });
      assertEquals(getError("for i=1, #t do\na()"), {
        line: 2,
        offset: 16,
        endOffset: 16,
        prevLine: 1,
        prevOffset: 1,
        prevEndOffset: 3,
        msg:
          "expected 'end' (to close 'for' on line 1) near 'a' (indentation-based guess)",
      });
      assertEquals(getError("for (i)=1, #t do end"), {
        line: 1,
        offset: 5,
        endOffset: 5,
        msg: "expected identifier near '('",
      });
      assertEquals(getError("for 3=1, #t do end"), {
        line: 1,
        offset: 5,
        endOffset: 5,
        msg: "expected identifier near '3'",
      });
    });

    await t.step("parses fornum with step correctly", () => {
      assertEquals(getNode("for i=1, #t, 2 do end"), {
        tag: "Fornum",
        1: { tag: "Id", 1: "i" },
        2: { tag: "Number", 1: "1" },
        3: { tag: "Op", 1: "len", 2: { tag: "Id", 1: "t" } },
        4: { tag: "Number", 1: "2" },
        5: {},
      });
      assertEquals(getError("for i=1, #t, 2, 3 do"), {
        line: 1,
        offset: 15,
        endOffset: 15,
        msg: "expected 'do' near ','",
      });
    });

    await t.step("parses forin correctly", () => {
      assertEquals(getNode("for i in t do end"), {
        tag: "Forin",
        1: { 1: { tag: "Id", 1: "i" } },
        2: { 1: { tag: "Id", 1: "t" } },
        3: {},
      });
      assertEquals(getNode("for i, j in t, 'foo' do end"), {
        tag: "Forin",
        1: { 1: { tag: "Id", 1: "i" }, 2: { tag: "Id", 1: "j" } },
        2: { 1: { tag: "Id", 1: "t" }, 2: { tag: "String", 1: "foo" } },
        3: {},
      });
      assertEquals(getError("for in foo do end"), {
        line: 1,
        offset: 5,
        endOffset: 6,
        msg: "expected identifier near 'in'",
      });
      assertEquals(getError("for i in do end"), {
        line: 1,
        offset: 10,
        endOffset: 11,
        msg: "expected expression near 'do'",
      });
    });
  });

  await t.step("when parsing functions", async (t) => {
    await t.step("parses simple function correctly", () => {
      assertEquals(getNode("function a() end"), {
        tag: "Set",
        1: { 1: { tag: "Id", 1: "a" } },
        2: { 1: { tag: "Function", 1: {}, 2: {} } },
      });
      assertEquals(getError("function"), {
        line: 1,
        offset: 9,
        endOffset: 9,
        msg: "expected identifier near <eof>",
      });
      assertEquals(getError("function a"), {
        line: 1,
        offset: 11,
        endOffset: 11,
        msg: "expected '(' near <eof>",
      });
      assertEquals(getError("function a("), {
        line: 1,
        offset: 12,
        endOffset: 12,
        msg: "expected argument near <eof>",
      });
      assertEquals(getError("function a()"), {
        line: 1,
        offset: 13,
        endOffset: 13,
        prevLine: 1,
        prevOffset: 1,
        prevEndOffset: 8,
        msg: "expected 'end' near <eof>",
      });
      assertEquals(getError("function a(\n)"), {
        line: 2,
        offset: 14,
        endOffset: 14,
        prevLine: 1,
        prevOffset: 1,
        prevEndOffset: 8,
        msg: "expected 'end' (to close 'function' on line 1) near <eof>",
      });
      assertEquals(getError("function (a)()"), {
        line: 1,
        offset: 10,
        endOffset: 10,
        msg: "expected identifier near '('",
      });
      assertEquals(getError("function() end"), {
        line: 1,
        offset: 9,
        endOffset: 9,
        msg: "expected identifier near '('",
      });
      assertEquals(getError("(function a() end)"), {
        line: 1,
        offset: 11,
        endOffset: 11,
        msg: "expected '(' near 'a'",
      });
      assertEquals(getError("function a() end()"), {
        line: 1,
        offset: 18,
        endOffset: 18,
        msg: "expected expression near ')'",
      });
    });

    await t.step("parses simple function with arguments correctly", () => {
      assertEquals(getNode("function a(b) end"), {
        tag: "Set",
        1: { 1: { tag: "Id", 1: "a" } },
        2: { 1: { tag: "Function", 1: { 1: { tag: "Id", 1: "b" } }, 2: {} } },
      });
      assertEquals(getNode("function a(b, c) end"), {
        tag: "Set",
        1: { 1: { tag: "Id", 1: "a" } },
        2: {
          1: {
            tag: "Function",
            1: { 1: { tag: "Id", 1: "b" }, 2: { tag: "Id", 1: "c" } },
            2: {},
          },
        },
      });
      assertEquals(getNode("function a(b, ...) end"), {
        tag: "Set",
        1: { 1: { tag: "Id", 1: "a" } },
        2: {
          1: {
            tag: "Function",
            1: { 1: { tag: "Id", 1: "b" }, 2: { tag: "Dots", 1: "..." } },
            2: {},
          },
        },
      });
      assertEquals(getError("function a(b, ) end"), {
        line: 1,
        offset: 15,
        endOffset: 15,
        msg: "expected argument near ')'",
      });
      assertEquals(getError("function a(b.c) end"), {
        line: 1,
        offset: 13,
        endOffset: 13,
        prevLine: 1,
        prevOffset: 11,
        prevEndOffset: 11,
        msg: "expected ')' near '.'",
      });
      assertEquals(getError("function a(\nb.c) end"), {
        line: 2,
        offset: 14,
        endOffset: 14,
        prevLine: 1,
        prevOffset: 11,
        prevEndOffset: 11,
        msg: "expected ')' (to close '(' on line 1) near '.'",
      });
      assertEquals(getError("function a((b)) end"), {
        line: 1,
        offset: 12,
        endOffset: 12,
        msg: "expected argument near '('",
      });
      assertEquals(getError("function a(..., ...) end"), {
        line: 1,
        offset: 15,
        endOffset: 15,
        prevLine: 1,
        prevOffset: 11,
        prevEndOffset: 11,
        msg: "expected ')' near ','",
      });
    });

    await t.step("parses field function correctly", () => {
      assertEquals(getNode("function a.b() end"), {
        tag: "Set",
        1: {
          1: {
            tag: "Index",
            1: { tag: "Id", 1: "a" },
            2: { tag: "String", 1: "b" },
          },
        },
        2: { 1: { tag: "Function", 1: {}, 2: {} } },
      });
      assertEquals(getNode("function a.b.c() end"), {
        tag: "Set",
        1: {
          1: {
            tag: "Index",
            1: {
              tag: "Index",
              1: { tag: "Id", 1: "a" },
              2: { tag: "String", 1: "b" },
            },
            2: { tag: "String", 1: "c" },
          },
        },
        2: { 1: { tag: "Function", 1: {}, 2: {} } },
      });
      assertEquals(getError("function a[b]() end"), {
        line: 1,
        offset: 11,
        endOffset: 11,
        msg: "expected '(' near '['",
      });
      assertEquals(getError("function a.() end"), {
        line: 1,
        offset: 12,
        endOffset: 12,
        msg: "expected identifier near '('",
      });
    });

    await t.step("parses method function correctly", () => {
      assertEquals(getNode("function a:b() end"), {
        tag: "Set",
        1: {
          1: {
            tag: "Index",
            1: { tag: "Id", 1: "a" },
            2: { tag: "String", 1: "b" },
          },
        },
        2: {
          1: {
            tag: "Function",
            1: { 1: { tag: "Id", 1: "self", implicit: true } },
            2: {},
          },
        },
      });
      assertEquals(getNode("function a.b:c() end"), {
        tag: "Set",
        1: {
          1: {
            tag: "Index",
            1: {
              tag: "Index",
              1: { tag: "Id", 1: "a" },
              2: { tag: "String", 1: "b" },
            },
            2: { tag: "String", 1: "c" },
          },
        },
        2: {
          1: {
            tag: "Function",
            1: { 1: { tag: "Id", 1: "self", implicit: true } },
            2: {},
          },
        },
      });
      assertEquals(getError("function a:b.c() end"), {
        line: 1,
        offset: 13,
        endOffset: 13,
        msg: "expected '(' near '.'",
      });
    });
  });

  await t.step("when parsing local declarations", async (t) => {
    await t.step("parses simple local declaration correctly", () => {
      assertEquals(getNode("local a"), {
        tag: "Local",
        1: { 1: { tag: "Id", 1: "a" } },
      });
      assertEquals(getNode("local a, b"), {
        tag: "Local",
        1: { 1: { tag: "Id", 1: "a" }, 2: { tag: "Id", 1: "b" } },
      });
      assertEquals(getError("local"), {
        line: 1,
        offset: 6,
        endOffset: 6,
        msg: "expected identifier near <eof>",
      });
      assertEquals(getError("local a,"), {
        line: 1,
        offset: 9,
        endOffset: 9,
        msg: "expected identifier near <eof>",
      });
      assertEquals(getError("local a.b"), {
        line: 1,
        offset: 8,
        endOffset: 8,
        msg: "expected statement near '.'",
      });
      assertEquals(getError("local a[b]"), {
        line: 1,
        offset: 8,
        endOffset: 8,
        msg: "expected statement near '['",
      });
      assertEquals(getError("local (a)"), {
        line: 1,
        offset: 7,
        endOffset: 7,
        msg: "expected identifier near '('",
      });
    });

    await t.step("accepts (and ignores for now) Lua 5.4 attributes", () => {
      assertEquals(getNode("local a <close>"), {
        tag: "Local",
        1: { 1: { tag: "Id", 1: "a" } },
      });
      assertEquals(getNode("local a <close>, b <const>"), {
        tag: "Local",
        1: { 1: { tag: "Id", 1: "a" }, 2: { tag: "Id", 1: "b" } },
      });
      assertEquals(getNode("local a <close> = b"), {
        tag: "Local",
        1: { 1: { tag: "Id", 1: "a" } },
        2: { 1: { tag: "Id", 1: "b" } },
      });
      assertEquals(getNode("local a <close>, b <const> = c, d"), {
        tag: "Local",
        1: { 1: { tag: "Id", 1: "a" }, 2: { tag: "Id", 1: "b" } },
        2: { 1: { tag: "Id", 1: "c" }, 2: { tag: "Id", 1: "d" } },
      });
      assertEquals(getError("local a <close = "), {
        line: 1,
        offset: 16,
        endOffset: 16,
        msg: "expected '>' near '='",
      });
    });

    await t.step("parses local declaration with assignment correctly", () => {
      assertEquals(getNode("local a = b"), {
        tag: "Local",
        1: { 1: { tag: "Id", 1: "a" } },
        2: { 1: { tag: "Id", 1: "b" } },
      });
      assertEquals(getNode("local a, b = c, d"), {
        tag: "Local",
        1: { 1: { tag: "Id", 1: "a" }, 2: { tag: "Id", 1: "b" } },
        2: { 1: { tag: "Id", 1: "c" }, 2: { tag: "Id", 1: "d" } },
      });
      assertEquals(getError("local a = "), {
        line: 1,
        offset: 11,
        endOffset: 11,
        msg: "expected expression near <eof>",
      });
      assertEquals(getError("local a = b,"), {
        line: 1,
        offset: 13,
        endOffset: 13,
        msg: "expected expression near <eof>",
      });
      assertEquals(getError("local a.b = c"), {
        line: 1,
        offset: 8,
        endOffset: 8,
        msg: "expected statement near '.'",
      });
      assertEquals(getError("local a[b] = c"), {
        line: 1,
        offset: 8,
        endOffset: 8,
        msg: "expected statement near '['",
      });
      assertEquals(getError("local a, (b) = c"), {
        line: 1,
        offset: 10,
        endOffset: 10,
        msg: "expected identifier near '('",
      });
    });

    await t.step("parses local function declaration correctly", () => {
      assertEquals(getNode("local function a() end"), {
        tag: "Localrec",
        1: { 1: { tag: "Id", 1: "a" } },
        2: { 1: { tag: "Function", 1: {}, 2: {} } },
      });
      assertEquals(getError("local function"), {
        line: 1,
        offset: 15,
        endOffset: 15,
        msg: "expected identifier near <eof>",
      });
      assertEquals(getError("local function a.b() end"), {
        line: 1,
        offset: 17,
        endOffset: 17,
        msg: "expected '(' near '.'",
      });
    });
  });

  await t.step("when parsing assignments", async (t) => {
    await t.step("parses single target assignment correctly", () => {
      assertEquals(getNode("a = b"), {
        tag: "Set",
        1: { 1: { tag: "Id", 1: "a" } },
        2: { 1: { tag: "Id", 1: "b" } },
      });
      assertEquals(getNode("a.b = c"), {
        tag: "Set",
        1: {
          1: {
            tag: "Index",
            1: { tag: "Id", 1: "a" },
            2: { tag: "String", 1: "b" },
          },
        },
        2: { 1: { tag: "Id", 1: "c" } },
      });
      assertEquals(getNode("a.b.c = d"), {
        tag: "Set",
        1: {
          1: {
            tag: "Index",
            1: {
              tag: "Index",
              1: { tag: "Id", 1: "a" },
              2: { tag: "String", 1: "b" },
            },
            2: { tag: "String", 1: "c" },
          },
        },
        2: { 1: { tag: "Id", 1: "d" } },
      });
      assertEquals(getNode("(f():g())[9] = d"), {
        tag: "Set",
        1: {
          1: {
            tag: "Index",
            1: {
              tag: "Paren",
              1: {
                tag: "Invoke",
                1: { tag: "Call", 1: { tag: "Id", 1: "f" } },
                2: { tag: "String", 1: "g" },
              },
            },
            2: { tag: "Number", 1: "9" },
          },
        },
        2: { 1: { tag: "Id", 1: "d" } },
      });
      assertEquals(getError("a"), {
        line: 1,
        offset: 2,
        endOffset: 2,
        msg: "expected '=' near <eof>",
      });
      assertEquals(getError("a = "), {
        line: 1,
        offset: 5,
        endOffset: 5,
        msg: "expected expression near <eof>",
      });
      assertEquals(getError("a() = b"), {
        line: 1,
        offset: 5,
        endOffset: 5,
        msg: "expected statement near '='",
      });
      assertEquals(getError("(a) = b"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "expected statement near '('",
      });
      assertEquals(getError("1 = b"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "expected statement near '1'",
      });
    });

    await t.step("parses multi assignment correctly", () => {
      assertEquals(getNode("a, b = c, d"), {
        tag: "Set",
        1: { 1: { tag: "Id", 1: "a" }, 2: { tag: "Id", 1: "b" } },
        2: { 1: { tag: "Id", 1: "c" }, 2: { tag: "Id", 1: "d" } },
      });
      assertEquals(getError("a, b"), {
        line: 1,
        offset: 5,
        endOffset: 5,
        msg: "expected '=' near <eof>",
      });
      assertEquals(getError("a, = b"), {
        line: 1,
        offset: 4,
        endOffset: 4,
        msg: "expected identifier or field near '='",
      });
      assertEquals(getError("a, b = "), {
        line: 1,
        offset: 8,
        endOffset: 8,
        msg: "expected expression near <eof>",
      });
      assertEquals(getError("a, b = c,"), {
        line: 1,
        offset: 10,
        endOffset: 10,
        msg: "expected expression near <eof>",
      });
      assertEquals(getError("a, b() = c"), {
        line: 1,
        offset: 8,
        endOffset: 8,
        msg: "expected call or indexing near '='",
      });
      assertEquals(getError("a, (b) = c"), {
        line: 1,
        offset: 4,
        endOffset: 4,
        msg: "expected identifier or field near '('",
      });
    });
  });

  await t.step("when parsing expression statements", async (t) => {
    await t.step("parses calls correctly", () => {
      assertEquals(getNode("a()"), { tag: "Call", 1: { tag: "Id", 1: "a" } });
      assertEquals(getNode("a'b'"), {
        tag: "Call",
        1: { tag: "Id", 1: "a" },
        2: { tag: "String", 1: "b" },
      });
      assertEquals(getNode("a{}"), {
        tag: "Call",
        1: { tag: "Id", 1: "a" },
        2: { tag: "Table" },
      });
      assertEquals(getNode("a(b)"), {
        tag: "Call",
        1: { tag: "Id", 1: "a" },
        2: { tag: "Id", 1: "b" },
      });
      assertEquals(getNode("a(b, c)"), {
        tag: "Call",
        1: { tag: "Id", 1: "a" },
        2: { tag: "Id", 1: "b" },
        3: { tag: "Id", 1: "c" },
      });
      assertEquals(getNode("(a)(b)"), {
        tag: "Call",
        1: { tag: "Paren", 1: { tag: "Id", 1: "a" } },
        2: { tag: "Id", 1: "b" },
      });
      assertEquals(getNode("(a)(b)()"), {
        tag: "Call",
        1: {
          tag: "Call",
          1: { tag: "Paren", 1: { tag: "Id", 1: "a" } },
          2: { tag: "Id", 1: "b" },
        },
      });
      assertEquals(getError("()()"), {
        line: 1,
        offset: 2,
        endOffset: 2,
        msg: "expected expression near ')'",
      });
      assertEquals(getError("a("), {
        line: 1,
        offset: 3,
        endOffset: 3,
        msg: "expected expression near <eof>",
      });
      assertEquals(getError("a(b"), {
        line: 1,
        offset: 4,
        endOffset: 4,
        prevLine: 1,
        prevOffset: 2,
        prevEndOffset: 2,
        msg: "expected ')' near <eof>",
      });
      assertEquals(getError("a(\nb"), {
        line: 2,
        offset: 5,
        endOffset: 5,
        prevLine: 1,
        prevOffset: 2,
        prevEndOffset: 2,
        msg: "expected ')' (to close '(' on line 1) near <eof>",
      });
      assertEquals(getError("(a\ncc"), {
        line: 2,
        offset: 4,
        endOffset: 5,
        prevLine: 1,
        prevOffset: 1,
        prevEndOffset: 1,
        msg: "expected ')' (to close '(' on line 1) near 'cc'",
      });
      assertEquals(getError("1()"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "expected statement near '1'",
      });
      assertEquals(getError("'foo'()"), {
        line: 1,
        offset: 1,
        endOffset: 5,
        msg: "expected statement near ''foo''",
      });
      assertEquals(getError("function() end ()"), {
        line: 1,
        offset: 9,
        endOffset: 9,
        msg: "expected identifier near '('",
      });
    });

    await t.step("parses method calls correctly", () => {
      assertEquals(getNode("a:b()"), {
        tag: "Invoke",
        1: { tag: "Id", 1: "a" },
        2: { tag: "String", 1: "b" },
      });
      assertEquals(getNode("a:b'c'"), {
        tag: "Invoke",
        1: { tag: "Id", 1: "a" },
        2: { tag: "String", 1: "b" },
        3: { tag: "String", 1: "c" },
      });
      assertEquals(getNode("a:b{}"), {
        tag: "Invoke",
        1: { tag: "Id", 1: "a" },
        2: { tag: "String", 1: "b" },
        3: { tag: "Table" },
      });
      assertEquals(getNode("a:b(c)"), {
        tag: "Invoke",
        1: { tag: "Id", 1: "a" },
        2: { tag: "String", 1: "b" },
        3: { tag: "Id", 1: "c" },
      });
      assertEquals(getNode("a:b(c, d)"), {
        tag: "Invoke",
        1: { tag: "Id", 1: "a" },
        2: { tag: "String", 1: "b" },
        3: { tag: "Id", 1: "c" },
        4: { tag: "Id", 1: "d" },
      });
      assertEquals(getNode("(a):b(c)"), {
        tag: "Invoke",
        1: { tag: "Paren", 1: { tag: "Id", 1: "a" } },
        2: { tag: "String", 1: "b" },
        3: { tag: "Id", 1: "c" },
      });
      assertEquals(getNode("a:b():c()"), {
        tag: "Invoke",
        1: {
          tag: "Invoke",
          1: { tag: "Id", 1: "a" },
          2: { tag: "String", 1: "b" },
        },
        2: { tag: "String", 1: "c" },
      });
      assertEquals(getError("1:b()"), {
        line: 1,
        offset: 1,
        endOffset: 1,
        msg: "expected statement near '1'",
      });
      assertEquals(getError("'':a()"), {
        line: 1,
        offset: 1,
        endOffset: 2,
        msg: "expected statement near ''''",
      });
      assertEquals(getError("function()end:b()"), {
        line: 1,
        offset: 9,
        endOffset: 9,
        msg: "expected identifier near '('",
      });
      assertEquals(getError("a:b:c()"), {
        line: 1,
        offset: 4,
        endOffset: 4,
        msg: "expected method arguments near ':'",
      });
      assertEquals(getError("a:"), {
        line: 1,
        offset: 3,
        endOffset: 3,
        msg: "expected identifier near <eof>",
      });
    });
  });

  await t.step("when parsing expressions", async (t) => {
    await t.step("parses singleton expressions correctly", () => {
      assertEquals(getExpr("nil"), { tag: "Nil" });
      assertEquals(getExpr("true"), { tag: "True" });
      assertEquals(getExpr("false"), { tag: "False" });
      assertEquals(getExpr("1"), { tag: "Number", 1: "1" });
      assertEquals(getExpr("'1'"), { tag: "String", 1: "1" });
      assertEquals(getExpr("{}"), { tag: "Table" });
      assertEquals(getExpr("function() end"), {
        tag: "Function",
        1: {},
        2: {},
      });
      assertEquals(getExpr("..."), { tag: "Dots", 1: "..." });
    });

    await t.step("parses table constructors correctly", () => {
      assertEquals(getExpr("{a, b, c}"), {
        tag: "Table",
        1: { tag: "Id", 1: "a" },
        2: { tag: "Id", 1: "b" },
        3: { tag: "Id", 1: "c" },
      });
      assertEquals(getExpr("{a, b = c, d}"), {
        tag: "Table",
        1: { tag: "Id", 1: "a" },
        2: {
          tag: "Pair",
          1: { tag: "String", 1: "b" },
          2: { tag: "Id", 1: "c" },
        },
        3: { tag: "Id", 1: "d" },
      });
      assertEquals(getExpr("{[[a]], [b] = c, d}"), {
        tag: "Table",
        1: { tag: "String", 1: "a" },
        2: { tag: "Pair", 1: { tag: "Id", 1: "b" }, 2: { tag: "Id", 1: "c" } },
        3: { tag: "Id", 1: "d" },
      });
      assertEquals(getExpr("{a; b, c}"), {
        tag: "Table",
        1: { tag: "Id", 1: "a" },
        2: { tag: "Id", 1: "b" },
        3: { tag: "Id", 1: "c" },
      });
      assertEquals(getExpr("{a; b, c,}"), {
        tag: "Table",
        1: { tag: "Id", 1: "a" },
        2: { tag: "Id", 1: "b" },
        3: { tag: "Id", 1: "c" },
      });
      assertEquals(getExpr("{a; b, c;}"), {
        tag: "Table",
        1: { tag: "Id", 1: "a" },
        2: { tag: "Id", 1: "b" },
        3: { tag: "Id", 1: "c" },
      });
      assertEquals(getError("return {;}"), {
        line: 1,
        offset: 9,
        endOffset: 9,
        msg: "expected expression near ';'",
      });
      assertEquals(getError("return {"), {
        line: 1,
        offset: 9,
        endOffset: 9,
        msg: "expected expression near <eof>",
      });
      assertEquals(getError("return {a end"), {
        line: 1,
        offset: 11,
        endOffset: 13,
        prevLine: 1,
        prevOffset: 8,
        prevEndOffset: 8,
        msg: "expected '}' near 'end'",
      });
      assertEquals(getError("return {a\nend"), {
        line: 2,
        offset: 11,
        endOffset: 13,
        prevLine: 1,
        prevOffset: 8,
        prevEndOffset: 8,
        msg: "expected '}' (to close '{' on line 1) near 'end'",
      });
      assertEquals(getError("return {[a"), {
        line: 1,
        offset: 11,
        endOffset: 11,
        prevLine: 1,
        prevOffset: 9,
        prevEndOffset: 9,
        msg: "expected ']' near <eof>",
      });
      assertEquals(getError("return {[\na"), {
        line: 2,
        offset: 12,
        endOffset: 12,
        prevLine: 1,
        prevOffset: 9,
        prevEndOffset: 9,
        msg: "expected ']' (to close '[' on line 1) near <eof>",
      });
      assertEquals(getError("return {a,,}"), {
        line: 1,
        offset: 11,
        endOffset: 11,
        msg: "expected expression near ','",
      });
      assertEquals(getError("return {a = "), {
        line: 1,
        offset: 13,
        endOffset: 13,
        msg: "expected expression near <eof>",
      });
    });

    await t.step("parses simple expressions correctly", () => {
      assertEquals(getExpr("-1"), {
        tag: "Op",
        1: "unm",
        2: { tag: "Number", 1: "1" },
      });
      assertEquals(getExpr("1+2+3"), {
        tag: "Op",
        1: "add",
        2: {
          tag: "Op",
          1: "add",
          2: { tag: "Number", 1: "1" },
          3: { tag: "Number", 1: "2" },
        },
        3: { tag: "Number", 1: "3" },
      });
      assertEquals(getExpr("1^2^3"), {
        tag: "Op",
        1: "pow",
        2: { tag: "Number", 1: "1" },
        3: {
          tag: "Op",
          1: "pow",
          2: { tag: "Number", 1: "2" },
          3: { tag: "Number", 1: "3" },
        },
      });
      assertEquals(getExpr("'1'..'2'..'3'"), {
        tag: "Op",
        1: "concat",
        2: { tag: "String", 1: "1" },
        3: {
          tag: "Op",
          1: "concat",
          2: { tag: "String", 1: "2" },
          3: { tag: "String", 1: "3" },
        },
      });
    });

    await t.step("handles operator precedence correctly", () => {
      assertEquals(getExpr("-1+2*3^4"), {
        tag: "Op",
        1: "add",
        2: { tag: "Op", 1: "unm", 2: { tag: "Number", 1: "1" } },
        3: {
          tag: "Op",
          1: "mul",
          2: { tag: "Number", 1: "2" },
          3: {
            tag: "Op",
            1: "pow",
            2: { tag: "Number", 1: "3" },
            3: { tag: "Number", 1: "4" },
          },
        },
      });
      assertEquals(getExpr("1 >> 2 & 3 << 4 | 5 ~ 6 | ~7"), {
        tag: "Op",
        1: "bor",
        2: {
          tag: "Op",
          1: "bor",
          2: {
            tag: "Op",
            1: "band",
            2: {
              tag: "Op",
              1: "shr",
              2: { tag: "Number", 1: "1" },
              3: { tag: "Number", 1: "2" },
            },
            3: {
              tag: "Op",
              1: "shl",
              2: { tag: "Number", 1: "3" },
              3: { tag: "Number", 1: "4" },
            },
          },
          3: {
            tag: "Op",
            1: "bxor",
            2: { tag: "Number", 1: "5" },
            3: { tag: "Number", 1: "6" },
          },
        },
        3: { tag: "Op", 1: "bnot", 2: { tag: "Number", 1: "7" } },
      });
      assertEquals(getExpr("a == b and c == d or e ~= f"), {
        tag: "Op",
        1: "or",
        2: {
          tag: "Op",
          1: "and",
          2: {
            tag: "Op",
            1: "eq",
            2: { tag: "Id", 1: "a" },
            3: { tag: "Id", 1: "b" },
          },
          3: {
            tag: "Op",
            1: "eq",
            2: { tag: "Id", 1: "c" },
            3: { tag: "Id", 1: "d" },
          },
        },
        3: {
          tag: "Op",
          1: "ne",
          2: { tag: "Id", 1: "e" },
          3: { tag: "Id", 1: "f" },
        },
      });
    });
  });

  await t.step("when parsing multiple statements", async (t) => {
    await t.step("considers semicolons and comments no-op statements", () => {
      assertEquals(getNode(";;;a = b;--[[]];--;"), {
        tag: "Set",
        1: { 1: { tag: "Id", 1: "a" } },
        2: { 1: { tag: "Id", 1: "b" } },
      });
    });

    await t.step("does not allow statements after return", () => {
      assertEquals(getError("return break"), {
        line: 1,
        offset: 8,
        endOffset: 12,
        msg: "expected expression near 'break'",
      });
      assertEquals(getError("return; break"), {
        line: 1,
        offset: 9,
        endOffset: 13,
        msg: "expected <eof> near 'break'",
      });
      assertEquals(getError("return;;"), {
        line: 1,
        offset: 8,
        endOffset: 8,
        msg: "expected <eof> near ';'",
      });
      assertEquals(getError("return 1 break"), {
        line: 1,
        offset: 10,
        endOffset: 14,
        msg: "expected <eof> near 'break'",
      });
      assertEquals(getError("return 1; break"), {
        line: 1,
        offset: 11,
        endOffset: 15,
        msg: "expected <eof> near 'break'",
      });
      assertEquals(getError("return 1, 2 break"), {
        line: 1,
        offset: 13,
        endOffset: 17,
        msg: "expected <eof> near 'break'",
      });
      assertEquals(getError("return 1, 2; break"), {
        line: 1,
        offset: 14,
        endOffset: 18,
        msg: "expected <eof> near 'break'",
      });
    });

    await t.step("parses nested statements correctly", () => {
      assertEquals(
        getAst(String.raw`local function f()
   while true do
      if nil then
         f()
         return
      elseif false then
         g()
         break
      else
         h()

         repeat
            goto fail
         until get_forked
      end
   end

   ::fail::
end

do
   for i=1, 2 do
      nothing()
   end

   for k, v in pairs() do
      print("bar")
      assert(42)
   end

   return
end
`),
        {
          1: {
            tag: "Localrec",
            1: { 1: { tag: "Id", 1: "f" } },
            2: {
              1: {
                tag: "Function",
                1: {},
                2: {
                  1: {
                    tag: "While",
                    1: { tag: "True" },
                    2: {
                      1: {
                        tag: "If",
                        1: { tag: "Nil" },
                        2: {
                          1: { tag: "Call", 1: { tag: "Id", 1: "f" } },
                          2: { tag: "Return" },
                        },
                        3: { tag: "False" },
                        4: {
                          1: { tag: "Call", 1: { tag: "Id", 1: "g" } },
                          2: { tag: "Break" },
                        },
                        5: {
                          1: { tag: "Call", 1: { tag: "Id", 1: "h" } },
                          2: {
                            tag: "Repeat",
                            1: { 1: { tag: "Goto", 1: "fail" } },
                            2: { tag: "Id", 1: "get_forked" },
                          },
                        },
                      },
                    },
                  },
                  2: { tag: "Label", 1: "fail" },
                },
              },
            },
          },
          2: {
            tag: "Do",
            1: {
              tag: "Fornum",
              1: { tag: "Id", 1: "i" },
              2: { tag: "Number", 1: "1" },
              3: { tag: "Number", 1: "2" },
              4: { 1: { tag: "Call", 1: { tag: "Id", 1: "nothing" } } },
            },
            2: {
              tag: "Forin",
              1: { 1: { tag: "Id", 1: "k" }, 2: { tag: "Id", 1: "v" } },
              2: { 1: { tag: "Call", 1: { tag: "Id", 1: "pairs" } } },
              3: {
                1: {
                  tag: "Call",
                  1: { tag: "Id", 1: "print" },
                  2: { tag: "String", 1: "bar" },
                },
                2: {
                  tag: "Call",
                  1: { tag: "Id", 1: "assert" },
                  2: { tag: "Number", 1: "42" },
                },
              },
            },
            3: { tag: "Return" },
          },
        },
      );
    });
  });

  await t.step(
    "indentation-based missing until/end location guessing",
    async (t) => {
      await t.step(
        "provides a better location on the same indentation level for missing end",
        () => {
          assertEquals(
            getError(String.raw`local function f()
   if cond then
      do_thing()

      do_more_things()

      while true do
         things_keep_happening()
      end

   whoops()
end
`),
            {
              line: 11,
              offset: 145,
              endOffset: 150,
              prevLine: 2,
              prevOffset: 23,
              prevEndOffset: 24,
              msg:
                "expected 'end' (to close 'if' on line 2) near 'whoops' (indentation-based guess)",
            },
          );

          assertEquals(
            getError(String.raw`local function f()
   if cond then
      do_thing()

      do_more_things()

      repeat
         things_keep_happening()

      whoops()
end
`),
            {
              line: 10,
              offset: 131,
              endOffset: 136,
              prevLine: 7,
              prevOffset: 84,
              prevEndOffset: 89,
              msg:
                "expected 'until' (to close 'repeat' on line 7) near 'whoops' (indentation-based guess)",
            },
          );

          assertEquals(
            getError(String.raw`local function f()
   good()
end

local function g()
   bad()

local function t()
   irrelevant()
end
`),
            {
              line: 8,
              offset: 64,
              endOffset: 68,
              prevLine: 5,
              prevOffset: 41,
              prevEndOffset: 48,
              msg:
                "expected 'end' (to close 'function' on line 5) near 'local' (indentation-based guess)",
            },
          );

          assertEquals(
            getError(String.raw`do end
do
end
do
   do end
   do
   end
   one_thing()
two_things()
`),
            {
              line: 9,
              offset: 56,
              endOffset: 65,
              prevLine: 4,
              prevOffset: 15,
              prevEndOffset: 16,
              msg:
                "expected 'end' (to close 'do' on line 4) near 'two_things' (indentation-based guess)",
            },
          );

          assertEquals(
            getError(String.raw`do
   do
      while cond
      do
         thing = thing
         another = thing

      if yes then end
   end
end
`),
            {
              line: 8,
              offset: 91,
              endOffset: 92,
              prevLine: 3,
              prevOffset: 16,
              prevEndOffset: 20,
              msg:
                "expected 'end' (to close 'while' on line 3) near 'if' (indentation-based guess)",
            },
          );

          assertEquals(
            getError(String.raw`function g()
   for i in ipairs("this is not even an error...") do
      for i = 1, 2, 3 do
         thing()

      something = smth
   end
`),
            {
              line: 6,
              offset: 117,
              endOffset: 125,
              prevLine: 3,
              prevOffset: 74,
              prevEndOffset: 76,
              msg:
                "expected 'end' (to close 'for' on line 3) near 'something' (indentation-based guess)",
            },
          );
        },
      );

      await t.step(
        "provides a better location on a lower indentation level for missing end",
        () => {
          assertEquals(
            getError(String.raw`do
   while true do
      thing()

end
`),
            {
              line: 5,
              offset: 36,
              endOffset: 38,
              prevLine: 2,
              prevOffset: 7,
              prevEndOffset: 11,
              msg:
                "expected 'end' (to close 'while' on line 2) near less indented 'end' (indentation-based guess)",
            },
          );

          assertEquals(
            getError(String.raw`do
   while true do
      thing()
         more()
a()
`),
            {
              line: 5,
              offset: 51,
              endOffset: 51,
              prevLine: 2,
              prevOffset: 7,
              prevEndOffset: 11,
              msg:
                "expected 'end' (to close 'while' on line 2) near 'a' (indentation-based guess)",
            },
          );
        },
      );

      await t.step(
        "provides a better location for various configurations of if statements",
        () => {
          assertEquals(
            getError(String.raw`do
   if thing({
long, long, long, line}) then
      something()

end
`),
            {
              line: 6,
              offset: 67,
              endOffset: 69,
              prevLine: 2,
              prevOffset: 7,
              prevEndOffset: 8,
              msg:
                "expected 'end' (to close 'if' on line 2) near less indented 'end' (indentation-based guess)",
            },
          );

          assertEquals(
            getError(String.raw`do
   if cond() then
      something()
   else
      thing()

   a = b
end
`),
            {
              line: 7,
              offset: 66,
              endOffset: 66,
              prevLine: 4,
              prevOffset: 43,
              prevEndOffset: 46,
              msg:
                "expected 'end' (to close 'else' on line 4) near 'a' (indentation-based guess)",
            },
          );

          assertEquals(
            getError(String.raw`do
   if cond() then
      something()
   elseif something then

end
`),
            {
              line: 6,
              offset: 66,
              endOffset: 68,
              prevLine: 4,
              prevOffset: 43,
              prevEndOffset: 48,
              msg:
                "expected 'end' (to close 'elseif' on line 4) near less indented 'end' (indentation-based guess)",
            },
          );

          assertEquals(
            getError(String.raw`do
   if cond() then
      s()
   elseif something then
      b()
   elseif a() then
      c()
   elseif d() then

   e()
end
`),
            {
              line: 10,
              offset: 119,
              endOffset: 119,
              prevLine: 8,
              prevOffset: 99,
              prevEndOffset: 104,
              msg:
                "expected 'end' (to close 'elseif' on line 8) near 'e' (indentation-based guess)",
            },
          );
        },
      );

      await t.step(
        "reports the first guess location outside complete blocks",
        () => {
          assertEquals(
            getError(String.raw`do
   while true do
      thing()

another()
end
end

do
   while true do
      thing()
   another()
end

do
   while true do
      thing()
   another()
end
`),
            {
              line: 12,
              offset: 92,
              endOffset: 98,
              prevLine: 10,
              prevOffset: 61,
              prevEndOffset: 65,
              msg:
                "expected 'end' (to close 'while' on line 10) near 'another' (indentation-based guess)",
            },
          );
        },
      );

      await t.step(
        "does not report blocks with different closing token comparing to original error",
        () => {
          assertEquals(
            getError(String.raw`do
   while true do
      thing()

   a()

   repeat
      repeat
         thing()
   until cond
end
`),
            {
              line: 10,
              offset: 87,
              endOffset: 91,
              prevLine: 8,
              prevOffset: 60,
              prevEndOffset: 65,
              msg:
                "expected 'until' (to close 'repeat' on line 8) near less indented 'until' (indentation-based guess)",
            },
          );

          assertEquals(
            getError(String.raw`repeat
thing1()

   do
      do
         thing2()

      thing3()
   end
until another_thing
`),
            {
              line: 8,
              offset: 58,
              endOffset: 63,
              prevLine: 5,
              prevOffset: 30,
              prevEndOffset: 31,
              msg:
                "expected 'end' (to close 'do' on line 5) near 'thing3' (indentation-based guess)",
            },
          );
        },
      );

      await t.step(
        "does not report tokens on the same line as the innermost block opening token",
        () => {
          assertEquals(
            getError(String.raw`local function f()
   local function g() return ret end
   do
      thing()

end
`),
            {
              line: 6,
              offset: 78,
              endOffset: 80,
              prevLine: 3,
              prevOffset: 60,
              prevEndOffset: 61,
              msg:
                "expected 'end' (to close 'do' on line 3) near less indented 'end' (indentation-based guess)",
            },
          );
        },
      );
    },
  );

  await t.step("provides correct location info", () => {
    assertEquals(
      getFullAst(String.raw`local function foo(a, b, c, ...)
   local d = (a + b) * c
   return d, (...)
end

function t:bar(arg)
   if arg then
      print(arg)
   end
end
`),
      {
        1: {
          tag: "Localrec",
          line: 1,
          offset: 1,
          endOffset: 80,
          1: { 1: { tag: "Id", 1: "foo", line: 1, offset: 16, endOffset: 18 } },
          2: {
            1: {
              tag: "Function",
              line: 1,
              offset: 7,
              endOffset: 80,
              endRange: { line: 4, offset: 78, endOffset: 80 },
              1: {
                1: { tag: "Id", 1: "a", line: 1, offset: 20, endOffset: 20 },
                2: { tag: "Id", 1: "b", line: 1, offset: 23, endOffset: 23 },
                3: { tag: "Id", 1: "c", line: 1, offset: 26, endOffset: 26 },
                4: {
                  tag: "Dots",
                  1: "...",
                  line: 1,
                  offset: 29,
                  endOffset: 31,
                },
              },
              2: {
                1: {
                  tag: "Local",
                  line: 2,
                  offset: 37,
                  endOffset: 57,
                  1: {
                    1: {
                      tag: "Id",
                      1: "d",
                      line: 2,
                      offset: 43,
                      endOffset: 43,
                    },
                  },
                  2: {
                    1: {
                      tag: "Op",
                      1: "mul",
                      line: 2,
                      offset: 47,
                      endOffset: 57,
                      2: {
                        tag: "Paren",
                        line: 2,
                        offset: 47,
                        endOffset: 53,
                        1: {
                          tag: "Op",
                          1: "add",
                          line: 2,
                          offset: 48,
                          endOffset: 52,
                          2: {
                            tag: "Id",
                            1: "a",
                            line: 2,
                            offset: 48,
                            endOffset: 48,
                          },
                          3: {
                            tag: "Id",
                            1: "b",
                            line: 2,
                            offset: 52,
                            endOffset: 52,
                          },
                        },
                      },
                      3: {
                        tag: "Id",
                        1: "c",
                        line: 2,
                        offset: 57,
                        endOffset: 57,
                      },
                    },
                  },
                },
                2: {
                  tag: "Return",
                  line: 3,
                  offset: 62,
                  endOffset: 76,
                  1: { tag: "Id", 1: "d", line: 3, offset: 69, endOffset: 69 },
                  2: {
                    tag: "Paren",
                    line: 3,
                    offset: 72,
                    endOffset: 76,
                    1: {
                      tag: "Dots",
                      1: "...",
                      line: 3,
                      offset: 73,
                      endOffset: 75,
                    },
                  },
                },
              },
            },
          },
        },
        2: {
          tag: "Set",
          line: 6,
          offset: 83,
          endOffset: 144,
          1: {
            1: {
              tag: "Index",
              line: 6,
              offset: 92,
              endOffset: 96,
              1: { tag: "Id", 1: "t", line: 6, offset: 92, endOffset: 92 },
              2: {
                tag: "String",
                1: "bar",
                line: 6,
                offset: 94,
                endOffset: 96,
              },
            },
          },
          2: {
            1: {
              tag: "Function",
              line: 6,
              offset: 83,
              endOffset: 144,
              endRange: { line: 10, offset: 142, endOffset: 144 },
              1: {
                1: {
                  tag: "Id",
                  1: "self",
                  implicit: true,
                  line: 6,
                  offset: 93,
                  endOffset: 93,
                },
                2: { tag: "Id", 1: "arg", line: 6, offset: 98, endOffset: 100 },
              },
              2: {
                1: {
                  tag: "If",
                  line: 7,
                  offset: 106,
                  endOffset: 140,
                  1: {
                    tag: "Id",
                    1: "arg",
                    line: 7,
                    offset: 109,
                    endOffset: 111,
                  },
                  2: {
                    line: 7,
                    offset: 113,
                    endOffset: 116,
                    1: {
                      tag: "Call",
                      line: 8,
                      offset: 124,
                      endOffset: 133,
                      1: {
                        tag: "Id",
                        1: "print",
                        line: 8,
                        offset: 124,
                        endOffset: 128,
                      },
                      2: {
                        tag: "Id",
                        1: "arg",
                        line: 8,
                        offset: 130,
                        endOffset: 132,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    );
  });

  await t.step("provides correct location info for labels", () => {
    assertEquals(
      getFullAst(String.raw`::foo::
:: bar
::::
baz::
`),
      {
        1: { tag: "Label", 1: "foo", line: 1, offset: 1, endOffset: 7 },
        2: { tag: "Label", 1: "bar", line: 2, offset: 9, endOffset: 17 },
        3: { tag: "Label", 1: "baz", line: 3, offset: 18, endOffset: 25 },
      },
    );
  });

  await t.step(
    "provides correct location info for statements starting with expressions",
    () => {
      assertEquals(
        getFullAst(String.raw`a();
(b)();
((c).d)[3] = 2
`),
        {
          1: {
            tag: "Call",
            line: 1,
            offset: 1,
            endOffset: 3,
            1: { tag: "Id", 1: "a", line: 1, offset: 1, endOffset: 1 },
          },
          2: {
            tag: "Call",
            line: 2,
            offset: 6,
            endOffset: 10,
            1: {
              tag: "Paren",
              line: 2,
              offset: 6,
              endOffset: 8,
              1: { tag: "Id", 1: "b", line: 2, offset: 7, endOffset: 7 },
            },
          },
          3: {
            tag: "Set",
            line: 3,
            offset: 13,
            endOffset: 26,
            1: {
              1: {
                tag: "Index",
                line: 3,
                offset: 13,
                endOffset: 22,
                1: {
                  tag: "Paren",
                  line: 3,
                  offset: 13,
                  endOffset: 19,
                  1: {
                    tag: "Index",
                    line: 3,
                    offset: 14,
                    endOffset: 18,
                    1: {
                      tag: "Paren",
                      line: 3,
                      offset: 14,
                      endOffset: 16,
                      1: {
                        tag: "Id",
                        1: "c",
                        line: 3,
                        offset: 15,
                        endOffset: 15,
                      },
                    },
                    2: {
                      tag: "String",
                      1: "d",
                      line: 3,
                      offset: 18,
                      endOffset: 18,
                    },
                  },
                },
                2: {
                  tag: "Number",
                  1: "3",
                  line: 3,
                  offset: 21,
                  endOffset: 21,
                },
              },
            },
            2: {
              1: { tag: "Number", 1: "2", line: 3, offset: 26, endOffset: 26 },
            },
          },
        },
      );
    },
  );

  await t.step("provides correct location info for conditions", () => {
    assertEquals(
      getFullAst(String.raw`if (x) then end
`),
      {
        1: {
          tag: "If",
          line: 1,
          offset: 1,
          endOffset: 15,
          1: {
            tag: "Paren",
            line: 1,
            offset: 4,
            endOffset: 6,
            1: { tag: "Id", 1: "x", line: 1, offset: 5, endOffset: 5 },
          },
          2: { line: 1, offset: 8, endOffset: 11 },
        },
      },
    );
  });

  await t.step("provides correct location info for table keys", () => {
    assertEquals(
      getFullAst(String.raw`return {a = b, [x] = y, (z)}
`),
      {
        1: {
          tag: "Return",
          line: 1,
          offset: 1,
          endOffset: 28,
          1: {
            tag: "Table",
            line: 1,
            offset: 8,
            endOffset: 28,
            1: {
              tag: "Pair",
              line: 1,
              offset: 9,
              endOffset: 13,
              1: { tag: "String", 1: "a", line: 1, offset: 9, endOffset: 9 },
              2: { tag: "Id", 1: "b", line: 1, offset: 13, endOffset: 13 },
            },
            2: {
              tag: "Pair",
              line: 1,
              offset: 16,
              endOffset: 22,
              1: { tag: "Id", 1: "x", line: 1, offset: 17, endOffset: 17 },
              2: { tag: "Id", 1: "y", line: 1, offset: 22, endOffset: 22 },
            },
            3: {
              tag: "Paren",
              line: 1,
              offset: 25,
              endOffset: 27,
              1: { tag: "Id", 1: "z", line: 1, offset: 26, endOffset: 26 },
            },
          },
        },
      },
    );
  });

  await t.step("provides correct error location info", () => {
    assertEquals(
      getError(String.raw`local function foo(a, b, c, ...)
   local d = (a + b) * c
   return d, (...)
end

function t:bar(arg)
   if arg then
      printarg)
   end
end
`),
      { line: 8, offset: 132, endOffset: 132, msg: "expected '=' near ')'" },
    );
  });

  await t.step(
    "provides correct error location info for EOF with no endline",
    () => {
      assertEquals(getError("thing = "), {
        line: 1,
        offset: 9,
        endOffset: 9,
        msg: "expected expression near <eof>",
      });
      assertEquals(getError("thing = -- eof"), {
        line: 1,
        offset: 15,
        endOffset: 15,
        msg: "expected expression near <eof>",
      });
    },
  );

  await t.step("providing misc information", async (t) => {
    await t.step("provides short comments correctly", () => {
      assertEquals(
        getComments(String.raw`-- ignore something
foo = bar() -- comments
return true --[=[
long comment]=]
         `),
        [
          { contents: " ignore something", line: 1, offset: 1, endOffset: 19 },
          { contents: " comments", line: 2, offset: 33, endOffset: 43 },
        ],
      );
    });

    await t.step("provides lines with code correctly", () => {
      assertEquals(
        getCodeLines(String.raw`-- nothing here
local foo = 2
+
3
+
[=[
]=]
+
{
   --[=[empty]=]

}
::bar::
`),
        {
          2: true,
          3: true,
          4: true,
          5: true,
          6: true,
          7: true,
          8: true,
          9: true,
          12: true,
          13: true,
        },
      );
      assertEquals(getCodeLines("f() -- luacheck: ignore"), { 1: true });
    });

    await t.step("provides line ending types correctly", () => {
      assertEquals(
        getLineEndings(String.raw`-- comment
f()
--[=[comment]=]
f()
f("\
string")
--[=[
   comment
]=]
f()
f([=[
   string
]=])
`),
        {
          1: "comment",
          5: "string",
          7: "comment",
          8: "comment",
          11: "string",
          12: "string",
        },
      );
      assertEquals(getLineEndings("f() -- comment"), { 1: "comment" });
    });
  });
});
