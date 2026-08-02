/**
 * Hand-written tests for stages/parse.ts. No upstream busted spec exists
 * for stages/parse.lua in isolation (only indirect coverage via
 * check_spec.lua/cli_spec.lua end-to-end tests), so these tests are not a
 * port.
 *
 * These only check wiring: that `run` decodes `sourceBytes` and forwards
 * `parser.parse`'s result onto `chstate`'s fields correctly. `parser.ts`
 * and `decoder.ts` are already fully tested elsewhere, so the expected
 * values here are computed by calling `decode`/`parse` directly on the
 * same source and comparing.
 */

import { assertEquals } from "@std/assert";
import { checkStateNew } from "../check_state.ts";
import { decode } from "../decoder.ts";
import { parse } from "../parser.ts";
import { run } from "./parse.ts";

Deno.test("run - wires decoded source and parse() output onto chstate", () => {
  const source = "local x = 1\n";
  const chstate = checkStateNew(source);

  run(chstate);

  const expected = parse(decode(source));

  assertEquals(chstate.ast, expected.ast);
  assertEquals(chstate.comments, expected.comments);
  assertEquals(chstate.codeLines, expected.codeLines);
  assertEquals(chstate.lineEndings, expected.lineEndings);
  assertEquals(chstate.hangingSemicolons, expected.hangingSemicolons);
  assertEquals(chstate.lineOffsets, expected.lineOffsets);
  assertEquals(chstate.lineLengths, expected.lineLengths);
});

Deno.test("run - populates comments from source", () => {
  const source = "-- a comment\nlocal x = 1\n";
  const chstate = checkStateNew(source);

  run(chstate);

  const expected = parse(decode(source));
  assertEquals(chstate.comments, expected.comments);
  assertEquals(chstate.comments.length, 1);
  assertEquals(chstate.comments[0].contents, " a comment");
});

Deno.test("run - populates hangingSemicolons for a stray semicolon", () => {
  const source = ";local x = 1\n";
  const chstate = checkStateNew(source);

  run(chstate);

  const expected = parse(decode(source));
  assertEquals(chstate.hangingSemicolons, expected.hangingSemicolons);
  assertEquals(chstate.hangingSemicolons.length, 1);
});

Deno.test("run - leaves hangingSemicolons empty when semicolons are not hanging", () => {
  const source = "local x = 1;\nlocal y = 2;\n";
  const chstate = checkStateNew(source);

  run(chstate);

  assertEquals(chstate.hangingSemicolons.length, 0);
});
