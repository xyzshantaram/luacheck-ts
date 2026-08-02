/**
 * Hand-written tests for stages/name_functions.ts. No upstream busted spec
 * exists for stages/name_functions.lua (only indirect coverage via
 * check_spec.lua/cli_spec.lua end-to-end tests), so these tests are not a
 * port - same spirit as unwrap_parens_test.ts.
 *
 * `run` from ./name_functions.ts does not exist yet (ticket 4.3's
 * implementation dispatch adds it); a throwing placeholder stands in so
 * this file type-checks. Each case follows unwrap_parens_test.ts's
 * before/after pattern: it asserts the target `Function` node's `.name`
 * is absent before calling the (placeholder) `run`, then asserts the
 * expected name after. The after-assertion is unreachable against the
 * placeholder, and `deno test` failing there is expected.
 */

import { assertEquals } from "@std/assert";
import type { AstNode } from "../parser.ts";
import { parse } from "../parser.ts";
import { decode } from "../decoder.ts";
import { checkStateNew } from "../check_state.ts";
import { run as unwrapParensRun } from "./unwrap_parens.ts";
import { run } from "./name_functions.ts";

function buildChstate(source: string): ReturnType<typeof checkStateNew> {
  const chstate = checkStateNew(source);
  const result = parse(decode(source));
  chstate.ast = result.ast;
  chstate.lineOffsets = result.lineOffsets;
  chstate.lineLengths = result.lineLengths;
  unwrapParensRun(chstate);
  chstate.warnings = [];
  return chstate;
}

Deno.test("run - names a function assigned to a local", () => {
  const source = "local function foo() end\n";
  const chstate = buildChstate(source);

  const localrecNode = chstate.ast["1"] as AstNode;
  assertEquals(localrecNode.tag, "Localrec");
  const functionNode = (localrecNode["2"] as AstNode)["1"] as AstNode;
  assertEquals(functionNode.tag, "Function");
  assertEquals(functionNode.name, undefined);

  run(chstate);

  assertEquals(functionNode.name, "foo");
});

Deno.test("run - names a function assigned to a global (Set sugar for `function foo() end`)", () => {
  const source = "function foo() end\n";
  const chstate = buildChstate(source);

  const setNode = chstate.ast["1"] as AstNode;
  assertEquals(setNode.tag, "Set");
  const functionNode = (setNode["2"] as AstNode)["1"] as AstNode;
  assertEquals(functionNode.tag, "Function");
  assertEquals(functionNode.name, undefined);

  run(chstate);

  assertEquals(functionNode.name, "foo");
});

Deno.test("run - names a function assigned to a nested field", () => {
  const source = "foo.bar.baz = function() end\n";
  const chstate = buildChstate(source);

  const setNode = chstate.ast["1"] as AstNode;
  assertEquals(setNode.tag, "Set");
  const functionNode = (setNode["2"] as AstNode)["1"] as AstNode;
  assertEquals(functionNode.tag, "Function");
  assertEquals(functionNode.name, undefined);

  run(chstate);

  assertEquals(functionNode.name, "foo.bar.baz");
});

Deno.test("run - names a function nested inside a table literal assigned to a name", () => {
  const source = "foo.bar = {baz = function() end}\n";
  const chstate = buildChstate(source);

  const setNode = chstate.ast["1"] as AstNode;
  assertEquals(setNode.tag, "Set");
  const tableNode = (setNode["2"] as AstNode)["1"] as AstNode;
  assertEquals(tableNode.tag, "Table");
  const pairNode = tableNode["1"] as AstNode;
  assertEquals(pairNode.tag, "Pair");
  const functionNode = pairNode["2"] as AstNode;
  assertEquals(functionNode.tag, "Function");
  assertEquals(functionNode.name, undefined);

  run(chstate);

  assertEquals(functionNode.name, "foo.bar.baz");
});

Deno.test("run - leaves an anonymous function passed directly as a call argument unnamed", () => {
  const source = "foo(function() end)\n";
  const chstate = buildChstate(source);

  const callNode = chstate.ast["1"] as AstNode;
  assertEquals(callNode.tag, "Call");
  const functionNode = callNode["2"] as AstNode;
  assertEquals(functionNode.tag, "Function");
  assertEquals(functionNode.name, undefined);

  run(chstate);

  assertEquals(functionNode.name, undefined);
});
