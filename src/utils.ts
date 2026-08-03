/**
 * Ported from luacheck's utils.lua. `read_file`, `load`, and `load_config`
 * are intentionally not ported: CLI-only filesystem/dynamic-code-loading
 * helpers, out of scope for a browser library (see
 * .reference/PORT_NOTES.md section 4). `unprefix` and `InvalidPatternError`
 * stay out of scope; `has_either_type` is dropped, since nothing in the
 * kept `options.lua` port calls it. `pmatch` is ported for `filter.lua`'s
 * use, but without the `InvalidPatternError` wrapper: nothing in this port
 * catches that error type specially, so a malformed pattern just throws
 * the plain `Error` `lua_pattern.ts` already raises.
 */

import { luaFind, luaGmatch } from "./lua_pattern.ts";

/** Returns the Lua type name of a JS value, following luacheck's own `nil`/`table` conventions. */
export function luaType(value: unknown): string {
  if (value === undefined || value === null) return "nil";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "function") return "function";
  return "table";
}

/** Returns a validator checking that a value has the given Lua type. */
export function hasType(type_: string): (x: unknown) => [boolean, string?] {
  return (x) => {
    if (luaType(x) === type_) {
      return [true];
    }
    return [false, `${type_} expected, got ${luaType(x)}`];
  };
}

/** Returns a validator checking that a value has the given Lua type, or is `false`. */
export function hasTypeOrFalse(
  type_: string,
): (x: unknown) => [boolean, string?] {
  return (x) => {
    if (luaType(x) === type_) {
      return [true];
    }
    if (luaType(x) === "boolean") {
      if (x === true) {
        return [false, `${type_} or false expected, got true`];
      }
      return [true];
    }
    return [false, `${type_} or false expected, got ${luaType(x)}`];
  };
}

/** Returns a validator checking that a value is an array with elements of the given Lua type. */
export function arrayOf(type_: string): (x: unknown) => [boolean, string?] {
  return (x) => {
    if (luaType(x) !== "table") {
      return [false, `array of ${type_}s expected, got ${luaType(x)}`];
    }

    const table = x as Record<string, unknown>;
    for (let i = 1;; i++) {
      const item = table[String(i)];
      if (item === undefined) break;

      if (luaType(item) !== type_) {
        return [
          false,
          `array of ${type_}s expected, got ${luaType(item)} at index [${i}]`,
        ];
      }
    }

    return [true];
  };
}

export function concatArrays<T>(arrays: T[][]): T[] {
  const res: T[] = [];
  for (const sub of arrays) {
    res.push(...sub);
  }
  return res;
}

export function update<
  T extends Record<string, unknown>,
  U extends Record<string, unknown>,
>(
  t1: T,
  t2: U,
): T & U {
  for (const key of Object.keys(t2)) {
    (t1 as Record<string, unknown>)[key] = t2[key];
  }
  return t1 as T & U;
}

interface LuaStackInstance extends Record<string, unknown> {
  size: number;
  top: unknown;
  push(value: unknown): void;
  pop(): unknown;
  [index: number]: unknown;
}

export class Stack implements LuaStackInstance {
  size = 0;
  declare top: unknown;
  [key: string]: unknown;
  [index: number]: unknown;

  push(value: unknown): void {
    this.size += 1;
    this[this.size] = value;
    this.top = value;
  }

  pop(): unknown {
    const value = this[this.size];
    delete this[this.size];
    this.size -= 1;
    this.top = this[this.size];
    return value;
  }
}

/** Returns the substring after the first match of `pattern`, or `undefined` if there is none. */
export function after(str: string, pattern: string): string | undefined {
  const found = luaFind(str, pattern);
  return found ? str.slice(found.end) : undefined;
}

/** Returns `str` with leading/trailing whitespace (`%s`) removed. */
export function strip(str: string): string {
  const leading = luaFind(str, "^%s*")!;
  const trailing = luaFind(str, "%s*$")!;
  return str.slice(leading.end, trailing.start);
}

/**
 * `sep` must be undefined or a single character. Behaves like Python's
 * `str.split`: with a separator, leading/trailing/consecutive separators
 * produce empty strings; without one, splits on runs of non-whitespace.
 */
export function split(str: string, sep?: string): string[] {
  const pattern = sep !== undefined ? `${sep}([^${sep}]*)` : "%S+";
  const source = sep !== undefined ? sep + str : str;

  const parts: string[] = [];
  for (const part of luaGmatch(source, pattern)) {
    parts.push(part as string);
  }
  return parts;
}

/**
 * Behaves like `string.match`, returning whether `pattern` matches
 * anywhere in `str`. Throws on a malformed pattern, same as Lua's
 * `pcall(string.match, ...)` failing.
 */
export function pmatch(str: string, pattern: string): boolean {
  return luaFind(str, pattern) !== undefined;
}
