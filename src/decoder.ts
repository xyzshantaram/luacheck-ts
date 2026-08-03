/**
 * Ported from luacheck's decoder.lua.
 *
 * Indexing convention (deliberate departure from idiomatic 0-based JS):
 * this whole port keeps Lua's 1-based indexing everywhere `Chars` and the
 * lexer/parser exchange offsets, since lexer.lua/parser.lua are riddled
 * with 1-based offset arithmetic that would be error-prone to re-derive as
 * 0-based. See PLAN.md's port-strategy decision.
 *
 * "Bytes" convention: a Lua string is a byte sequence, not a Unicode
 * string. Source bytes are represented here as a JS "binary string": one
 * UTF-16 code unit per source byte, values 0-255. This lets `lua_pattern.ts`
 * (which operates on JS strings) be reused directly for the raw-byte
 * `find` operation below, instead of writing a second byte-array matcher.
 * Callers are responsible for producing this form (e.g. from a `Uint8Array`
 * of UTF-8 bytes) — that conversion belongs to the public API in a later
 * phase, not here.
 */

import { isPrintable } from "./unicode.ts";
import { luaFind } from "./lua_pattern.ts";

/**
 * `LatinChars` and `UnicodeChars` represent source strings and provide
 * Unicode-aware access to them with a common interface. Source bytes
 * should not be accessed directly.
 */
export interface Chars {
  /** Codepoint at 1-based character `index`, or `undefined` if out of range. */
  getCodepoint(index: number): number | undefined;
  /** Substring of original bytes for 1-based inclusive character range `[from, to]`. */
  getSubstring(from: number, to: number): string;
  /** Like `getSubstring`, but escapes non-printable characters. */
  getPrintableSubstring(from: number, to: number): string;
  /** Total number of characters. */
  getLength(): number;
  /**
   * Lua-pattern `find` over the raw bytes; `from` is a 1-based character
   * index, but (matching Lua) results are 1-based *byte* positions. Returns
   * `[start, end, ...captures]`, with no extra values when the pattern has
   * no explicit captures — mirrors `string.find`. A `()` position capture
   * yields a 1-based byte position (a number) instead of a substring.
   */
  find(
    pattern: string,
    from: number,
  ): [number, number, ...(string | number)[]] | undefined;
}

function hexEscape(byte: number): string {
  return "\\x" + byte.toString(16).toUpperCase().padStart(2, "0");
}

/** Optimized special case for latin1 (or invalid-UTF-8-fallback) strings: one byte = one character. */
class LatinChars implements Chars {
  constructor(private readonly bytes: string) {}

  getCodepoint(index: number): number | undefined {
    if (index < 1 || index > this.bytes.length) return undefined;
    return this.bytes.charCodeAt(index - 1);
  }

  getSubstring(from: number, to: number): string {
    return this.bytes.slice(from - 1, to);
  }

  getPrintableSubstring(from: number, to: number): string {
    let out = "";
    for (let i = from; i <= to; i++) {
      const byte = this.bytes.charCodeAt(i - 1);
      out += byte >= 32 && byte <= 126 ? this.bytes[i - 1] : hexEscape(byte);
    }
    return out;
  }

  getLength(): number {
    return this.bytes.length;
  }

  find(
    pattern: string,
    from: number,
  ): [number, number, ...(string | number)[]] | undefined {
    const result = luaFind(this.bytes, pattern, from - 1);
    if (!result) return undefined;
    return [result.start + 1, result.end, ...result.captures];
  }
}

/**
 * Decodes `bytes` as UTF-8. Returns arrays of codepoints and their 1-based
 * byte offsets (with one extra trailing offset pointing one byte past the
 * end), or `undefined` on decoding error. Direct port of
 * `get_codepoints_and_byte_offsets` in decoder.lua.
 */
