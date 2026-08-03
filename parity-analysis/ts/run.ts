// Runs the TypeScript port of luacheck over Lua source files and prints a
// JSON report.
//
// This script is the TypeScript-side counterpart to
// parity-analysis/lua/json_formatter.lua. Both tools print the same JSON
// shape, so ticket 6.5.3 can compare their output.
//
// Pass one or more Lua file paths as arguments, in the order you want them
// reported. The report is a JSON array with one entry per file. Each entry
// holds the file path and its warning list. Warnings keep the order the
// port returns them in. The script fails if a file path cannot be read.
//
// Invoke it from the repo root, for example:
//
//   deno run --allow-read=parity-analysis/corpus \
//     parity-analysis/ts/run.ts parity-analysis/corpus/middleclass.lua
//
// Pass no file arguments to print an empty JSON array.

import { checkStrings, getMessage } from "../../src/mod.ts";

const contents: string[] = [];

for (const path of Deno.args) {
  contents.push(await Deno.readTextFile(path));
}

const [reports] = checkStrings(contents, { std: "lua54" });

const entries = reports.map((warnings, i) => ({
  filename: Deno.args[i],
  warnings: warnings.map((warning) => ({
    code: warning.code,
    line: warning.line,
    column: warning.column,
    message: getMessage(warning),
  })),
}));

console.log(JSON.stringify(entries));
