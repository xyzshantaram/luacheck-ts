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

**Status:** done

- [x] Ticket 3.1: Port `standards.lua` + the `lua54`/`lua54c` slice of
      `builtin_standards/init.lua` to TS (`src/standards.ts`, `src/builtin_standards.ts`).
      Dropped all other `lua_defs`, `min`, `max`, `busted`, `rockspec`, `luacheckrc`, `ldoc`,
      `sile`, `ngx_lua`, `luajit` data per the std-scope decision. Traced the real chain
      backward from `lua54`/`lua54c` (`lua54c = addDefs(lua54, ...)`, `lua54 =
      addDefs(lua53, ...)`, `lua53 = addDefs(makeMinDef("lua53"), ...)`, which reads
      `stringDefs.lua53`/`fileDefs.lua53`), so `def_to_std`, `add_defs`, `make_min_def`, and
      only the `"lua53"`/`"min"`-named entries of `string_defs`/`file_defs` were ported —
      `bit32_def` and every other Lua-version entry those maps held upstream were dropped as
      unreachable from this chain. `get_running_lua_std_name` and the interpreter-inspection
      export dropped (meaningless in a browser port). Snake_case data-format keys (`fields`,
      `read_only`, `other_fields`, `deep_read_only`, `globals`, `read_globals`) kept literal
      per the "public API mirrors luacheck 1:1" decision; only function/variable identifiers
      were camelCased. Lua's array-part-of-a-table-as-field-name-sugar is represented with
      decimal-string object keys (`"0"`, `"1"`, ...), the same convention ticket 2.3 already
      established for AST array-parts, rather than a second convention.
  - Eval: ported `standards_spec.lua` (290 lines) passes under `deno test` — exercises only
    the generic `standards.ts` API (`validateStdTable`/`addStdTable`/`overwriteField`/
    `removeField`/`finalize`/`defFields`), never `builtin_standards.ts`. The `lua54`/`lua54c`
    table content itself has **no spec coverage** from this ticket (a pre-existing gap:
    upstream's own spec suite never tests `builtin_standards/init.lua`'s data directly
    either) — sanity-checked once with a throwaway, uncommitted script confirming expected
    keys (`warn`, `math.atan2`, `coroutine.close`, `table.move`, `utf8.codepoint`,
    `string.pack`, `_ENV`) are present and out-of-scope keys (`bit32`, `getfenv`) are absent;
    this will get real exercise once `options.lua` (ticket 3.3) and `check.lua` (Phase 5)
    consume it. Whole-project `deno test` (16 tests/142 steps), `deno lint`, `deno fmt
    --check`, `deno check` all clean.
  - Note: dispatched to a `build` subagent, same as ticket 2.3. Completed in one pass.
    Independently re-verified in the primary session: reran `deno test`/`lint`/`fmt --check`/
    `check` myself, confirmed line counts and `git status` matched the report exactly, and
    spot-checked the `bit32_def`-dropped/`makeMinDef`/`lua54`+`lua54c`-export claims directly
    in the source.
