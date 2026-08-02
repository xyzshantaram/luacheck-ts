/**
 * Hand-written tests for stages/unwrap_parens.ts. No upstream busted spec
 * exists for stages/unwrap_parens.lua in isolation (only indirect coverage
 * via check_spec.lua/cli_spec.lua end-to-end tests), so these tests are
 * not a port.
 *
 * Each case parses real Lua source with `parser.parse` (not a hand-built
 * fixture AST), wires it onto a `CheckStateInstance`, calls `run`, and
 * asserts on the resulting AST shape and/or `chstate.warnings`.
 */

import { assertEquals } from "@std/assert";
import type { AstNode } from "../parser.ts";
import { parse } from "../parser.ts";
import { decode } from "../decoder.ts";
import { checkStateNew } from "../check_state.ts";
import { run } from "./unwrap_parens.ts";

function buildChstate(source: string): ReturnType<typeof checkStateNew> {
  const chstate = checkStateNew(source);
  const result = parse(decode(source));
  chstate.ast = result.ast;
  chstate.lineOffsets = result.lineOffsets;
  chstate.lineLengths = result.lineLengths;
  return chstate;
}

Deno.test("run - unwraps a redundant Paren around a scalar expression", () => {
  // `local` recurses into its rhs with no listStart (unlike `Set`, where a
  // single-value rhs is a tail+list_start position and would be preserved
  // unconditionally instead - ground-truthed against the real interpreter).
  const source = "local x = (1 + 2)\n";
  const chstate = buildChstate(source);

  const localNode = chstate.ast["1"] as AstNode;
  const rhsBefore = (localNode["2"] as AstNode)["1"] as AstNode;
  assertEquals(rhsBefore.tag, "Paren");

  run(chstate);

  const rhsAfter = (localNode["2"] as AstNode)["1"] as AstNode;
  assertEquals(rhsAfter.tag, "Op");
  assertEquals(rhsAfter["1"], "add");
});

Deno.test("run - preserves a trailing Paren wrapping a Call at the end of a table constructor", () => {
  const source = "local t = {(f())}\n";
  const chstate = buildChstate(source);

  const localNode = chstate.ast["1"] as AstNode;
  const tableNode = (localNode["2"] as AstNode)["1"] as AstNode;
  assertEquals(tableNode.tag, "Table");
  const before = tableNode["1"] as AstNode;
  assertEquals(before.tag, "Paren");
  assertEquals((before["1"] as AstNode).tag, "Call");

  run(chstate);

  const after = tableNode["1"] as AstNode;
  assertEquals(after.tag, "Paren");
  assertEquals((after["1"] as AstNode).tag, "Call");
});

Deno.test("run - preserves a trailing Paren wrapping a return Call", () => {
  const source = "local function f() return (g()) end\n";
  const chstate = buildChstate(source);

  run(chstate);

  const localrecNode = chstate.ast["1"] as AstNode;
  const functionNode = (localrecNode["2"] as AstNode)["1"] as AstNode;
  const body = functionNode["2"] as AstNode;
  const returnNode = body["1"] as AstNode;
  assertEquals(returnNode.tag, "Return");
  const returnValue = returnNode["1"] as AstNode;
  assertEquals(returnValue.tag, "Paren");
  assertEquals((returnValue["1"] as AstNode).tag, "Call");
});

Deno.test("run - warns 582 for 'not x < y' (negation binds before the relational operator)", () => {
  const source = "if not x < y then end\n";
  const chstate = buildChstate(source);

  run(chstate);

  assertEquals(chstate.warnings.length, 1);
  assertEquals(chstate.warnings[0].code, 582);
});

Deno.test("run - warns 581 for 'not (a == b)' with the replacement operator", () => {
  const source = "x = not (a == b)\n";
  const chstate = buildChstate(source);

  run(chstate);

  assertEquals(chstate.warnings.length, 1);
  assertEquals(chstate.warnings[0].code, 581);
  assertEquals(chstate.warnings[0].operator, "==");
  assertEquals(chstate.warnings[0].replacement_operator, "~=");
});
