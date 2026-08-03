# luacheck-ts

A TypeScript port of [luacheck](https://github.com/mpeterv/luacheck), the Lua static analyzer. It finds unused variables, undefined globals, and other common mistakes in Lua 5.4 source code. It runs in the browser, in Deno, and in Node.

## Install

```
deno add jsr:@xyzshantaram/luacheck-ts
```

For Node or Bun, use the `jsr` CLI:

```
npx jsr add @xyzshantaram/luacheck-ts
```

## Usage

```ts
import { checkStrings, getMessage } from "@xyzshantaram/luacheck-ts";

const source = `
local x = 1
print(y)
`;

const [reports, counts] = checkStrings([source], { std: "lua54" });

for (const warning of reports[0]) {
  console.log(getMessage(warning));
}

console.log(counts);
// { warnings: 2, errors: 0, fatals: 0 }
```

`checkStrings` takes an array of source strings and an optional options object. It returns a tuple of per-file warning arrays and a total count. `getMessage` turns a warning object into the same human-readable text that the upstream `luacheck` CLI prints.

See the [JSR page](https://jsr.io/@xyzshantaram/luacheck-ts) for the full API reference, including all exported functions and types.

## Scope

This package ports luacheck's check engine only. It does not port the `luacheck` command-line tool. Read the differences below before you use it.

- **No CLI.** This package is a library. Call its functions from your own code.
- **No file I/O.** `checkStrings` takes source strings, not file paths. Read files with your own code first.
- **No config file support.** This package does not load `.luacheckrc` files, detect rockspecs, or cache results.
- **Limited `std` presets.** The `std` option accepts only the `lua54` and `lua54c` presets. Upstream's other Lua version presets and standard library lists are not ported.

## License

MIT. See [LICENSE](./LICENSE).
