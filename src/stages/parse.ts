/**
 * Ported from luacheck's stages/parse.lua. Decodes `chstate.sourceBytes`
 * and runs the parser, wiring the results onto `chstate`.
 *
 * Mirrors upstream's pre-allocation: `chstate.lineOffsets`/
 * `chstate.lineLengths` are set to empty arrays and passed into
 * `parse()` as out-params *before* parsing starts, not read off the
 * return value afterward. `parse()`/`lexer.newState()` mutate the same
 * array references in place, so this is what keeps both fields
 * populated (if only partially) even when `parse()` throws a
 * `SyntaxError` partway through - a case `check.ts` relies on to call
 * `chstate.offsetToColumn()` from its syntax-error branch.
 */

import type { CheckStateInstance } from "../check_state.ts";
import { decode } from "../decoder.ts";
import { parse } from "../parser.ts";

export function run(chstate: CheckStateInstance): void {
  chstate.source = decode(chstate.sourceBytes);
  chstate.lineOffsets = [];
  chstate.lineLengths = [];

  const result = parse(
    chstate.source,
    chstate.lineOffsets,
    chstate.lineLengths,
  );
  chstate.ast = result.ast;
  chstate.comments = result.comments;
  chstate.codeLines = result.codeLines;
  chstate.lineEndings = result.lineEndings;
  chstate.hangingSemicolons = result.hangingSemicolons;
  chstate.lineOffsets = result.lineOffsets;
  chstate.lineLengths = result.lineLengths;
}
