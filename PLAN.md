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
- **Library use:** prefer well-maintained JSR (`jsr:@std/...`) or npm packages over hand-rolled
  utilities where there is a clear net win (nontrivial logic, meaningfully reduces bug surface),
  added via `deno add`. Do not add a dependency for a trivial one-liner, and weigh bundle size
  against convenience (browser target). Checked and confirmed no suitable Lua-pattern-matching
  library exists on npm or JSR (only full Lua VMs, too heavy) — that piece is hand-written
  (`src/lua_pattern.ts`), a from-scratch port of Lua 5.4's pattern-matching algorithm.
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

- [x] Ticket 2.1: Port `utils.lua`, `unicode_printability_boundaries.lua`, `unicode.lua` to TS
      (`src/utils.ts`, `src/unicode.ts`) plus a new `src/lua_pattern.ts` (hand-written Lua
      pattern matcher, needed by `after`/`strip`/`split` and every later file that uses Lua
      patterns). `read_file`/`load`/`load_config` dropped (CLI-only, out of scope); their
      spec cases removed from the ported test file. `unprefix`, `pmatch`,
      `InvalidPatternError`, and the `has_type*`/`array_of` validators deferred to ticket 3.3
      (options.lua), the first file that needs them.
  - Eval: ported `utils_spec.lua` (224 lines, minus the dropped I/O cases) passes under
    `deno test` — 12 tests/17 steps green. No dedicated upstream spec for `unicode.lua`;
    `isPrintable` verified directly against a real Lua 5.4 interpreter (`lua -e`) across the
    boundary codepoints instead, exact match, and will also be exercised indirectly via
    decoder tests in 2.2. Whole-project `deno test`/`deno lint`/`deno fmt --check` clean.
  - Note: the `coder` subagent returned empty (no files, no report) on three consecutive
    dispatch attempts for this ticket's implementation half; test-writing dispatch had
    worked fine earlier. Implemented directly in the primary session instead of continuing
    to retry.
- [x] Ticket 2.2: Port `lexer.lua`, `decoder.lua` to TS (`src/lexer.ts`, `src/decoder.ts`).
      Kept 1-based Lua indexing throughout (`Chars`, `LexerState` offsets) rather than
      re-deriving 0-based equivalents, per the port-strategy decision. `decoder.ts`'s raw-byte
      `find` reuses `lua_pattern.ts` directly by treating source bytes as a JS "binary string"
      (one UTF-16 code unit per byte) instead of writing a second byte-array pattern matcher.
      Refactored `lua_pattern.ts`'s capture handling so `LuaFindResult.captures` is empty when
      the pattern has no explicit `(...)` groups (needed for `decoder.find`'s Lua-`string.find`-
      accurate return arity); re-verified `utils_test.ts` still green after that change. Added
      `src/testdata/argparse-0.2.0.lua` (real-world fixture from luacheck's own spec/samples,
      973 lines) for the lexer's stress-test case.
  - Eval: ported `lexer_spec.lua` (450 lines, 38 steps) and `decoder_spec.lua` (92 lines,
    2 steps incl. the argparse fixture) pass under `deno test`. `isPrintable` cross-checked
    directly against real Lua 5.4 earlier; `decoder_test.ts`'s UTF-8 fixtures are built with
    the platform's own `TextEncoder` as an independent oracle, not decoder.ts's own algorithm
    (surrogate-range codepoints skipped — Lua round-trips them, `TextEncoder` replaces them
    with U+FFFD, an artifact of JS's stricter string model unrelated to decoder.ts's
    correctness). Whole-project `deno test` (14 tests/58 steps), `deno lint`, `deno fmt
    --check`, `deno task build` all clean.
  - Note: continued implementing directly rather than re-attempting `coder` dispatch, per the
    same tooling issue noted in ticket 2.1.
- [x] Ticket 2.3: Port `parser.lua` to TS (`src/parser.ts`). Lua 5.4 recursive-descent parser
      → AST with range info, `SyntaxError` class, including `<const>`/`<close>` attributes,
      bitwise operators, floor division `//`, `goto`/labels as AST data. `goto`/`::label::`
      ported as plain `Goto`/`Label` AST node data only, no JS control-flow emulation, per the
      port-notes finding that luacheck's own source never executes `goto` as a statement.
      `SyntaxError` built with `utils.class()`, matching the existing class pattern, not a
      bare `class extends Error`. AST array-parts ported as objects with string-numeral keys
      (`node["1"]`, `node["2"]`, ...) instead of real JS arrays, to keep 1-based indexing
      throughout without an error-prone shift; small helpers (`astPush`/`astLen`/`astLast`/
      `astInsertAt`) stand in for Lua's `t[#t+1]=x`/`#t` idiom. `parser.parse` actually returns
      7 values in the real source (`ast, comments, code_lines, line_endings,
      hanging_semicolons, lexer.line_offsets, lexer.line_lengths`), not the 5 this ticket
      originally assumed — returned as a named `ParseResult` interface rather than forcing
      `lexer.ts`'s positional-tuple precedent, since the values are heterogeneous and this
      runs once per parse rather than in `nextToken`'s hot loop. Reuses `utils.ts`'s `Stack`
      (for the unpaired-token guesser) rather than a local duplicate.
  - Eval: ported `parser_spec.lua` (1540 Lua lines → 2503 TS test lines) passes under
    `deno test` — 1 test/61 steps green on its own; whole-project `deno test` (15 tests/119
    steps), `deno lint`, `deno fmt --check`, `deno check` all clean. A real bug was caught by
    the test suite (not by inspection): `atom()` unconditionally assigned
    `astNode["1"] = state.tokenValue` for `Number`/`String`/`Nil`/`True`/`False`/`Dots` nodes;
    for keyword tokens (`true`/`false`/`nil`) `tokenValue` is `undefined`, and Lua's
    assign-`nil`-is-a-no-op table semantics differ from JS, where `obj[k] = undefined` still
    creates an own property. Fixed with the same `!== undefined` guard already used in the
    `arr()` helper. Nothing was skipped; the full grammar and full spec were ported.
  - Note: dispatched to a `build` subagent (not `coder`, which had 3 consecutive empty runs in
    tickets 2.1/2.2) with a detailed brief covering project conventions, style rules, and
    required verification steps. It completed in one pass. Independently re-verified in the
    primary session before treating the ticket as done: reran `deno test`/`lint`/`fmt --check`/
    `check` myself, confirmed line counts and `git status` matched the subagent's report
    exactly, and spot-checked the `SyntaxError`/`Stack`/`atom()` claims directly in the source.

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
| Verification catch rate | 1 / 3 | Phase 0: caught unscoped JSR name + esbuild-instead-of-deno-bundle. Ticket 2.1: cross-checked `isPrintable` against a real Lua 5.4 interpreter, no discrepancy found. Ticket 2.3: independently reran `deno test`/`lint`/`fmt --check`/`check` and spot-checked the `build` subagent's report claims against the actual source after it reported done, all claims matched, no discrepancy found |
| Escaped defect rate | 0 / 0 | bugs/regressions found after a ticket was marked done, vs. tickets closed |
| Rework/reopen rate | 0 / 0 | tickets reopened/rescoped after grilling had already settled them, vs. tickets grilled |
| Rough cost | — | approximate turns/tokens spent on grilling + planning + dispatch + review per ticket, vs. a rough estimate of direct-implementation cost |