- [x] Ticket 3.2: Port `check_state.lua` + `core_utils.lua` to TS (`src/check_state.ts`,
      166 lines; `src/core_utils.ts`, 193 lines; `src/core_utils_test.ts`, 119 lines, 15 hand-
      written test steps since no upstream spec exists). Warning emission
      (`warn`/`warn_range`/`warn_var`/`warn_value`/`warn_column_range`), `eval_const_node`,
      `each_statement`, `sort_by_location`.
  - Eval: no dedicated upstream spec for either file. `evalConstNode` and `sortByLocation`
    (the two pieces with no un-ported dependency) got hand-written Deno tests instead.
    `eachStatement` and `check_state.ts` stay untested this ticket — both need `chstate.lines`,
    which `stages/linearize.lua` (not yet ported) populates; exercised indirectly once
    `check.lua` lands in Phase 5.
  - Note: `eval_const_node`'s Lua-numeral parsing needs a hand-rolled hex-float path
    (`0x1p4`, `0x1.8p3`), since JS's `Number()` does not parse Lua's `p`/`P` binary-exponent
    hex-float syntax. The `build` subagent caught and reported one real correctness gap in
    its own first draft: the brief said to detect hex floats by a `p`/`P` exponent alone, but
    upstream always appends a bare `.0` to integer-looking numerals before parsing (to force
    float evaluation), so a plain hex integer like `"0x1F"` arrives as `"0x1F.0"` — a radix
    point with no `p` exponent, which real Lua accepts (implicit exponent 0) but the brief's
    narrower detection would have wrongly rejected. Fixed by detecting on `.` or `p`/`P`.
    Independently verified this and the general port against `/usr/bin/lua` (Lua 5.4.8) and a
    live `deno run` probe of `evalConstNode`: `tonumber("0x1F.0")`, `tonumber("0x1p4")`,
    `tonumber("0x1.8p3")`, `tonumber("0x.8p1")`, and `tonumber("1LL")` all matched the ported
    function's output exactly (`31`, `16`, `12`, `1`, `undefined`/`nil`) for both the raw
    `luaNumeralToNumber` cases and the full `evalConstNode` pipeline (including negation via
    `Op`/`unm`-wrapped `Number` nodes). Also reran `deno test`/`lint`/`fmt --check`/`check`
    myself and confirmed `git status` matched the report (only the three new files touched).
- [x] Ticket 3.3: Port `options.lua` (trimmed: no `compat`/`max` path, no CLI-only options) to
      TS (`src/options.ts`, 615 lines; `src/options_test.ts`, 261 lines). Option validation,
      std-tree normalization, rule-set building, line-length options. Default std is now
      `lua54` (the dropped `compat` option previously pulled in the dropped `max` preset). Also
      moved `luaType` out of `standards.ts` into `utils.ts` (exported; `options.ts` is its
      second consumer) and added `hasType`/`hasTypeOrFalse`/`arrayOf` validator factories
      there, ported from `utils.lua`'s `has_type`/`has_type_or_false`/`array_of`
      (`has_either_type` dropped — no caller in the kept port).
  - Eval: ported `options_spec.lua`, rewritten per the ticket brief (two upstream tests relied
    on the dropped `compat` option and dropped std presets `none`/`max`/`lua51`/`lua52`/
    `lua53`/`luajit`; replaced with ground-truth-verified equivalents exercising the same std
    override/union/addition behavior against only the `lua54`/`lua54c` presets this port
    ships), passes as 10 test steps under `deno test`. Whole-project `deno test` (32
    tests/154 steps), `deno lint`, `deno fmt --check`, `deno check` all clean.
  - Note: dispatched to a `build` subagent (same as tickets 2.3, 3.1). Before dispatch,
    computed ground truth for every spec case touching a dropped std preset by running the
    real, unmodified vendored source directly under `/usr/bin/lua` (5.4.8), via
    `package.path` pointed at `.reference/luacheck/src`, so the substitute test values in the
    brief were verified rather than guessed. This also caught a pre-existing, upstream-only
    bug: two of `options_spec.lua`'s own tests ("allows compound std unions", "allows std
    addition") assert on `options.normalize(...).globals`, a field `options.normalize` never
    sets (confirmed `nil` on both sides of both comparisons against the real interpreter) — so
    both tests pass no matter what `std` resolves to and test nothing. Not a port artifact:
    confirmed against the unmodified 1.2.0 source. Rewrote both to assert on `.std` (what the
    test names actually claim to check) instead of porting the no-op assertions verbatim.
    Independently re-verified after the subagent reported done: reran `deno test`/`lint`/
    `fmt --check`/`check` and `git status --short` myself (matched the report exactly), read
    the full `options.ts`/`options_test.ts` source directly against the real Lua source read
    earlier in this same session, and confirmed the `compat`/`max` trim, the `stds.lua54`
    default fallback, the `globals`/`read_globals` array-part-only consumption in
    `getFinalStd`, and every rewritten test's expected value all matched what independent
    ground-truth verification against the real interpreter established. Two subtleties the
    subagent flagged and both checked out as faithful, not shortcuts: (1) `getFinalStd`'s
    array-part-only `ipairs` walk only covers the ordered `overwriteField` calls — the same
    function's later `addStdTable(..., true, true)` call separately applies the *named-key*
    part of the same `globals`/`read_globals` tables, so both parts of a table do end up
    applied, just via two different code paths, matching upstream; (2) `NormalizedOptions.std`
    is typed `StdTable` (matching the ticket brief), though the value it holds at runtime is
    `FieldDef`-shaped — harmless (both `StdTable` fields are optional, so `FieldDef` values
    satisfy it structurally), but `FieldDef` would be the more precise type; left as `StdTable`
    to match the brief, worth revisiting when `check.lua` starts consuming this.

