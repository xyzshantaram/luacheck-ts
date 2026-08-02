/**
 * Ported from luacheck's stages/parse.lua. Decodes `chstate.sourceBytes`
 * and runs the parser, wiring the results onto `chstate`.
 *
 * Upstream pre-allocates `chstate.line_offsets`/`chstate.line_lengths` and
 * passes them into `parser.parse` as out-params. This port's `parse()`
 * already returns fresh `lineOffsets`/`lineLengths` arrays regardless of
 * whether out-params are supplied (see `lexer.ts`'s `newState`), so this
 * file skips the pre-allocation and reads them off the same call's return
 * value instead.
 */

import type { CheckStateInstance } from "../check_state.ts";
import { decode } from "../decoder.ts";
import { parse } from "../parser.ts";

export function run(chstate: CheckStateInstance): void {
  chstate.source = decode(chstate.sourceBytes);

  const result = parse(chstate.source);
  chstate.ast = result.ast;
  chstate.comments = result.comments;
  chstate.codeLines = result.codeLines;
  chstate.lineEndings = result.lineEndings;
  chstate.hangingSemicolons = result.hangingSemicolons;
  chstate.lineOffsets = result.lineOffsets;
  chstate.lineLengths = result.lineLengths;
}
