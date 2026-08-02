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
- **Std/globals:** ship only the `lua54` preset. Drop busted/love/ngx/min/max/minetest/playdate
  presets. Note: 1.2.0 only has the additive `+` std-combine form, no `-` form exists to drop.
  `globals`/`read_globals` custom overrides remain in the API. Std data lives in
  `standards.lua` (not `stds.lua` as earlier phrased).
- **Parser:** port luacheck's own hand-rolled `parser.lua` (not swap in a third-party JS Lua
  parser), so the rest of the pipeline's AST assumptions stay valid.
- **Port strategy:** hand port, mechanical line-by-line transliteration. Phase 1 trialed two
  Lua→JS transpilers (basicer/lua2js, thenumbernine/lua_to_js) against the real vendored
  source; neither survives contact with it (see `.reference/PORT_NOTES.md` §6) — lua2js
  cannot parse luacheck's own field names (keyword-prefix grammar bug) and has no Lua pattern
  matching; lua_to_js parses but its codegen crashes on metatable classes, varargs, and
  multiple returns, the exact constructs the pipeline is built on. No transpiler is used. Each
  file is ported by hand, then verified against its ported busted spec.
- **Source version:** luacheck 1.2.0 (latest tagged release), pinned as the porting reference
  and diff target.
- **Tests:** port luacheck's own busted specs, translated to run under Deno's test runner, as
  the correctness oracle.