## Phase 4 — Stages (analysis engine)

**Status:** in_progress

18 stage modules + the `stages/init.lua` registry. Ticket boundaries grilled and finalized
after Phase 3 landed, based on real line counts (`.reference/luacheck/src/luacheck/stages/*.lua`)
and the canonical stage order in `stages/init.lua`. 4.1–4.3 must land before 4.4–4.7 (later
stages depend on their output: `linearize` populates `chstate.lines`, `resolve_locals` binds
identifiers); 4.4–4.7 can land in any order relative to each other; 4.8 (the registry) must be
last since it requires all 18 stage modules to exist. Five stage modules have no dedicated
upstream busted spec (only indirect coverage via `check_spec.lua`/`cli_spec.lua`); these get
hand-written unit tests in their own ticket, same treatment as `core_utils.ts` in ticket 3.2.
Dispatch strategy: split test-writing/implementation dispatches to the `build` subagent as in
Phase 3, except ticket 4.2 (`linearize`), which is implemented directly given its size (747
lines, the largest file in the whole port) and central role. Bundle-size probe deferred to the
end of this phase (one measurement covering Phase 3+4 growth together, rather than a separate
Phase 3 baseline).

- [x] Ticket 4.1: Port `parse.lua` (19 lines) + `unwrap_parens.lua` (95 lines) to TS
      (`src/stages/parse.ts`, 28 lines; `src/stages/unwrap_parens.ts`, 139 lines). First
      ticket in the new `src/stages/` subdirectory. Extended `CheckStateInstance`
      (`src/check_state.ts`) with six new fields `parse.ts` populates: `source`, `ast`,
      `comments`, `codeLines`, `lineEndings`, `hangingSemicolons` (upstream's local variable
      name for the sixth is `useless_semicolons`; kept the existing `hangingSemicolons` name
      `parser.ts`'s `ParseResult` already uses for the same value, rather than introducing a
      second name). `parse.ts` reads `lineOffsets`/`lineLengths` directly off the same
      `parse()` call's return value rather than upstream's pre-allocate-then-out-param style,
      since this port's `parse()` already returns fresh arrays either way.
      `unwrap_parens.ts` has no upstream spec — hand-written tests, each built from a real
      `parser.parse()` AST (not a hand-built fixture), covering: scalar-Paren unwrap, tail-Paren
      preservation at a `Table`/`Return` list boundary, and both the 581/582 warnings.
  - Eval: whole-project `deno test` (41 tests/154 steps), `deno lint`, `deno fmt --check`,
    `deno check` all clean. Independently re-ran all four myself; `git status --short` matched
    the subagent's report exactly (only `check_state.ts` and the new `src/stages/` files
    touched, plus this session's own `PLAN.md` edit).
  - Note: dispatched to a `build` subagent. It caught and fixed a real bug in its own first
    draft: the 581 check must re-read `node[2]` *after* the recursive `handle_nodes(chstate,
    node)` call, not reuse the value captured before it, because that recursive call can
    itself unwrap a `Paren` sitting at `node[2]` first (e.g. `not (a == b)`) — using the
    stale pre-recursion value would make the 581 check miss this case. The subagent caught
    this by ground-truthing against the real Lua 5.4 interpreter running the actual vendored
    source, not from inspection alone. Independently re-verified this fix and two other
    flagged claims (the tail-Paren preservation condition's exact boolean logic; the
    `Local`-vs-`Set` unwrap distinction) by running the real vendored `unwrap_parens.lua`
    under `/usr/bin/lua` (5.4.8) against six source snippets and diffing AST dumps
    before/after `unwrap_parens.run`, including `local x = not (a == b)` (the exact case the
    fix targets) — all six matched the ported behavior exactly.
