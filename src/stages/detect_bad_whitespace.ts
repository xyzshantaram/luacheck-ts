/**
 * Ported from luacheck's stages/detect_bad_whitespace.lua: warns about
 * lines that contain only whitespace (611), trailing whitespace
 * (612/613/614, depending on the line ending type), and inconsistent
 * indentation - a space followed by a tab (621). It reads only
 * `chstate.source`, `chstate.lineOffsets`, `chstate.lineLengths`, and
 * `chstate.lineEndings`, all set by stages/parse.ts.
 */

import type { CheckStateInstance } from "../check_state.ts";

export const warnings: Record<
  string,
  { message_format: string; fields: string[] }
> = {
  "611": { message_format: "line contains only whitespace", fields: [] },
  "612": { message_format: "line contains trailing whitespace", fields: [] },
  "613": { message_format: "trailing whitespace in a string", fields: [] },
  "614": { message_format: "trailing whitespace in a comment", fields: [] },
  "621": {
    message_format: "inconsistent indentation (SPACE followed by TAB)",
    fields: [],
  },
};

/**
 * Detects bad whitespace on one line and warns about it. Zero-length lines
 * are skipped entirely.
 */
function checkLine(
  chstate: CheckStateInstance,
  lineNumber: number,
  numLines: number,
): void {
  const lineOffset = chstate.lineOffsets[lineNumber];
  const lineLength = chstate.lineLengths[lineNumber];

  if (lineLength > 0) {
    // The last line may lack a trailing newline, so its pattern allows an
    // optional newline at the end.
    const trailingWsPattern = lineNumber === numLines
      ? "^[^\r\n]-()[ \t\f\v]+()[\r\n]?$"
      : "^[^\r\n]-()[ \t\f\v]+()[\r\n]";

    const result = chstate.source.find(trailingWsPattern, lineOffset);
    let trailingWsCode: number | undefined;

    if (result) {
      // The two `()` position captures always yield numbers for this pattern.
      const [lineStartByte, , trailingWsStartByte, lineEndByte] = result as [
        number,
        number,
        number,
        number,
      ];

      if (trailingWsStartByte === lineStartByte) {
        // Line contains only whitespace (thus never considered "code").
        trailingWsCode = 611;
      } else if (!chstate.lineEndings[lineNumber]) {
        // Trailing whitespace on code line or after long comment.
        trailingWsCode = 612;
      } else if (chstate.lineEndings[lineNumber] === "string") {
        // Trailing whitespace embedded in a string literal.
        trailingWsCode = 613;
      } else if (chstate.lineEndings[lineNumber] === "comment") {
        // Trailing whitespace at the end of a line comment or inside long comment.
        trailingWsCode = 614;
      }

      // The difference between the start and the end of the warning range
      // is the same in bytes and in characters because whitespace
      // characters are ASCII. Can calculate one based on the three others.
      const trailingWsEndByte = lineEndByte - 1;
      const trailingWsEndChar = lineOffset + lineLength - 1;
      const trailingWsStartChar = trailingWsEndChar -
        (trailingWsEndByte - trailingWsStartByte);

      // One of the four branches above always assigns when a match succeeded.
      chstate.warn(
        trailingWsCode!,
        lineNumber,
        trailingWsStartChar,
        trailingWsEndChar,
      );
    }

    // Don't look for inconsistent whitespace in pure whitespace lines.
    if (trailingWsCode !== 611) {
      const leadingWs = chstate.source.find(
        "^[ \t\f\v]- \t[ \t\f\v]*",
        lineOffset,
      );

      if (leadingWs) {
        // Inconsistent leading whitespace (SPACE followed by TAB).
        // Calculate warning end in characters using same logic as above.
        const [leadingWsStartByte, leadingWsEndByte] = leadingWs;
        const leadingWsStartChar = lineOffset;
        const leadingWsEndChar = leadingWsStartChar +
          (leadingWsEndByte - leadingWsStartByte);

        chstate.warn(621, lineNumber, lineOffset, leadingWsEndChar);
      }
    }
  }
}

/**
 * Warns about bad whitespace: lines that contain only whitespace, trailing
 * whitespace, and inconsistent indentation with a space before a tab.
 */
export function run(chstate: CheckStateInstance): void {
  // `lineOffsets`/`lineLengths` are 1-based arrays: index 0 is unused, so
  // `.length` is numberOfLines + 1.
  const numLines = chstate.lineOffsets.length - 1;

  for (let lineNumber = 1; lineNumber <= numLines; lineNumber++) {
    checkLine(chstate, lineNumber, numLines);
  }
}
