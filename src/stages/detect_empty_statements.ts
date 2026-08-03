/**
 * Ported from luacheck's stages/detect_empty_statements.lua: warns about
 * semicolons that do not follow a statement (551). It reads only
 * `chstate.hangingSemicolons`, set by stages/parse.ts.
 */

import type { CheckStateInstance } from "../check_state.ts";

export const warnings: Record<
  string,
  { message_format: string; fields: string[] }
> = {
  "551": { message_format: "empty statement", fields: [] },
};

export function run(chstate: CheckStateInstance): void {
  for (const range of chstate.hangingSemicolons) {
    chstate.warnRange(551, range);
  }
}