- [x] Ticket 4.2: Port `linearize.lua` (747 lines) to TS (`src/stages/linearize.ts`, 1103
      lines — the type declarations for `Var`/`Value`/`Item`/`LineInstance`/`LinStateInstance`
      account for most of the growth over the untyped Lua original). Solo, implemented
      directly, not dispatched. Ported `linearize_spec.lua` (406 lines) as
      `src/stages/linearize_test.ts` (433 lines; one Deno test per busted `describe` block,
      one `t.step` per `it`, same convention as 3.1-3.3). Extended `CheckStateInstance`
      with `topLine`/`lines` (both typed `LineInstance`, imported `type`-only from
      `stages/linearize.ts` — no runtime circular dependency even though `linearize.ts`
      imports `CheckStateInstance` back, since both sides only need the types). Updated
      `core_utils.ts`'s `eachStatement` to take the real `LineInstance[]` instead of the
      `LineLike` placeholder it was carrying since ticket 3.2.
      Exports `LineInstance`, `Var`, `Value`, `Item` (a `Jump`/`Cjump`/`Eval`/`Local`/`Set`/
      `OpSet` discriminated union) and `run` for the not-yet-ported `resolve_locals.lua` and
      `detect_*.lua` stages to consume via `chstate.lines`/`chstate.topLine`. Two Lua naming
      traps documented in the file header: a `Var`'s `line` field is the enclosing
      `LineInstance` (function scope), not a source line number; and `LinState.lines`/
      `.scopes` are `Stack`s shared across every nested `buildLine` call, not one per
      function, which is how `leaveScope` distinguishes an unresolved goto/break from one
      that escaped its own function. `LocalItem.accesses`/`.usedValues`/`.lines` are always
      a `Map`/array here rather than upstream's `node[2] and {}` (`undefined` when a `local`
      has no initializer): verified the only downstream Lua consumer (`resolve_locals.lua`)
      only ever does a truthy-AND-lookup or an unconditional iterate, both of which already
      behave identically against an empty `Map`/array, so this drops several `Item` fields
      from optional to required without changing behavior. A few upstream `assert()` calls
      guarding grammar-guaranteed invariants with no bearing on control flow (e.g.
      `assert(expr.tag == "Index")` after ruling out `"Id"`) are dropped per this port's
      "trust internal guarantees" convention; the two balanced-stack assertions at the end
      of `stage.run` are kept as a real runtime check.
  - Eval: whole-project `deno test` (42 tests/176 steps, up from 41/154), `deno lint`,
    `deno fmt --check`, `deno check` all clean; `git status --short` matched the expected
    file set exactly (`check_state.ts`, `core_utils.ts` modified; `src/stages/linearize.ts`
    and `src/stages/linearize_test.ts` new). All 22 of `linearize_spec.lua`'s ported steps
    passed on the first run.
  - Note: `linearize_spec.lua` does not itself exercise the 411-433 redefinition warnings
    (only syntax errors and control-flow/value-registration shape). Ground-truthed
    `warnRedefined`'s three-branch code computation (same-scope / same-function-different-
    scope / different-function-upvalue, crossed with `var`/`arg`/`loop` type codes) against
    the real vendored `linearize.lua` under `/usr/bin/lua` (5.4.8) with seven snippets
    covering all seven reachable codes (411, 412, 413, 421, 431, 432, 433); all seven
    matched the ported behavior exactly (same code, line, column, and variable name).
