/**
 * Ported from luacheck's stages/detect_unreachable_code.lua: warns about
 * items unreachable from the start of their function line (511), and about
 * loops executed at most once (512, warning on the loop-end `Noop` item),
 * walking `line.walk` from the function start and again from each reported
 * item. `Jump`/`Cjump` items carry no node and are never reported.
 */

import type { Range } from "../parser.ts";
import type { CheckStateInstance } from "../check_state.ts";
import type { Item, LineInstance } from "./linearize.ts";

export const warnings: Record<
  string,
  { message_format: string; fields: string[] }
> = {
  "511": { message_format: "unreachable code", fields: [] },
  "512": { message_format: "loop is executed at most once", fields: [] },
};

// Upstream `noop_callback` does nothing and returns nothing.
function noopCallback(): void {
  // no-op
}

function detectUnreachableCode(
  chstate: CheckStateInstance,
  line: LineInstance,
): void {
  const reachableIndexes: Record<number, boolean> = {};

  // Mark all items reachable from the function start.
  line.walk(reachableIndexes, 1, noopCallback);

  // All remaining items are unreachable.
  // However, there is no point in reporting all of them.
  // Only report those that are not reachable from any already reported ones.
  for (let itemIndex = 1; itemIndex <= line.items.size; itemIndex++) {
    const item = line.items[itemIndex] as Item;

    if (!reachableIndexes[itemIndex]) {
      if ("node" in item) {
        if (item.node) {
          chstate.warnRange(
            item.tag === "Noop" && item.loopEnd ? 512 : 511,
            item.node as Range,
          );
          // Mark all items reachable from the item just reported.
          line.walk(reachableIndexes, itemIndex, noopCallback);
        }
      }
    }
  }
}

/**
 * Warns about items unreachable from the start of their function line and
 * about loops executed at most once.
 */
export function run(chstate: CheckStateInstance): void {
  for (const line of chstate.lines) {
    detectUnreachableCode(chstate, line);
  }
}
