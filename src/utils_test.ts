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
 *   several values maps to a TS function returning an array of those values
 *   (used by `try`).
 * - Lua 1-based array indices are preserved where the API exposes them
 *   (`ripairs` yields indices 1..#array, so the expected pairs here are
 *   [[3, 7], [2, 6], [1, 5]]).
 * - Lua pattern strings (`"bar:%s*"`, `"%S+"`) are passed through unchanged
 *   where the API is pattern-based; the port supplies the Lua-pattern
 *   matcher.
 * - `class()` maps to a callable constructor: instances are created with
 *   `cl()` (no `new`), matching Lua's call syntax. `assert.is_table(cl)` in
 *   the spec becomes `assert(typeof cl === "function")`.
 * - `utils.class` is accessed as a property (not imported by name) because
 *   `class` is a reserved word in TS; the port must export it as a named
 *   export aliased from a non-reserved local name.
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

import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import * as utils from "./utils.ts";

/**
 * Error wrapper produced by `utils.try` on failure (Lua `ErrorWrapper`).
 */
interface ErrorWrapper {
  err: unknown;
  traceback: string;
}

/**
 * A `class()` result: a callable constructor (Lua callable table).
 */
type Class =
  & ((...args: unknown[]) => Record<string, unknown>)
  & Record<string, unknown>;

// read_file / load / load_config are intentionally not ported: they are
// filesystem and dynamic-code-loading helpers used only by the CLI's
// .luacheckrc config loading. Excluded per .reference/PORT_NOTES.md §4 (no
// `io` in a browser library). See PLAN.md Phase 3 decisions.

Deno.test("array_to_set", async (t) => {
  await t.step("converts array to set and returns it", () => {
    assertEquals(utils.arrayToSet(["foo", "bar", "foo"]), { foo: 3, bar: 2 });
  });
});

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

Deno.test("class", async (t) => {
  await t.step("returns an object creator", () => {
    const cl = utils.class() as Class;
    cl.field = "foo";
    const obj = cl();
    assertEquals(typeof obj, "object");
    obj.field2 = "bar";
    assertEquals(obj.field, "foo");
    assertEquals(cl.field2, undefined);
  });

  await t.step("calls __init on object creation", () => {
    const initCalls: unknown[][] = [];
    const cl = utils.class() as Class;
    cl.__init = (...args: unknown[]) => {
      initCalls.push(args);
    };
    const obj = cl("foo", "bar");
    assertEquals(initCalls.length, 1);
    assertEquals(initCalls[0], [obj, "foo", "bar"]);
  });
});

Deno.test("Stack", async (t) => {
  await t.step("supports push/pop operations and top/size fields", () => {
    const stack = utils.Stack();
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

Deno.test("try", async (t) => {
  await t.step("returns true, original return values on success", () => {
    // Lua multi-return `function(x, y) return x*2, y*2 end` maps to a JS
    // function returning an array; `try` returns [ok, ...f's values].
    const [ok, ret1, ret2] = utils.try(
      (x: number, y: number) => [x * 2, y * 2],
      1,
      2,
    ) as [
      boolean,
      number,
      number,
    ];
    assertEquals(ok, true);
    assertEquals(ret1, 2);
    assertEquals(ret2, 4);
  });

  await t.step("returns false, error wrapper on error", () => {
    // Lua `error("foo", 0)` raises the exact string value; `throw "foo"` is
    // the direct TS equivalent, and the wrapper's `err` field keeps it.
    const [ok, res] = utils.try(() => {
      throw "foo";
    }) as [boolean, ErrorWrapper];
    assertEquals(ok, false);
    assertEquals(res.err, "foo");
    assert(typeof res.traceback === "string");
  });

  await t.step("does not wrap already wrapped errors", () => {
    let origTraceback: string | undefined;
    const [ok, res] = utils.try(() => {
      const [, origRes] = utils.try(() => {
        throw "foo";
      }) as [boolean, ErrorWrapper];
      origTraceback = origRes.traceback;
      throw origRes;
    }) as [boolean, ErrorWrapper];
    assertEquals(ok, false);
    assertEquals(res.err, "foo");
    assert(typeof res.traceback === "string");
    assertEquals(res.traceback, origTraceback);
  });
});

Deno.test("ripairs", async (t) => {
  await t.step("returns reversed ipairs", () => {
    // Lua `{foo = "bar", 5, 6, 7}`: an array part [5, 6, 7] (indices 1..3)
    // plus a non-array key. ripairs iterates only indices 1..#array, so the
    // named key never appears in the output.
    const arr: number[] & { foo?: string } = [5, 6, 7];
    arr.foo = "bar";

    const iterated: unknown[] = [];
    for (const [i, v] of utils.ripairs(arr)) {
      iterated.push([i, v]);
    }

    // Indices are 1-based, as in Lua.
    assertEquals(iterated, [[3, 7], [2, 6], [1, 5]]);
  });
});

Deno.test("sorted_pairs", async (t) => {
  await t.step("returns sorted pairs", () => {
    const t = { foo: 1, bar: 3, baz: 5, zero: 0, something: "nothing" };
    const iterated: unknown[] = [];
    for (const [k, v] of utils.sortedPairs(t)) {
      iterated.push([k, v]);
    }
    assertEquals(iterated, [
      ["bar", 3],
      ["baz", 5],
      ["foo", 1],
      ["something", "nothing"],
      ["zero", 0],
    ]);
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

Deno.test("map", async (t) => {
  await t.step("maps function over an array", () => {
    // Arg order matches the Lua API: function first, array second.
    assertEquals(utils.map(Math.sqrt, [9, 1, 4]), [3, 1, 2]);
  });
});
