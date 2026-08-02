/**
 * Hand-written tests for stages/parse_inline_options.ts. No upstream busted
 * spec exists for stages/parse_inline_options.lua in isolation (only
 * indirect coverage via check_spec.lua/cli_spec.lua end-to-end tests), so
 * these tests are not a port - same spirit as unwrap_parens_test.ts.
 *
 * `run` from ./parse_inline_options.ts does not exist yet (ticket 4.3's
 * implementation dispatch adds it); a throwing placeholder stands in so
 * this file type-checks. `chstate.comments`/`chstate.offsetToColumn` come
 * from the already-ported, real parse.ts/linearize.ts, so expected column
 * values below are computed from that real state, captured before the
 * placeholder throws - the assertions after the `run` call are unreachable
 * against the placeholder, and `deno test` failing there is expected.
 */

import { assertEquals } from "@std/assert";
import { checkStateNew } from "../check_state.ts";
import { run as parseRun } from "./parse.ts";
import { run as unwrapParensRun } from "./unwrap_parens.ts";
import { run as linearizeRun } from "./linearize.ts";
import { run as parseInlineOptionsRun } from "./parse_inline_options.ts";

function getChstateBeforeParseInlineOptions(
  source: string,
): ReturnType<typeof checkStateNew> {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  chstate.warnings = [];
  unwrapParensRun(chstate);
  chstate.warnings = [];
  linearizeRun(chstate);
  chstate.warnings = [];
  return chstate;
}

Deno.test("run - valid single inline option with an argument (ignore foo)", () => {
  const source = "-- luacheck: ignore foo\nlocal x = 1\n";
  const chstate = getChstateBeforeParseInlineOptions(source);
  const comment = chstate.comments[0];
  const column = chstate.offsetToColumn(comment.line, comment.offset);
  const endColumn = chstate.offsetToColumn(comment.line, comment.endOffset);

  parseInlineOptionsRun(chstate);

  assertEquals(chstate.inlineOptions, [
    { line: 1, column, end_column: endColumn, options: { ignore: ["foo"] } },
  ]);
  assertEquals(chstate.warnings, []);
});

Deno.test("run - valid std option", () => {
  const source = "-- luacheck: std lua54\nlocal x = 1\n";
  const chstate = getChstateBeforeParseInlineOptions(source);
  const comment = chstate.comments[0];
  const column = chstate.offsetToColumn(comment.line, comment.offset);
  const endColumn = chstate.offsetToColumn(comment.line, comment.endOffset);

  parseInlineOptionsRun(chstate);

  assertEquals(chstate.inlineOptions, [
    { line: 1, column, end_column: endColumn, options: { std: "lua54" } },
  ]);
  assertEquals(chstate.warnings, []);
});

Deno.test("run - paired push/pop directives wrap an inline option", () => {
  const source =
    "-- luacheck: push\n-- luacheck: ignore foo\nlocal x = 1\n-- luacheck: pop\n";
  const chstate = getChstateBeforeParseInlineOptions(source);
  const ignoreComment = chstate.comments[1];
  const column = chstate.offsetToColumn(
    ignoreComment.line,
    ignoreComment.offset,
  );
  const endColumn = chstate.offsetToColumn(
    ignoreComment.line,
    ignoreComment.endOffset,
  );

  parseInlineOptionsRun(chstate);

  // The bare push on line 1 opens the option stack; the plain option table
  // on line 2 is the only thing pushed onto it; the bare pop on line 4
  // closes it, so a single pop_count entry lands at line 5 (one past the
  // pop directive's own line), per apply_boundaries's "place the pop
  // instruction at the start of the next line" comment.
  assertEquals(chstate.inlineOptions, [
    { line: 2, column, end_column: endColumn, options: { ignore: ["foo"] } },
    { line: 5, pop_count: 1 },
  ]);
  assertEquals(chstate.warnings, []);
});