function getCodepointsAndByteOffsets(
  bytes: string,
): [number[], number[]] | undefined {
  const codepoints: number[] = [];
  const byteOffsets: number[] = [];

  let byteIndex = 1;
  let codepointIndex = 1;

  const byteAt = (i: number): number | undefined =>
    i <= bytes.length ? bytes.charCodeAt(i - 1) : undefined;

  while (true) {
    byteOffsets[codepointIndex - 1] = byteIndex;

    let codepoint = byteAt(byteIndex);

    if (codepoint === undefined) {
      return [codepoints, byteOffsets];
    }

    byteIndex += 1;

    if (codepoint >= 0x80) {
      if (codepoint < 0xc0) return undefined;

      let cont = (byteAt(byteIndex) ?? 0) - 0x80;
      if (cont < 0 || cont >= 0x40) return undefined;
      byteIndex += 1;

      if (codepoint < 0xe0) {
        codepoint = cont + (codepoint - 0xc0) * 0x40;
      } else if (codepoint < 0xf0) {
        codepoint = cont + (codepoint - 0xe0) * 0x40;

        cont = (byteAt(byteIndex) ?? 0) - 0x80;
        if (cont < 0 || cont >= 0x40) return undefined;
        byteIndex += 1;

        codepoint = cont + codepoint * 0x40;
      } else if (codepoint < 0xf8) {
        codepoint = cont + (codepoint - 0xf0) * 0x40;

        cont = (byteAt(byteIndex) ?? 0) - 0x80;
        if (cont < 0 || cont >= 0x40) return undefined;
        byteIndex += 1;
        codepoint = cont + codepoint * 0x40;

        cont = (byteAt(byteIndex) ?? 0) - 0x80;
        if (cont < 0 || cont >= 0x40) return undefined;
        byteIndex += 1;
        codepoint = cont + codepoint * 0x40;

        if (codepoint > 0x10ffff) return undefined;
      } else {
        return undefined;
      }
    }

    codepoints[codepointIndex - 1] = codepoint;
    codepointIndex += 1;
  }
}

/** General case for non-latin1 strings; assumes UTF-8, falls back to latin1 on decoding error. */
class UnicodeChars implements Chars {
  constructor(
    private readonly bytes: string,
    private readonly codepoints: number[],
    private readonly byteOffsets: number[],
  ) {}

  getCodepoint(index: number): number | undefined {
    return this.codepoints[index - 1];
  }

  getSubstring(from: number, to: number): string {
    return this.bytes.slice(
      this.byteOffsets[from - 1] - 1,
      this.byteOffsets[to] - 1,
    );
  }

  getPrintableSubstring(from: number, to: number): string {
    const parts: string[] = [];

    for (let index = from; index <= to; index++) {
      const codepoint = this.codepoints[index - 1];

      if (isPrintable(codepoint)) {
        parts.push(this.getSubstring(index, index));
      } else {
        parts.push(
          codepoint > 255
            ? `\\u{${codepoint.toString(16).toUpperCase()}}`
            : hexEscape(codepoint),
        );
      }
    }

    return parts.join("");
  }

  getLength(): number {
    return this.codepoints.length;
  }

  find(
    pattern: string,
    from: number,
  ): [number, number, ...(string | number)[]] | undefined {
    const result = luaFind(this.bytes, pattern, this.byteOffsets[from - 1] - 1);
    if (!result) return undefined;
    return [result.start + 1, result.end, ...result.captures];
  }
}

/** Only uses `UnicodeChars` if necessary; `LatinChars` isn't much faster but noticeably more memory efficient. */
export function decode(bytes: string): Chars {
  let hasHighByte = false;
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes.charCodeAt(i);
    if (code >= 128 && code <= 255) {
      hasHighByte = true;
      break;
    }
  }

  if (hasHighByte) {
    const result = getCodepointsAndByteOffsets(bytes);
    if (result) {
      const [codepoints, byteOffsets] = result;
      return new UnicodeChars(bytes, codepoints, byteOffsets);
    }
  }

  return new LatinChars(bytes);
}