- **Public API:** mirrors luacheck's Lua API 1:1 — same option names (`globals`, `read_globals`,
  `std`, `unused_secondaries`, `max_line_length`, etc.), same warning data. Warning objects are
  a discriminated union keyed by numeric code (each code's type carries exactly its own fields).
- **Package:** `@xyzshantaram/luacheck-ts`, MIT license, published to JSR under that scope.
- **Toolchain:** Deno (`deno.json`, `deno test`, `deno lint`, `deno fmt`). Browser build via
  `deno bundle --platform=browser --minify` (Deno 2.8 experimental bundler, confirmed working).
  ESM only, ES2020+ target. Publish to JSR.

## Phase 0 — Project scaffolding

**Status:** done

Scaffolded `deno.json` (build/test/lint/fmt tasks, strict TS, ES2020+DOM lib), `src/mod.ts`
placeholder entry point, `src/mod_test.ts` placeholder test, MIT `LICENSE`, `.gitignore`
(ignores `dist/`, `.reference/`, Node/OS junk). Fixed two discrepancies found on verification:
package name wasn't JSR-scoped, and the `build` task used `npm:esbuild` instead of `deno bundle`
— both corrected. Verified directly: `deno test` (0 passed/0 failed), `deno lint` and
`deno fmt --check` clean, `deno task build` produces a working minified ESM bundle at
`dist/luacheck-ts.bundle.js`.

## Phase 1 — Research & survey

**Status:** done

Vendored luacheck 1.2.0 (`v1.2.0`, commit `cc089e3f`) into `.reference/luacheck/`
(git-ignored). Full manifest, dependency tiers, exclusion list, and porter trial writeup in
`.reference/PORT_NOTES.md`. Verified independently: vendored commit hash matches upstream,
`standards.lua` naming confirmed, and confirmed via grep that luacheck's own source never uses
`goto` as a statement (only tokenizes/parses it as data for the Lua being linted). Key outcome:
no transpiler survives contact with the real source — hand-porting it is, see Decisions above.
~6,700 in-scope Lua lines across 27 files/dirs; real port order and per-file spec files now
known and used to scope Phases 2+ below.

## Phase 2 — Lexing & parsing

**Status:** in_progress

- [ ] Ticket 2.1: Port `utils.lua`, `unicode_printability_boundaries.lua`, `unicode.lua` to TS
      (`src/utils.ts`, `src/unicode.ts`). Covers: `class()` helper → JS class/prototype
      mapping, `Stack`, `try`/pack (multi-return emulation), array/set helpers,
      string split/strip, `is_printable`.
  - Eval: ported `utils_spec.lua` (224 lines) passes under `deno test`. No dedicated upstream
    spec for `unicode.lua`; its correctness is exercised indirectly via decoder tests in 2.2.
- [ ] Ticket 2.2: Port `lexer.lua`, `decoder.lua` to TS (`src/lexer.ts`, `src/decoder.ts`).
      Covers: Lua 5.4 tokenizer (number forms incl. integer/float distinction, string
      escapes, comments), UTF-8/latin1 source decode into `Chars` objects.
  - Eval: ported `lexer_spec.lua` (450 lines) and `decoder_spec.lua` (92 lines) pass under
    `deno test`.
- [ ] Ticket 2.3: Port `parser.lua` to TS (`src/parser.ts`). Lua 5.4 recursive-descent parser
      → AST with range info, `SyntaxError` class, including `<const>`/`<close>` attributes,
      bitwise operators, floor division `//`, `goto`/labels as AST data.
  - Eval: ported `parser_spec.lua` (1540 lines) passes under `deno test`.

Lua pattern matching (`string.find/match/gsub/format`) is used throughout this phase's files
and has no JS equivalent — ticket 2.1 must also produce a small Lua-pattern-compatible helper
(or equivalent per-call-site translations) that 2.2/2.3 depend on.

## Phase 3 — Std data & check infrastructure

**Status:** pending

- [ ] Ticket 3.1: Port `standards.lua` + the `lua54`/`lua54c` slice of
      `builtin_standards/init.lua` to TS. Drop all other `lua_defs`, `min`, `max`, `busted`,
      `rockspec`, `luacheckrc`, `ldoc`, `sile`, `ngx_lua`, `luajit` data per the std-scope
      decision.
  - Eval: ported `standards_spec.lua` passes under `deno test` (scoped to lua54-relevant
    cases; note any cases dropped because they test excluded presets).
- [ ] Ticket 3.2: Port `check_state.lua` + `core_utils.lua` to TS. Warning emission
      (`warn`/`warn_range`/`warn_var`), `eval_const_node`, `each_statement`,
      `sort_by_location`.
  - Eval: no dedicated upstream spec for either file; exercised indirectly once `check.lua`
    lands in Phase 5. Manual smoke check now: a hand-written small Lua snippet round-trips
    through parser → check_state warn calls without throwing.
- [ ] Ticket 3.3: Port `options.lua` (trimmed: no `compat`/`max` path, no CLI-only options) to
      TS. Option validation + normalization into the std tree, rule set, line-length options.
  - Eval: ported `options_spec.lua` passes under `deno test`, scoped to lua54/kept-option
    cases.

## Phase 4 — Stages (analysis engine)

**Status:** pending

18 stage modules + the `stages/init.lua` registry, grouped by theme into tickets once we reach
this phase (AST-prep stages: parse/unwrap_parens/linearize/parse_inline_options/
name_functions/resolve_locals; structural detect_* stages; dataflow detect_* stages;
registry last). Each stage has its own busted spec file already identified in
`.reference/PORT_NOTES.md`. Exact ticket boundaries to be finalized when Phase 3 lands.

## Phase 5 — check.lua + filter.lua + init.lua (compose + public API)

**Status:** pending

Composes everything above into `check(source)` and the public `get_report`/`check_strings`
API. Depends on Phase 4.

## Phase 6 — Remaining integration specs

**Status:** pending

Top-level/integration busted specs not already covered per-module (`check_spec.lua`,
`filter_spec.lua`, `globals_spec.lua`, `luacheck_spec.lua`), ported last as an end-to-end
correctness pass.

## Phase 7 — Public API polish + bundle-size measurement

**Status:** pending

Finalize the discriminated-union warning types, `@xyzshantaram/luacheck-ts` JSR publish
config, README. Eval: report gzipped bundle size after `deno task build`; no hard ceiling,
tracked only.

## Human review queue

*(empty for now)*

## Benchmarking

| Metric | Count / Value | Notes |
|---|---|---|
| Verification catch rate | 1 / 1 | Phase 0 review caught unscoped JSR name + esbuild-instead-of-deno-bundle before marking done |
| Escaped defect rate | 0 / 0 | bugs/regressions found after a ticket was marked done, vs. tickets closed |
| Rework/reopen rate | 0 / 0 | tickets reopened/rescoped after grilling had already settled them, vs. tickets grilled |
| Rough cost | — | approximate turns/tokens spent on grilling + planning + dispatch + review per ticket, vs. a rough estimate of direct-implementation cost |
