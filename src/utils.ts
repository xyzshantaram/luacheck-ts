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

export function arrayToSet(array: string[]): Record<string, number> {
  const set: Record<string, number> = {};
  array.forEach((value, index) => {
    set[value] = index + 1;
  });
  return set;
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

/** The non-callable part of a `class()` result: its methods/fields. */
export interface LuaClass extends Record<string, unknown> {
  __init?: (obj: Record<string, unknown>, ...args: unknown[]) => unknown;
}

/** A `class()` result: a callable constructor carrying its own methods/fields. */
type LuaConstructor<T extends Record<string, unknown>> =
  & LuaClass
  & ((...args: unknown[]) => T);

function classImpl<
  T extends Record<string, unknown> = Record<string, unknown>,
>(): LuaConstructor<T> {
  const cl = function (...args: unknown[]) {
    const obj = Object.create(cl) as T;
    if (typeof (cl as LuaClass).__init === "function") {
      const initReturn = (cl as LuaClass).__init!(obj, ...args);
      if (initReturn !== undefined) return initReturn;
    }
    return obj;
  } as LuaConstructor<T>;
  return cl;
}
export { classImpl as class };

function isInstance(object: unknown, cl: LuaClass): boolean {
  return typeof object === "object" && object !== null &&
    Object.getPrototypeOf(object) === cl;
}

interface LuaStackInstance extends Record<string, unknown> {
  size: number;
  top: unknown;
  push(value: unknown): void;
  pop(): unknown;
  [index: number]: unknown;
}

export const Stack: LuaConstructor<LuaStackInstance> = classImpl<
  LuaStackInstance
>();
Stack.__init = function (obj: Record<string, unknown>) {
  (obj as LuaStackInstance).size = 0;
};
Stack.push = function (this: LuaStackInstance, value: unknown) {
  this.size += 1;
  this[this.size] = value;
  this.top = value;
};
Stack.pop = function (this: LuaStackInstance) {
  const value = this[this.size];
  delete this[this.size];
  this.size -= 1;
  this.top = this[this.size];
  return value;
};

interface ErrorWrapperInstance {
  err: unknown;
  traceback: string;
}

class ErrorWrapperImpl implements ErrorWrapperInstance {
  err: unknown;
  traceback: string;

  constructor(err: unknown, traceback: string) {
    this.err = err;
    this.traceback = traceback;
  }

  toString(): string {
    return `${String(this.err)}\n${this.traceback}`;
  }
}

function errorHandler(err: unknown): ErrorWrapperInstance {
  if (err instanceof ErrorWrapperImpl) return err;
  // `debug.traceback()` has no JS equivalent; a captured stack is the
  // closest available substitute and is only surfaced as an opaque string.
  const traceback = err instanceof Error && err.stack
    ? err.stack
    : new Error().stack ?? "";
  return new ErrorWrapperImpl(err, traceback);
}

/**
 * Like pcall, but wraps errors in an `{err, traceback}` object unless
 * already wrapped. A Lua function returning several values maps here to a
 * TS function returning an array of them; a single non-array return value
 * is passed through as-is.
 */
function tryImpl(
  // deno-lint-ignore no-explicit-any
  f: (...args: any[]) => unknown,
  ...args: unknown[]
): [true, ...unknown[]] | [false, ErrorWrapperInstance] {
  try {
    const result = f(...args);
    if (Array.isArray(result)) return [true, ...result];
    if (result === undefined) return [true];
    return [true, result];
  } catch (err) {
    return [false, errorHandler(err)];
  }
}
export { tryImpl as try };

export function* ripairs<T>(array: readonly T[]): Generator<[number, T]> {
  for (let i = array.length; i >= 1; i--) {
    yield [i, array[i - 1]];
  }
}

export function* sortedPairs<T extends Record<string, unknown>>(
  t: T,
): Generator<[string, T[keyof T]]> {
  for (const key of Object.keys(t).sort()) {
    yield [key, t[key] as T[keyof T]];
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

/** Maps `func` over `array`. */
export function map<T, R>(func: (item: T) => R, array: readonly T[]): R[] {
  return array.map(func);
}

/**
 * Behaves like `string.match`, returning whether `pattern` matches
 * anywhere in `str`. Throws on a malformed pattern, same as Lua's
 * `pcall(string.match, ...)` failing.
 */
export function pmatch(str: string, pattern: string): boolean {
  return luaFind(str, pattern) !== undefined;
}

// Exported for later tickets (options.lua's use of class-based error
// objects and instance checks); not exercised by utils_spec.lua directly.
export { isInstance };
