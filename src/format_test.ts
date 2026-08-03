/**
 * Ported from luacheck's format.lua, lines 1-80 only
 * (`get_message_format`/`substitute`/`format_message`/`format.get_message`);
 * see ./format.ts's header comment for the trim rationale (color/CLI
 * report printing dropped). `.reference/luacheck/spec/format_spec.lua`
 * exists but only exercises `format.format`, the CLI report printer this
 * port excludes - it has no case for `format.get_message` in isolation.
 * Every step below is hand-written directly against format.lua's kept
 * 80 lines.
 *
 * Warning codes are reused from other stages' own test files rather than
 * invented, so the expected message text can be cross-checked against a
 * real `message_format` string already read while porting that stage:
 * 611 (detect_bad_whitespace.ts, plain string, no substitution), 631
 * (registered directly in stages/init.ts, needs a `{field}` substitution),
 * 131 (detect_globals.ts, needs a `{field!}` substitution), and 561
 * (detect_cyclomatic_complexity.ts, function `message_format`).
 *
 * `getMessage` from ./format.ts does not exist yet (a later implementation
 * dispatch adds it); a throwing placeholder stands in so this file
 * type-checks. `deno test` failing/erroring at the first call into
 * `getMessage` is expected.
 */

import { assertEquals, assertThrows } from "@std/assert";
import type { Warning } from "./check_state.ts";
import { getMessage } from "./format.ts";

Deno.test("format.getMessage", async (t) => {
  await t.step(
    "returns a plain-string message_format unchanged, with no substitution (611)",
    () => {
      const warning: Warning = { code: 611, line: 3, column: 1, end_column: 1 };
      assertEquals(getMessage(warning), "line contains only whitespace");
    },
  );

  await t.step(
    "substitutes a {field} marker with the raw value (631)",
    () => {
      const warning: Warning = {
        code: 631,
        line: 1,
        column: 1,
        end_column: 85,
        max_length: 80,
      };
      assertEquals(getMessage(warning), "line is too long (85 > 80)");
    },
  );

  await t.step(
    "substitutes a {field!} marker as a single-quoted value, never ANSI color (131)",
    () => {
      const warning: Warning = {
        code: 131,
        line: 2,
        column: 7,
        end_column: 9,
        name: "foo",
      };
      assertEquals(getMessage(warning), "unused global variable 'foo'");
    },
  );

  await t.step(
    "calls a function message_format with the warning and substitutes its result (561, main chunk)",
    () => {
      const warning: Warning = {
        code: 561,
        line: 1,
        column: 1,
        end_column: 1,
        function_type: "main_chunk",
        complexity: 15,
        max_complexity: 10,
      };
      assertEquals(
        getMessage(warning),
        "cyclomatic complexity of main chunk is too high (15 > 10)",
      );
    },
  );

  await t.step("throws on an unknown warning code", () => {
    const warning: Warning = { code: 9999, line: 1, column: 1, end_column: 1 };
    assertThrows(() => getMessage(warning));
  });

  await t.step(
    "throws when a field referenced by the message format is missing from the warning",
    () => {
      const warning: Warning = {
        code: 631,
        line: 1,
        column: 1,
        end_column: 85,
      };
      assertThrows(() => getMessage(warning));
    },
  );
});
