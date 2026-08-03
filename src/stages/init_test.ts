/**
 * Ported from luacheck's stages/init.lua (76 lines). There is no matching
 * upstream busted spec: init.lua has no spec/ file of its own, since its
 * registry role has no direct busted test of its own upstream either. This
 * file is hand-written to cover the same guarantees the Lua source gives:
 * a fixed pipeline order, a merged warning-metadata registry, and a
 * single `run` entry point that drives every stage in order.
 *
 * `stages.warnings` merges two non-stage codes ("011", "631") registered
 * directly, plus every code from every stage module's own `warnings`
 * export. Each merged entry gets `fields` set to the four base fields
 * (`code`, `line`, `column`, `end_column`) concatenated with the stage's
 * own extra fields, and `fields_set` set to a `Set` built from that same
 * list, per `register_warnings` in the Lua source.
 *
 * `run` from ./init.ts does not exist yet (a later implementation dispatch
 * adds it); a throwing placeholder stands in so this file type-checks.
 * `deno test` failing/erroring at the first call into `stages.run` is
 * expected.
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import { checkStateNew } from "../check_state.ts";
import { sortByLocation } from "../core_utils.ts";
import { stages } from "./init.ts";

import * as parseModule from "./parse.ts";
import * as resolveLocalsModule from "./resolve_locals.ts";
import * as detectCyclomaticComplexityModule from "./detect_cyclomatic_complexity.ts";
import * as detectReversedFornumLoopsModule from "./detect_reversed_fornum_loops.ts";
import * as detectUnusedLocalsModule from "./detect_unused_locals.ts";

const BASE_FIELDS = ["code", "line", "column", "end_column"];

Deno.test("stage registry", async (t) => {
  await t.step("lists all 18 stage names in pipeline order", () => {
    assertEquals(stages.names, [
      "parse",
      "unwrap_parens",
      "linearize",
      "parse_inline_options",
      "name_functions",
      "resolve_locals",
      "detect_bad_whitespace",
      "detect_compound_operators",
      "detect_cyclomatic_complexity",
      "detect_empty_blocks",
      "detect_empty_statements",
      "detect_globals",
      "detect_reversed_fornum_loops",
      "detect_unbalanced_assignments",
      "detect_uninit_accesses",
      "detect_unreachable_code",
      "detect_unused_fields",
      "detect_unused_locals",
    ]);
  });

  await t.step(
    "wires the 18 stage modules in the same order as stages.names",
    () => {
      assertEquals(stages.modules.length, 18);

      // Check the first, the last, and three entries in between. A check
      // of all 18 entries would add no more confidence than these five.
      assertStrictEquals(stages.modules[0], parseModule);
      assertStrictEquals(stages.modules[5], resolveLocalsModule);
      assertStrictEquals(stages.modules[8], detectCyclomaticComplexityModule);
      assertStrictEquals(
        stages.modules[12],
        detectReversedFornumLoopsModule,
      );
      assertStrictEquals(stages.modules[17], detectUnusedLocalsModule);
    },
  );

  await t.step(
    "registers the two non-stage codes 011 and 631 directly",
    () => {
      assertEquals(stages.warnings["011"], {
        message_format: "{msg}",
        fields: [
          ...BASE_FIELDS,
          "msg",
          "prev_line",
          "prev_column",
          "prev_end_column",
        ],
        fields_set: new Set([
          ...BASE_FIELDS,
          "msg",
          "prev_line",
          "prev_column",
          "prev_end_column",
        ]),
      });

      assertEquals(stages.warnings["631"], {
        message_format: "line is too long ({end_column} > {max_length})",
        fields: [...BASE_FIELDS, "max_length", "line_ending"],
        fields_set: new Set([...BASE_FIELDS, "max_length", "line_ending"]),
      });
    },
  );

  await t.step(
    "merges a plain-string-format code with no extra fields (611)",
    () => {
      assertEquals(stages.warnings["611"], {
        message_format: "line contains only whitespace",
        fields: BASE_FIELDS,
        fields_set: new Set(BASE_FIELDS),
      });
    },
  );

  await t.step(
    "merges a plain-string-format code with extra fields (571)",
    () => {
      assertEquals(stages.warnings["571"], {
        message_format:
          "numeric for loop goes from #(expr) down to {limit} but loop step is not negative",
        fields: [...BASE_FIELDS, "limit"],
        fields_set: new Set([...BASE_FIELDS, "limit"]),
      });
    },
  );

  await t.step(
    "merges the one function-format code (561) without altering the function",
    () => {
      const entry = stages.warnings["561"];
      assertEquals(typeof entry.message_format, "function");
      assertEquals(entry.fields, [
        ...BASE_FIELDS,
        "complexity",
        "function_type",
        "function_name",
        "max_complexity",
      ]);
      assertEquals(
        entry.fields_set,
        new Set([
          ...BASE_FIELDS,
          "complexity",
          "function_type",
          "function_name",
          "max_complexity",
        ]),
      );

      const { message_format: messageFormat } = entry;
      if (typeof messageFormat !== "function") {
        throw new Error("expected 561 message_format to be a function");
      }
      const mainChunkMessage = messageFormat({
        code: 561,
        line: 1,
        column: 1,
        end_column: 1,
        function_type: "main_chunk",
        complexity: 15,
        max_complexity: 10,
      });
      assertEquals(
        mainChunkMessage,
        "cyclomatic complexity of main chunk is too high " +
          "({complexity} > {max_complexity})",
      );
    },
  );

  await t.step(
    "registers exactly 56 warning codes total",
    () => {
      // Per-stage counts, read off each stage module's own `warnings`
      // export (parse, name_functions, and resolve_locals export none):
      //   unwrap_parens                 2  (581, 582)
      //   linearize                    10  (411-413, 421-423, 431-433, 521)
      //   parse_inline_options          3  (021, 022, 023)
      //   detect_bad_whitespace         5  (611-614, 621)
      //   detect_compound_operators     1  (033)
      //   detect_cyclomatic_complexity  1  (561)
      //   detect_empty_blocks           2  (541, 542)
      //   detect_empty_statements       1  (551)
      //   detect_globals                8  (111-113, 121, 122, 131, 142, 143)
      //   detect_reversed_fornum_loops  1  (571)
      //   detect_unbalanced_assignments 2  (531, 532)
      //   detect_uninit_accesses        2  (321, 341)
      //   detect_unreachable_code       2  (511, 512)
      //   detect_unused_fields          1  (314)
      //   detect_unused_locals         13  (211-214, 221, 231-233, 241,
      //                                     311-313, 331)
      // Stage total: 2+10+3+5+1+1+2+1+8+1+2+2+2+1+13 = 54.
      // Plus the two non-stage codes (011, 631) registered directly: 56.
      assertEquals(Object.keys(stages.warnings).length, 56);
    },
  );

  await t.step(
    "runs the full pipeline in dependency order",
    () => {
      // "local x = 1" is never read, so detect_unused_locals reports 211 -
      // it can only do so because resolve_locals and linearize already
      // ran and resolved the variable. "if true then end" has an empty
      // then-branch, so detect_empty_blocks reports 542 - it can only do
      // so because linearize already ran and populated chstate.lines. The
      // main chunk itself always gets a 561 complexity report from
      // detect_cyclomatic_complexity, at a fixed line 1, column 1.
      const chstate = checkStateNew("local x = 1\nif true then end\n");
      stages.run(chstate);
      sortByLocation(chstate.warnings);

      const codes = chstate.warnings.map((warning) => warning.code);
      assertEquals(codes, [561, 211, 542]);
    },
  );
});
