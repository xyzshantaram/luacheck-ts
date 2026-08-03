/**
 * Ported from luacheck's format.lua, lines 1-80 only
 * (`get_message_format`/`substitute`/`format_message`/`format.get_message`).
 * The rest of format.lua (CLI report printing) is out of scope. There is
 * no color parameter here: color only mattered for CLI terminal output.
 *
 * `stages.warnings` keys warning entries by a zero-padded 3-digit string
 * (e.g. "011", "021"), while `Warning.code` is a plain number (11, 21).
 * The lookup below pads the code to 3 digits before indexing
 * `stages.warnings`, so codes under 100 still resolve.
 */

import type { Warning } from "./check_state.ts";
import { stages } from "./stages/init.ts";

function getMessageFormat(warning: Warning): string {
  const codeKey = String(warning.code).padStart(3, "0");
  const info = stages.warnings[codeKey];

  if (!info) {
    throw new Error(`Unknown warning code ${warning.code}`);
  }

  const messageFormat = info.message_format;

  if (typeof messageFormat === "function") {
    return messageFormat(warning);
  }

  return messageFormat;
}

function substitute(format: string, warning: Warning): string {
  return format.replace(
    /\{([_a-zA-Z0-9]+)(!?)\}/g,
    (_match, fieldName: string, highlight: string) => {
      const fieldValue = warning[fieldName];

      if (fieldValue === undefined) {
        throw new Error(`No field ${fieldName}`);
      }

      const value = String(fieldValue);
      return highlight === "!" ? `'${value}'` : value;
    },
  );
}

/** Returns the formatted message for a warning. */
export function getMessage(warning: Warning): string {
  return substitute(getMessageFormat(warning), warning);
}
