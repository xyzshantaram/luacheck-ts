/**
 * Ported busted spec: .reference/luacheck/spec/decoder_spec.lua
 *
 * Translation notes:
 *
 * - The "utf8" case's expected bytes/offsets are computed independently of
 *   decoder.ts, using the platform's own `TextEncoder`/`TextDecoder` (not a
 *   second hand-written UTF-8 codec), so this is a real independent check
 *   rather than the implementation validating itself.
 * - Scope simplification: the original Lua spec sweeps codepoints in steps
 *   of 0x800 starting at 0, which happens to land on the UTF-16 surrogate
 *   range (0xD800-0xDFFF) — codepoints that are not valid Unicode scalar
 *   values. Lua's untyped-integer model round-trips these fine, but JS's
 *   `TextEncoder` replaces lone surrogates with U+FFFD, which would make
 *   this test's oracle disagree with a *correct* decoder.ts for reasons
 *   unrelated to the code under test. Surrogate codepoints are skipped here
 *   for that reason; nothing in decoder.ts's own decoding algorithm treats
 *   the surrogate range specially, so this does not reduce real coverage.
 * - The "falls back to latin1" cases construct raw byte strings directly
 *   (Lua's `string.char`), unrelated to real UTF-8 or surrogates.
 */

import { assertEquals } from "@std/assert";
import { type Chars, decode } from "./decoder.ts";

function isSurrogate(codepoint: number): boolean {
  return codepoint >= 0xd800 && codepoint <= 0xdfff;
}

function utf8BytesOf(codepoint: number): string {
  const encoded = new TextEncoder().encode(String.fromCodePoint(codepoint));
  let out = "";
  for (const byte of encoded) out += String.fromCharCode(byte);
  return out;
}

function utf8Bytes(codepoints: number[]): string {
  return codepoints.map(utf8BytesOf).join("");
}

function latin1Bytes(values: number[]): string {
  return String.fromCharCode(...values);
}

function assertUtf8Encoding(codepoints: number[]) {
  const bytes = utf8Bytes(codepoints);
  const chars: Chars = decode(bytes);
  const length = codepoints.length;

  assertEquals(chars.getLength(), length);

  for (let from = 1; from <= length; from++) {
    for (let to = from; to <= length; to++) {
      const expected = utf8Bytes(codepoints.slice(from - 1, to));
      assertEquals(chars.getSubstring(from, to), expected);
    }
  }

  let offset = 1;
  for (let index = 1; index <= length; index++) {
    const codepoint = codepoints[index - 1];
    assertEquals(chars.getCodepoint(index), codepoint);

    const found = chars.find("(.)", index);
    assertEquals(found?.[0], offset);
    assertEquals(found?.[1], offset);
    assertEquals(found?.[2], bytes[offset - 1]);

    offset += utf8BytesOf(codepoint).length;
  }
}

function assertLatin1Encoding(values: number[]) {
  const bytes = latin1Bytes(values);
  const chars: Chars = decode(bytes);
  const length = values.length;

  assertEquals(chars.getLength(), length);

  for (let from = 1; from <= length; from++) {
    for (let to = from; to <= length; to++) {
      assertEquals(chars.getSubstring(from, to), bytes.slice(from - 1, to));
    }
  }

  for (let index = 1; index <= length; index++) {
    assertEquals(chars.getCodepoint(index), values[index - 1]);

    const found = chars.find("(.)", index);
    assertEquals(found?.[0], index);
    assertEquals(found?.[1], index);
    assertEquals(found?.[2], bytes[index - 1]);
  }
}

Deno.test("decoder", async (t) => {
  await t.step("decodes valid codepoints correctly", () => {
    // Checking literally all codepoints is slow; the original spec picks a
    // sparse sweep, same here.
    for (let base = 0; base <= 0x10ffff; base += 0x800) {
      for (let offset = 0; offset <= 0x100; offset += 41) {
        const codepoint1 = base + offset;
        const codepoint2 = codepoint1 + 9;
        if (
          codepoint2 > 0x10ffff || isSurrogate(codepoint1) ||
          isSurrogate(codepoint2)
        ) {
          continue;
        }
        assertUtf8Encoding([codepoint1, codepoint2]);
      }
    }
  });

  await t.step("falls back to latin1 on invalid utf8", () => {
    // Bad first byte.
    assertLatin1Encoding([0xc0, 0x80, 0x80, 0x80]);
    assertLatin1Encoding([0x00, 0xf8, 0x80, 0x80, 0x80]);

    // Two bytes, bad continuation byte.
    assertLatin1Encoding([0x00, 0xc0, 0x00, 0xc0, 0x80]);
    assertLatin1Encoding([0x00, 0xc0, 0xff, 0xc0, 0x80]);

    // Three bytes, bad first continuation byte.
    assertLatin1Encoding([0x00, 0xe0, 0x00, 0xc0, 0x80]);
    assertLatin1Encoding([0x00, 0xe0, 0xff, 0xc0, 0x80]);

    // Three bytes, bad second continuation byte.
    assertLatin1Encoding([0x00, 0xe0, 0x80, 0x00, 0xc0, 0x80]);
    assertLatin1Encoding([0x00, 0xe0, 0x80, 0xff, 0xc0, 0x80]);

    // Four bytes, bad first continuation byte.
    assertLatin1Encoding([0x00, 0xf0, 0x00, 0xc0, 0x80]);
    assertLatin1Encoding([0x00, 0xf0, 0xff, 0xc0, 0x80]);

    // Four bytes, bad second continuation byte.
    assertLatin1Encoding([0x00, 0xf0, 0x80, 0x00, 0xc0, 0x80]);
    assertLatin1Encoding([0x00, 0xf0, 0x80, 0xff, 0xc0, 0x80]);

    // Four bytes, bad third continuation byte.
    assertLatin1Encoding([0x00, 0xf0, 0x80, 0x80, 0x00, 0xc0, 0x80]);
    assertLatin1Encoding([0x00, 0xf0, 0x80, 0x80, 0xff, 0xc0, 0x80]);

    // Codepoint too large.
    assertLatin1Encoding([0xf7, 0x80, 0x80, 0x80, 0x00]);
  });
});