- [x] Ticket 4.3: Port `parse_inline_options.lua` (351 lines) to TS (`src/stages/parse_inline_options.ts`,
      500 lines) + `name_functions.lua` (71 lines) to TS (`src/stages/name_functions.ts`, 106 lines)
      + `resolve_locals.lua` (273 lines) to TS (`src/stages/resolve_locals.ts`, 399 lines).
      `parse_inline_options` and `name_functions` have no upstream spec - hand-written tests
      (`src/stages/parse_inline_options_test.ts`, 185 lines; `src/stages/name_functions_test.ts`,
      112 lines). `resolve_locals_spec.lua` (159 lines) ported as `src/stages/resolve_locals_test.ts`
      (190 lines), following the `linearize_test.ts` one-`Deno.test`-per-`describe`,
      one-`t.step`-per-`it` convention. `resolve_locals.ts` uses a local
      `ResolvedValue = Value & {used?, mutated?, overwritingItem?}` type instead of widening
      `linearize.ts`'s exported `Value`, since those fields are write-only analysis state this
      stage adds, not part of `linearize`'s own output shape. `parse_inline_options.ts` needed
      two small from-scratch helpers with no existing port to reuse: `removeBalancedParens`
      (Lua's `%b()` gsub pattern, explicitly out of scope for `lua_pattern.ts`) and a narrow
      `luaToNumber` (decimal/hex-integer only, for the numeric limit-option arguments).
      Extended `CheckStateInstance` with `InlineOptionsEntry` (`line`, `pop_count?`, `options?`,
      `column?`, `end_column?`) and an optional `inlineOptions?: InlineOptionsEntry[]` field.
  - Eval: whole-project `deno test` (56 tests/184 steps, up from 42/176), `deno lint`,
    `deno fmt --check`, `deno check` all clean; `git status --short` matched the expected file
    set exactly (`check_state.ts` modified; six new `src/stages/` files). All three new test
    files passed in full on the implementation dispatch's first attempt, no test-file bugs found.
  - Note: dispatched as two separate `build` subagent calls (test-writing, then implementation
    against those tests), per this phase's split-dispatch convention. Independently ground-truthed
    `parse_inline_options.lua`'s function-boundary/inline-push interaction - the trickiest part of
    that file, since a function's implicit pop can silently swallow an unpaired inline `push` left
    open inside it - against the real vendored `parse_inline_options.lua` under `/usr/bin/lua`
    (5.4.8), using a snippet with an inline `push` left open inside a function body plus a
    separate top-level `ignore` directive. Both the emitted 022 warning (line/column) and the
    resulting `inline_options` array (including the `ignore` option's argument array) matched the
    TS port exactly.
- [x] Ticket 4.4: Port `detect_unused_locals.lua` (335 lines) to TS (`src/stages/detect_unused_locals.ts`,
      537 lines), solo, largest single detect_* stage. Ported `unused_locals_spec.lua` (394 lines)
      as `src/stages/detect_unused_locals_test.ts` (560 lines), following the established
      one-`Deno.test`-per-`describe`, one-`t.step`-per-`it` convention (upstream's second
      `describe` block name is misspelled - "unused recurisve function detection" - and was
      corrected in the ported test name, since it is not user-facing output). Exported
      `resolve_locals.ts`'s previously-local `ResolvedValue` type (adding one `export` keyword,
      no other change) so this stage could reuse it instead of redefining an equivalent type.
      This stage's own `stage.warnings` table needed a wider local type than the plain-string
      `message_format` used by every prior stage, since several of its entries
      (`unused_local_message_format`, `unused_arg_message_format`, and the two closures
      `unused_or_overwritten_warning` returns) are Lua functions, not strings.
      `setmetatable({}, {__index = marked})` + `rawget` (the closure-usage graph's per-candidate
      overlay-table trick, with no direct JS equivalent) was unpacked into a `markReachableLines`
      helper taking a written-and-iterated `marked: Set<LineInstance>` plus an optional read-only
      `globallyMarked` set consulted only to short-circuit the DFS, reproducing the original's
      read-sees-union/write-and-iterate-sees-overlay-only semantics explicitly. JS object literals
      keep `undefined`-valued keys as own properties (unlike a Lua table constructor assigning
      `nil`, which never creates the key), which the ported tests' `assertEquals` calls are
      sensitive to; every warning-building call site with conditionally-absent fields now routes
      through a small local `compact()` helper stripping `undefined`-valued keys before the object
      reaches `warnValue`/`warnVar`.
  - Eval: whole-project `deno test` (58 tests/212 steps, up from 56/184), `deno lint`,
    `deno fmt --check`, `deno check` all clean; `git status --short` matched the expected file set
    exactly (`resolve_locals.ts` modified by exactly the one-word `export` addition, confirmed via
    `git diff`; two new `src/stages/` files). All 28 test-file steps passed in full on the
    implementation dispatch's first attempt, no test-file bugs found.
  - Note: dispatched as two separate `build` subagent calls (test-writing, then implementation
    against those tests), per this phase's split-dispatch convention. Independently
    re-verified the full test/lint/fmt/check suite and `git status`/`git diff` after the
    implementation dispatch, and spot-checked the `markReachableLines`/`globallyMarked` overlay
    translation (the trickiest part of this file, given the Lua source's metatable/`rawget`
    indirection) against both the implementation report's description and the actual code -
    matches the original's semantics exactly.
- [x] Ticket 4.5: Port `detect_globals.lua` (252 lines) to TS (`src/stages/detect_globals.ts`,
      341 lines) + `detect_uninit_accesses.lua` (54 lines) to TS
      (`src/stages/detect_uninit_accesses.ts`, 85 lines). Ported `globals_spec.lua` (143 lines)
      as `src/stages/detect_globals_test.ts` (222 lines) + `uninit_accesses_spec.lua` (125 lines)
      as `src/stages/detect_uninit_accesses_test.ts` (166 lines), following the established
      one-`Deno.test`-per-`describe`, one-`t.step`-per-`it` convention (the upstream
      `uninit_accesses_spec.lua` `describe` block name, "uninitalized access detection", carries
      its own spelling variant of "uninitialized" from the Lua source; kept verbatim rather than
      corrected, since - unlike ticket 4.4's unambiguous "recurisve" typo - this one reads as a
      debatable judgment call, not a clear-cut error).
      `node.resolution` (an alias-tracking memo `deep_resolve` stashes on AST nodes to trace
      `local alias = global.field`-style chains back to a global) ported as a single
      `"unknown" | "not_string" | AstNode` union - the "resolved to an indexing chain" case reuses
      a synthetic `AstNode`-shaped object (global node at array-part index 1, key resolutions
      following) rather than a bespoke type, since `resolved_to_index`'s own check already treats
      any non-`String`-tag `AstNode` as an indexing chain. `previous_indexing_len` kept snake_case
      on this internal resolution structure (not just the final `Warning`), since it is the exact
      same field flowing unchanged from the internal chain into the public warning object.
      `detect_globals.lua`'s `detect_in_node` walks a base/key node chain via a `repeat...until`
      loop that reassigns its own `node` parameter in place; `warn_global` at the end of the
      function reads that same reassigned `node`, not the original - confirmed directly against
      the Lua source (plain parameter reassignment, no shadowing) and cross-checked against the
      "detects indirect global field access" test case's column range (8-12, matching the `alias`
      identifier the loop walks down to, not the full `alias[2][c]` expression). One call site in
      that same loop (`detect_in_node(chstate, item, node[2], ...)`) needed an explicit
      `typeof === "object"` guard with no Lua-side equivalent: for an `Invoke` node, Lua's `node[2]`
      is a bare method-name string, and calling `detect_in_node` on it is a harmless no-op only
      because Lua strings have a metatable making `.tag`/`ipairs()` silently do nothing on them -
      TypeScript has no such fallback, so the guard reproduces the Lua no-op explicitly rather than
      passing a raw string where an `AstNode` is expected. Both files' `warnings` metadata exports
      follow ticket 4.4's precedent: `detect_uninit_accesses.ts` uses the plain-string
      `message_format` shape every other stage's warnings table uses, but `detect_globals.ts`
      needs the wider `message_format: string | ((warning: Warning) => string)` type, since three
      of its warning codes (122, 142, 143) format via closures (`prefix_if_indirect`), not strings.
  - Eval: whole-project `deno test` (60 tests/228 steps, up from 58/212), `deno lint`,
    `deno fmt --check`, `deno check` all clean; `git status --short` matched the expected file set
    exactly - four new `src/stages/` files, no other files touched (unlike ticket 4.4, this
    ticket's stages needed no upstream file changes). All 16 test-file steps (8 + 8) passed in
    full on the implementation dispatch's first attempt, no test-file bugs found; one formatting
    nit in the test-writing dispatch's output (an unwrapped object literal) was caught and fixed
    with `deno fmt` during independent re-verification.
  - Note: dispatched as two separate `build` subagent calls (test-writing, then implementation
    against those tests, covering both stage files together per this ticket's own file grouping),
    per this phase's split-dispatch convention. The first implementation-dispatch attempt returned
    an empty result with the placeholder files untouched (a failed/aborted subagent run, not a
    reported failure) and was retried verbatim; the retry succeeded on its first real attempt.
    Independently re-ran the full test/lint/fmt/check suite and `git status` after the
    implementation dispatch, and spot-checked the `warn_global`-reads-the-reassigned-`node` claim
    (the trickiest part of this file, given the Lua source's in-place parameter reassignment)
    directly against the vendored Lua source and the passing test's own column expectations -
    matches the original's semantics exactly.
- [ ] Ticket 4.6: Port `detect_cyclomatic_complexity.lua` (159 lines) +
      `detect_unreachable_code.lua` (36 lines). Ported `cyclomatic_complexity_spec.lua`
      (236 lines) + `unreachable_code_spec.lua` (126 lines).
- [ ] Ticket 4.7: Port the 7 smallest detect_* stages together: `detect_bad_whitespace`
      (76 lines), `detect_unused_fields` (81 lines), `detect_reversed_fornum_loops`
      (39 lines), `detect_empty_blocks` (36 lines), `detect_unbalanced_assignments`
      (34 lines), `detect_compound_operators` (34 lines), `detect_empty_statements`
      (13 lines). `detect_compound_operators` and `detect_empty_statements` have no upstream
      spec — hand-written tests; the other 5 get their existing busted specs ported
      (`bad_whitespace_spec.lua` 74 lines, `unused_fields_spec.lua` 46 lines,
      `reversed_fornum_loops_spec.lua` 87 lines, `empty_blocks_spec.lua` 68 lines,
      `unbalanced_assignments_spec.lua` 56 lines).
- [ ] Ticket 4.8: Port `stages/init.lua` (76 lines), the stage registry + warning-metadata
      table. Solo, final ticket of the phase — requires all 18 stage modules to exist first.

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
| Verification catch rate | 1 / 6 | Phase 0: caught unscoped JSR name + esbuild-instead-of-deno-bundle. Ticket 2.1: cross-checked `isPrintable` against a real Lua 5.4 interpreter, no discrepancy found. Ticket 2.3 and ticket 3.1: independently reran `deno test`/`lint`/`fmt --check`/`check` and spot-checked each `build` subagent's report claims against the actual source after it reported done, all claims matched both times, no discrepancy found. Ticket 3.2: independently cross-checked `evalConstNode`'s hex-float numeral parsing against `/usr/bin/lua` (5.4.8) and a live `deno run` probe across 6 cases, all matched exactly; the subagent itself (not this verification pass) had already caught and fixed one real gap in its own first draft (hex-float detection too narrow for the `.0`-append case). Ticket 3.3: no discrepancy found in post-hoc verification of the subagent's work, but the pre-dispatch ground-truth pass (running the real vendored source under `/usr/bin/lua` before writing the brief, not the after-the-fact check this metric tracks) caught a real, pre-existing bug in upstream's own `options_spec.lua`: two tests asserted on a result field `options.normalize` never sets, so they passed regardless of the behavior under test |
| Escaped defect rate | 0 / 0 | bugs/regressions found after a ticket was marked done, vs. tickets closed |
| Rework/reopen rate | 0 / 0 | tickets reopened/rescoped after grilling had already settled them, vs. tickets grilled |
| Rough cost | — | approximate turns/tokens spent on grilling + planning + dispatch + review per ticket, vs. a rough estimate of direct-implementation cost |
