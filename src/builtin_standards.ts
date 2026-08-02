/**
 * Ported from luacheck's builtin_standards/init.lua, trimmed to only what
 * the `lua54`/`lua54c` presets need (see PLAN.md / .reference/PORT_NOTES.md:
 * this project ships only the `lua54` std preset). Traced the real
 * dependency chain instead of guessing:
 *
 *   lua54c = addDefs(lua54, {...})
 *   lua54  = addDefs(lua53, {...})
 *   lua53  = addDefs(makeMinDef("lua53"), {...})
 *   makeMinDef(name) reads stringDefs[name] and fileDefs[name]
 *   stringDefs.lua53 = addDefs(stringDefs.min, defFields(...))
 *   fileDefs.lua53   = addDefs(fileDefs.min, {fields: {__name: stringDefs.lua53}})
 *
 * Every other named preset (`min`, `max`, `lua51`/`lua51c`/`lua52`/`lua52c`/
 * `lua53c`, `luajit`, `ngx_lua`), the `love`/`ngx`/`minetest`/`playdate`/
 * `busted`/`rockspec`/`luacheckrc`/`ldoc`/`sile` presets, `bit32_def` (only
 * used by lua52/lua53c/luajit), and `get_running_lua_std_name` (inspects the
 * running Lua interpreter, meaningless in a browser port) are out of scope
 * and dropped. `string_defs`/`file_defs` keep only the `min`/`lua53` entries
 * `makeMinDef` actually looks up, instead of the full multi-version map.
 */

import {
  addStdTable,
  defFields,
  type FieldDef,
  type StdTable,
} from "./standards.ts";

function defToStd(def: FieldDef): StdTable {
  return { read_globals: def.fields };
}

function addDefs(...defs: FieldDef[]): FieldDef {
  const res: FieldDef = {};

  for (const def of defs) {
    addStdTable(res, defToStd(def));
  }

  return res;
}

const empty: FieldDef = {};

type MethodDefsName = "min" | "lua53";

const stringDefs = {} as Record<MethodDefsName, FieldDef>;

stringDefs.min = defFields(
  "byte",
  "char",
  "dump",
  "find",
  "format",
  "gmatch",
  "gsub",
  "len",
  "lower",
  "match",
  "rep",
  "reverse",
  "sub",
  "upper",
);

stringDefs.lua53 = addDefs(
  stringDefs.min,
  defFields("pack", "packsize", "unpack"),
);

const fileDefs = {} as Record<MethodDefsName, FieldDef>;

fileDefs.min = {
  fields: {
    __gc: empty,
    __index: { other_fields: true },
    __tostring: empty,
    close: empty,
    flush: empty,
    lines: empty,
    read: empty,
    seek: empty,
    setvbuf: empty,
    write: empty,
  },
};

fileDefs.lua53 = addDefs(fileDefs.min, {
  fields: { __name: stringDefs.lua53 },
});

function makeMinDef(methodDefs: MethodDefsName): FieldDef {
  const stringDef = stringDefs[methodDefs];
  const fileDef = fileDefs[methodDefs];

  return {
    fields: {
      _G: { other_fields: true, read_only: false },
      _VERSION: stringDef,
      arg: { other_fields: true },
      assert: empty,
      collectgarbage: empty,
      coroutine: defFields(
        "create",
        "resume",
        "running",
        "status",
        "wrap",
        "yield",
      ),
      debug: defFields(
        "debug",
        "gethook",
        "getinfo",
        "getlocal",
        "getmetatable",
        "getregistry",
        "getupvalue",
        "sethook",
        "setlocal",
        "setmetatable",
        "setupvalue",
        "traceback",
      ),
      dofile: empty,
      error: empty,
      getmetatable: empty,
      io: {
        fields: {
          close: empty,
          flush: empty,
          input: empty,
          lines: empty,
          open: empty,
          output: empty,
          popen: empty,
          read: empty,
          stderr: fileDef,
          stdin: fileDef,
          stdout: fileDef,
          tmpfile: empty,
          type: empty,
          write: empty,
        },
      },
      ipairs: empty,
      load: empty,
      loadfile: empty,
      math: defFields(
        "abs",
        "acos",
        "asin",
        "atan",
        "ceil",
        "cos",
        "deg",
        "exp",
        "floor",
        "fmod",
        "huge",
        "log",
        "max",
        "min",
        "modf",
        "pi",
        "rad",
        "random",
        "randomseed",
        "sin",
        "sqrt",
        "tan",
      ),
      next: empty,
      os: defFields(
        "clock",
        "date",
        "difftime",
        "execute",
        "exit",
        "getenv",
        "remove",
        "rename",
        "setlocale",
        "time",
        "tmpname",
      ),
      package: {
        fields: {
          config: stringDef,
          cpath: { fields: stringDef.fields, read_only: false },
          loaded: { other_fields: true, read_only: false },
          loadlib: empty,
          path: { fields: stringDef.fields, read_only: false },
          preload: { other_fields: true, read_only: false },
        },
      },
      pairs: empty,
      pcall: empty,
      print: empty,
      rawequal: empty,
      rawget: empty,
      rawset: empty,
      require: empty,
      select: empty,
      setmetatable: empty,
      string: stringDef,
      table: defFields("concat", "insert", "remove", "sort"),
      tonumber: empty,
      tostring: empty,
      type: empty,
      xpcall: empty,
    },
  };
}

const luaDefs = {} as Record<"lua53" | "lua54" | "lua54c", FieldDef>;

luaDefs.lua53 = addDefs(makeMinDef("lua53"), {
  fields: {
    _ENV: { other_fields: true, read_only: false },
    coroutine: defFields("isyieldable"),
    debug: defFields(
      "getuservalue",
      "setuservalue",
      "upvalueid",
      "upvaluejoin",
    ),
    math: defFields("maxinteger", "mininteger", "tointeger", "type", "ult"),
    package: {
      fields: {
        searchers: { other_fields: true, read_only: false },
        searchpath: empty,
      },
    },
    rawlen: empty,
    table: defFields("move", "pack", "unpack"),
    utf8: {
      fields: {
        char: empty,
        charpattern: stringDefs.lua53,
        codepoint: empty,
        codes: empty,
        len: empty,
        offset: empty,
      },
    },
  },
});

luaDefs.lua54 = addDefs(luaDefs.lua53, {
  fields: {
    warn: empty,
    debug: defFields("setcstacklimit"),
    coroutine: defFields("close"),
  },
});

luaDefs.lua54c = addDefs(luaDefs.lua54, {
  fields: {
    math: defFields(
      "atan2",
      "cosh",
      "frexp",
      "ldexp",
      "log10",
      "pow",
      "sinh",
      "tanh",
    ),
  },
});

export const builtinStandards: Record<"lua54" | "lua54c", StdTable> = {
  lua54: defToStd(luaDefs.lua54),
  lua54c: defToStd(luaDefs.lua54c),
};
