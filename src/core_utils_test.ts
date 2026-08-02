/**
 * Hand-written tests for core_utils.ts. No upstream busted spec exists for
 * core_utils.lua, so these tests are not a port.
 *
 * Only `evalConstNode` and `sortByLocation` are covered: `eachStatement`
 * needs `chstate.lines`, which comes from the not-yet-ported
 * stages/linearize.lua, so it cannot be exercised meaningfully yet.
 * `check_state.ts` is also untested this ticket for the same reason.
 */

import { assertEquals } from "@std/assert";
import type { AstNode } from "./parser.ts";
import type { Warning } from "./check_state.ts";
import { evalConstNode, sortByLocation } from "./core_utils.ts";

Deno.test("evalConstNode - True node", () => {
  const node: AstNode = { tag: "True" };
  assertEquals(evalConstNode(node), [true, "true"]);
});

Deno.test("evalConstNode - False node", () => {
  const node: AstNode = { tag: "False" };
  assertEquals(evalConstNode(node), [false, "false"]);
});

Deno.test("evalConstNode - String node, plain ASCII", () => {
  const node: AstNode = { tag: "String", "1": "hello" };
  assertEquals(evalConstNode(node), ["hello", "hello"]);
});

Deno.test("evalConstNode - decimal integer", () => {
  const node: AstNode = { tag: "Number", "1": "42" };
  assertEquals(evalConstNode(node), [42, "42"]);
});

Deno.test("evalConstNode - decimal float", () => {
  const node: AstNode = { tag: "Number", "1": "1.5" };
  assertEquals(evalConstNode(node), [1.5, "1.5"]);
});

Deno.test("evalConstNode - decimal float with no leading digit", () => {
  const node: AstNode = { tag: "Number", "1": ".5" };
  assertEquals(evalConstNode(node), [0.5, ".5"]);
});

Deno.test("evalConstNode - decimal float with no trailing digit", () => {
  const node: AstNode = { tag: "Number", "1": "3." };
  assertEquals(evalConstNode(node), [3, "3."]);
});

Deno.test("evalConstNode - decimal float with exponent", () => {
  const node: AstNode = { tag: "Number", "1": "1e10" };
  assertEquals(evalConstNode(node), [1e10, "1e10"]);
});

Deno.test("evalConstNode - hex integer", () => {
  const node: AstNode = { tag: "Number", "1": "0x1F" };
  assertEquals(evalConstNode(node), [31, "0x1F"]);
});

Deno.test("evalConstNode - hex float, integer mantissa", () => {
  const node: AstNode = { tag: "Number", "1": "0x1p4" };
  assertEquals(evalConstNode(node), [16, "0x1p4"]);
});

Deno.test("evalConstNode - hex float, fractional mantissa", () => {
  const node: AstNode = { tag: "Number", "1": "0x1.8p3" };
  assertEquals(evalConstNode(node), [12, "0x1.8p3"]);
});

Deno.test("evalConstNode - negative number via Op/unm", () => {
  const node: AstNode = {
    tag: "Op",
    "1": "unm",
    "2": { tag: "Number", "1": "5" },
  };
  assertEquals(evalConstNode(node), [-5, "-5"]);
});

Deno.test("evalConstNode - rejects LuaJIT cdata suffix", () => {
  const node: AstNode = { tag: "Number", "1": "1LL" };
  assertEquals(evalConstNode(node), undefined);
});

Deno.test("evalConstNode - rejects non-constant node", () => {
  const node: AstNode = { tag: "Id", "1": "x" };
  assertEquals(evalConstNode(node), undefined);
});

function makeWarning(
  line: number,
  column: number,
  code: number,
): Warning {
  return { code, line, column, end_column: column };
}

Deno.test("sortByLocation - sorts by line, then column, then code, in place", () => {
  const warnings: Warning[] = [
    makeWarning(2, 1, 100),
    makeWarning(1, 5, 200),
    makeWarning(1, 1, 300),
    makeWarning(1, 1, 100),
  ];
  const original = warnings;

  sortByLocation(warnings);

  assertEquals(warnings, original);
  assertEquals(
    warnings.map((w) => [w.line, w.column, w.code]),
    [
      [1, 1, 100],
      [1, 1, 300],
      [1, 5, 200],
      [2, 1, 100],
    ],
  );
});