Deno.test("run - unpaired pop directive warns 023 and adds no inline option entry", () => {
  const source = "-- luacheck: pop\nlocal x = 1\n";
  const chstate = getChstateBeforeParseInlineOptions(source);
  const comment = chstate.comments[0];
  const column = chstate.offsetToColumn(comment.line, comment.offset);
  const endColumn = chstate.offsetToColumn(comment.line, comment.endOffset);

  parseInlineOptionsRun(chstate);

  assertEquals(chstate.inlineOptions, []);
  assertEquals(chstate.warnings.length, 1);
  assertEquals(chstate.warnings[0].code, 23);
  assertEquals(chstate.warnings[0].line, 1);
  assertEquals(chstate.warnings[0].column, column);
  assertEquals(chstate.warnings[0].end_column, endColumn);
});

Deno.test("run - unpaired push directive warns 022 and adds no inline option entry", () => {
  const source = "-- luacheck: push\nlocal x = 1\n";
  const chstate = getChstateBeforeParseInlineOptions(source);
  const comment = chstate.comments[0];
  const column = chstate.offsetToColumn(comment.line, comment.offset);
  const endColumn = chstate.offsetToColumn(comment.line, comment.endOffset);

  parseInlineOptionsRun(chstate);

  assertEquals(chstate.inlineOptions, []);
  assertEquals(chstate.warnings.length, 1);
  assertEquals(chstate.warnings[0].code, 22);
  assertEquals(chstate.warnings[0].line, 1);
  assertEquals(chstate.warnings[0].column, column);
  assertEquals(chstate.warnings[0].end_column, endColumn);
});

Deno.test("run - unknown option name warns 021 with the offending comment's message", () => {
  const source = "-- luacheck: bogus_option\nlocal x = 1\n";
  const chstate = getChstateBeforeParseInlineOptions(source);
  const comment = chstate.comments[0];
  const column = chstate.offsetToColumn(comment.line, comment.offset);
  const endColumn = chstate.offsetToColumn(comment.line, comment.endOffset);

  parseInlineOptionsRun(chstate);

  assertEquals(chstate.inlineOptions, []);
  assertEquals(chstate.warnings.length, 1);
  assertEquals(chstate.warnings[0].code, 21);
  assertEquals(chstate.warnings[0].line, 1);
  assertEquals(chstate.warnings[0].column, column);
  assertEquals(chstate.warnings[0].end_column, endColumn);
  assertEquals(
    chstate.warnings[0].msg,
    "unknown inline option 'bogus_option'",
  );
});

Deno.test("run - an inline comment on a code line is auto-popped at the start of the next line", () => {
  const source = "local x = 1 -- luacheck: ignore foo\nlocal y = 2\n";
  const chstate = getChstateBeforeParseInlineOptions(source);
  const comment = chstate.comments[0];
  const column = chstate.offsetToColumn(comment.line, comment.offset);
  const endColumn = chstate.offsetToColumn(comment.line, comment.endOffset);

  parseInlineOptionsRun(chstate);

  assertEquals(chstate.inlineOptions, [
    { line: 1, column, end_column: endColumn, options: { ignore: ["foo"] } },
    { line: 2, pop_count: 1 },
  ]);
  assertEquals(chstate.warnings, []);
});

Deno.test("run - function boundaries auto-push/pop around a nested inline option", () => {
  const source =
    "local function f()\n  -- luacheck: ignore foo\n  print(bar)\nend\n";
  const chstate = getChstateBeforeParseInlineOptions(source);
  const comment = chstate.comments[0];
  const column = chstate.offsetToColumn(comment.line, comment.offset);
  const endColumn = chstate.offsetToColumn(comment.line, comment.endOffset);

  parseInlineOptionsRun(chstate);

  // The function's own implicit push/pop (from add_function_boundaries)
  // wrap the "ignore foo" comment on line 2; the function's closing "end"
  // is on line 4, so the pop_count entry for its implicit pop lands on
  // line 5, same "next line" placement rule as the push/pop-directive case
  // above.
  assertEquals(chstate.inlineOptions, [
    { line: 2, column, end_column: endColumn, options: { ignore: ["foo"] } },
    { line: 5, pop_count: 1 },
  ]);
  assertEquals(chstate.warnings, []);
});
