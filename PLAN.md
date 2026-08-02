# luacheck-ts

Port [luacheck](https://github.com/lunarmodules/luacheck) (Lua 5.4 static analyzer/linter) to
TypeScript for browser use. Approach: mechanical Lua→JS transpile pass over luacheck's own
source, then hand type-annotation/cleanup, preserving upstream analysis behavior 1:1.

## Decisions

- **Target:** browser-bundled library. Bundle size is the metric to optimize (no hard number
  budget — track and report, don't gate on a ceiling).
- **Lua version scope:** Lua 5.4 syntax/semantics only. No 5.1/5.2/5.3/LuaJIT compat branches.
- **Warning categories:** all of them — 0xx (syntax/inline directives), 1xx (globals), 2xx/3xx
  (unused vars/values), 4xx (redefinition/shadowing), 5xx (control/data flow), 6xx
  (formatting/whitespace).
- **Std/globals:** ship only the `lua54` preset. Drop busted/love/ngx/min/max presets and the
  `+`/`-` combine syntax. `globals`/`read_globals` custom overrides remain in the API.
- **Parser:** port luacheck's own hand-rolled `parser.lua` (not swap in a third-party JS Lua
  parser), so the rest of the pipeline's AST assumptions stay valid.
- **Port strategy:** direct mechanical port. Transpile `parser.lua`, `check.lua`, `stages/*.lua`
  via a Lua→JS porter tool, then hand-clean/type-annotate into TS. No from-scratch rewrite, no
  composing third-party Lua-analysis libs.
- **Source version:** luacheck 1.2.0 (latest tagged release), pinned as the porting reference
  and diff target.
- **Tests:** port luacheck's own busted specs, translated to run under Deno's test runner, as
  the correctness oracle.
- **Public API:** mirrors luacheck's Lua API 1:1 — same option names (`globals`, `read_globals`,
  `std`, `unused_secondaries`, `max_line_length`, etc.), same warning data. Warning objects are
  a discriminated union keyed by numeric code (each code's type carries exactly its own fields).
- **Package:** `luacheck-ts`, MIT license. JSR scope TBD at actual publish time.
- **Toolchain:** Deno (`deno.json`, `deno test`, `deno lint`, `deno fmt`). Browser build via
  `deno bundle` (stdout). ESM only, ES2020+ target. Publish to JSR.

## Phase 0 — Project scaffolding

**Status:** in_progress

- [ ] Ticket 0.1: Init Deno project — `deno.json` with tasks for build/test/lint/fmt, empty
      `src/mod.ts` entry point, `.gitignore`.
  - Eval: `deno test` runs (0 tests, green); `deno bundle src/mod.ts` succeeds and prints valid
    JS to stdout; `deno lint` and `deno fmt --check` pass on the scaffold.

## Phase 1 — Research & survey

**Status:** pending

- [ ] Ticket 1.1: Vendor luacheck 1.2.0 source (`parser.lua`, `check.lua`, `stages/*`,
      `utils.lua`, `stds.lua`, etc.) into `reference/` (porting reference only, not shipped in
      the package). Produce a short port-order manifest documenting file dependencies.
- [ ] Ticket 1.2: Trial 1–2 Lua→JS porter tools (e.g. lua2js, lua_to_js) against `parser.lua`
      and one stage module. Note which handles luacheck's real constructs (goto/labels,
      metatable-based OOP, varargs, multiple returns) well enough to be worth using, or confirm
      manual porting is the way.
  - Eval: `reference/PORT_NOTES.md` exists with the manifest + porter recommendation. No
    shipped `src/` code yet.

## Phase 2 — Port the parser

**Status:** pending

- [ ] Ticket 2.1: Port `parser.lua` (+ lexer) to TS, typed, preserving AST shape 1:1, including
      Lua 5.4-specific syntax (integer/float literal distinction, `<const>`/`<close>`
      attributes, bitwise operators, floor division `//`, goto/labels).
  - Eval: ported busted parser-specs (translated to Deno tests) pass against the TS parser.

## Phase 3 — utils / stds / Lua 5.4 globals *(sketch — ticket after Phase 1 lands)*

**Status:** pending

Depends on Phase 1's survey for the exact file list and dependency order.

## Phase 4 — check.lua + stages (analysis engine) *(sketch — ticket after Phase 1 lands)*

**Status:** pending

Likely one ticket per discovered stage module (unused-value tracking, shadowing, reachability,
etc. are each substantial enough to be their own checkpoint). Depends on Phase 1's survey.

## Phase 5 — Options/config surface *(sketch)*

**Status:** pending

`globals`, `read_globals`, `std=lua54`, `unused_secondaries`, `max_line_length` and friends,
matching upstream option names 1:1.

## Phase 6 — Port remaining busted specs *(sketch)*

**Status:** pending

## Phase 7 — Public API polish + bundle-size measurement *(sketch)*

**Status:** pending

Eval: report gzipped bundle size after `deno bundle`; no hard ceiling, tracked only.

## Human review queue

*(empty for now)*

## Benchmarking

| Metric | Count / Value | Notes |
|---|---|---|
| Verification catch rate | 0 / 0 | independent checks that caught a real discrepancy, vs. total checks performed |
| Escaped defect rate | 0 / 0 | bugs/regressions found after a ticket was marked done, vs. tickets closed |
| Rework/reopen rate | 0 / 0 | tickets reopened/rescoped after grilling had already settled them, vs. tickets grilled |
| Rough cost | — | approximate turns/tokens spent on grilling + planning + dispatch + review per ticket, vs. a rough estimate of direct-implementation cost |
