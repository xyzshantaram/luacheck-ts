/**
 * Ported busted spec: .reference/luacheck/spec/utils_spec.lua
 *
 * One Deno test per busted `describe` block, with one `t.step` per busted
 * `it` block, mirroring the spec's describe/it nesting.
 *
 * Translation conventions (judgment calls, Lua -> TS):
 *
 * - Lua `nil` maps to `undefined`.
 * - Lua multi-return values map to arrays/tuples: `local ok, err = f()` in
 *   Lua becomes `const [ok, err] = f()` in TS. A Lua function that returns
 *   several values maps to a TS function returning an array of those values.
 * - Lua 1-based array indices are preserved where the API exposes them.
 * - Lua pattern strings (`"bar:%s*"`, `"%S+"`) are passed through unchanged
 *   where the API is pattern-based; the port supplies the Lua-pattern
 *   matcher.
 * - Method calls `stack:push(7)` become `stack.push(7)` (self is implicit).
 * - Function names are camelCased. Adjust the names if the port keeps the
 *   Lua snake_case identifiers.
 * - `unicode.ts` is intentionally not imported: `utils_spec.lua` has no
 *   unicode coverage (unicode.lua has no upstream spec; it is exercised
 *   indirectly via the decoder tests in ticket 2.2).
 * - `read_file`/`load`/`load_config` are intentionally not ported (see the
 *   comment above the `array_to_set` test): CLI-only filesystem/dynamic-load
 *   helpers, out of scope for a browser library.
 *
 * This file intentionally does not run yet: `./utils.ts` is the ticket-2.1
 * implementation and does not exist. The expected failure is a missing-module
 * error on `import * as utils from "./utils.ts"`.
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import * as utils from "./utils.ts";

// read_file / load / load_config are intentionally not ported: they are
// filesystem and dynamic-code-loading helpers used only by the CLI's
// .luacheckrc config loading. Excluded per .reference/PORT_NOTES.md §4 (no
// `io` in a browser library). See PLAN.md Phase 3 decisions.

Deno.test("concat_arrays", async (t) => {
  await t.step("returns concatenated arrays", () => {
    assertEquals(utils.concatArrays([[], [1], [2, 3, 4], []]), [1, 2, 3, 4]);
  });
});

Deno.test("update", async (t) => {
  await t.step("updates first table with entries from second", () => {
    // Widened type: the whole point is that update() adds the k3 key to t1.
    const t1: Record<string, number> = { k1: 1, k2: 2 };
    const t2 = { k2: 3, k3: 4 };
    const ret = utils.update(t1, t2);
    assertEquals(t1, { k1: 1, k2: 3, k3: 4 });
    // Lua `assert.equal(t1, ret)` is reference equality: update returns t1.
    assertStrictEquals(t1, ret);
  });
});

Deno.test("Stack", async (t) => {
  await t.step("supports push/pop operations and top/size fields", () => {
    const stack = new utils.Stack();
    assertEquals(stack.size, 0);
    assertEquals(stack.top, undefined);

    stack.push(7);
    stack.push(8);
    assertEquals(stack.size, 2);
    assertEquals(stack.top, 8);

    assertEquals(stack.pop(), 8);
    assertEquals(stack.size, 1);
    assertEquals(stack.top, 7);

    stack.push(4);
    assertEquals(stack.size, 2);
    assertEquals(stack.top, 4);

    assertEquals(stack.pop(), 4);
    assertEquals(stack.pop(), 7);
    assertEquals(stack.size, 0);
    assertEquals(stack.top, undefined);
  });
});

Deno.test("after", async (t) => {
  await t.step("returns substring after match", () => {
    assertEquals(utils.after("bar: foo bar: baz", "bar:%s*"), "foo bar: baz");
  });

  await t.step("returns nil when there is no match", () => {
    assertEquals(utils.after("bar: foo bar: baz", "baz:%s*"), undefined);
  });
});

Deno.test("strip", async (t) => {
  await t.step("returns string without whitespace on ends", () => {
    assertEquals(utils.strip("\tfoo bar\n   "), "foo bar");
  });
});

Deno.test("split", async (t) => {
  await t.step("without separator, returns non-whitespace substrings", () => {
    assertEquals(utils.split(" foo    bar\n baz  "), ["foo", "bar", "baz"]);
  });

  await t.step("with separator, returns substrings between them", () => {
    // Python-style split: leading/trailing separators produce empty strings.
    assertEquals(utils.split(",foo, bar,, baz ", ","), [
      "",
      "foo",
      " bar",
      "",
      " baz ",
    ]);
  });
});
