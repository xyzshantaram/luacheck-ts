/**
 * Ported busted spec: a rewritten replacement for
 * .reference/luacheck/spec/options_spec.lua (see the ticket 3.3 brief for
 * the full rationale). Two upstream tests relied on the dropped `compat`
 * option and dropped std presets (`none`, `max`, `lua51`/`lua52`/`lua53`/
 * `luajit`); both are replaced here with ground-truth-verified equivalents
 * that exercise the same underlying behavior (std override/addition/union,
 * new_globals resetting prior globals) using only the `lua54`/`lua54c`
 * presets this port ships.
 *
 * Translation conventions match standards_test.ts: one Deno test per busted
 * `describe` block, one `t.step` per busted `it` block; `assert.same`/
 * `assert.equal`/`assert.is_true`/`assert.is_false`/`assert.is_nil` all
 * become `assertEquals`; Lua multi-return `local ok, err = f()` becomes
 * `const [ok, err] = f()`. `globals`/`read_globals`/`new_globals`/
 * `new_read_globals` option values use the array-part convention
 * (`{"1": "foo", "2": "bar"}`) described in standards.ts's header comment.
 */

import { assertEquals } from "@std/assert";
import {
  allOptions,
  normalize,
  type NormalizedRule,
  validate,
} from "./options.ts";
import type { Options } from "./options.ts";
import type { FieldDef, FieldsTable, StdTable } from "./standards.ts";

Deno.test("options", async (t) => {
  await t.step("validate", async (t) => {
    await t.step("returns true if options are empty", () => {
      const [ok] = validate(allOptions);
      assertEquals(ok, true);
    });

    await t.step("returns true if options are valid", () => {
      const [ok] = validate(allOptions, {
        globals: { "1": "foo" },
        unrelated: () => {},
      });
      assertEquals(ok, true);
    });

    await t.step(
      "returns false and an error message if options are invalid",
      () => {
        let [ok, err] = validate(allOptions, {
          globals: 3 as unknown as FieldsTable,
          redefined: false,
        });
        assertEquals(ok, false);
        assertEquals(
          err,
          "invalid value of option 'globals': table expected, got number",
        );

        [ok, err] = validate(allOptions, {
          globals: { "1": 3 as unknown as string },
        });
        assertEquals(ok, false);
        assertEquals(
          err,
          "invalid value of option 'globals': in field [1]: string expected as global name, got number",
        );

        [ok, err] = validate(allOptions, (() => {}) as unknown as Options);
        assertEquals(ok, false);
        assertEquals(err, "option table expected, got function");

        [ok, err] = validate(allOptions, {
          unused: 0 as unknown as boolean,
        });
        assertEquals(ok, false);
        assertEquals(
          err,
          "invalid value of option 'unused': boolean expected, got number",
        );

        [ok, err] = validate(allOptions, {
          max_line_length: true as unknown as number,
          redefined: false,
        });
        assertEquals(ok, false);
        assertEquals(
          err,
          "invalid value of option 'max_line_length': number or false expected, got true",
        );

        [ok, err] = validate(allOptions, {
          max_line_length: "foo" as unknown as number,
          redefined: false,
        });
        assertEquals(ok, false);
        assertEquals(
          err,
          "invalid value of option 'max_line_length': number or false expected, got string",
        );

        [ok, err] = validate(allOptions, {
          std: "+lua54+luaaot",
          redefined: false,
        });
        assertEquals(ok, false);
        assertEquals(
          err,
          "invalid value of option 'std': unknown std 'luaaot'",
        );

        [ok, err] = validate(allOptions, {
          std: { read_globals: { "1": 1 as unknown as string } },
          redefined: false,
        });
        assertEquals(ok, false);
        assertEquals(
          err,
          "invalid value of option 'std': in field .read_globals[1]: string expected as global name, got number",
        );

        [ok, err] = validate(allOptions, {
          std: 123 as unknown as StdTable,
          redefined: false,
        });
        assertEquals(
          ok,
          false,
        );
        assertEquals(
          err,
          "invalid value of option 'std': string or table expected, got number",
        );
      },
    );
  });

  await t.step("normalize", async (t) => {
    await t.step("applies default values", () => {
      const opts = normalize([]);
      assertEquals(opts, normalize([{}]));

      assertEquals(opts.unused_secondaries, true);
      assertEquals(opts.module, false);
      assertEquals(opts.allow_defined, false);
      assertEquals(opts.allow_defined_top, false);
      assertEquals(typeof opts.std, "object");
      assertEquals(opts.rules, []);
    });

    await t.step("considers simple boolean options", () => {
      const opts = normalize([
        { module: false, unused_secondaries: true },
        { module: true, allow_defined: false },
      ]);

      assertEquals(opts.module, true);
      assertEquals(opts.unused_secondaries, true);
      assertEquals(opts.allow_defined, false);
    });

    await t.step(
      "considers opts.std overriding and new_globals resetting prior globals",
      () => {
        // Ground-truth-verified replacement for the upstream test, which
        // used std = "none" and the compat option, both dropped from this
        // port. Uses an inline empty std table ({}) as the base instead of
        // "none", and drops the compat = true/false toggling entirely,
        // keeping the part of the scenario that is still meaningful
        // post-trim: a later new_globals option resets (does not merge
        // with) an earlier globals option.
        const opts = normalize([
          { std: {} },
          { globals: { "1": "foo", "2": "bar" } },
          { new_globals: { "1": "baz" } },
        ]);

        assertEquals(opts.std, {
          fields: {
            baz: { read_only: false, other_fields: true },
          },
        } as unknown as StdTable);
      },
    );

    await t.step("allows compound std unions", () => {
      // Ground-truth-verified replacement for the upstream test, which
      // combined 4 dropped presets (lua51/lua52/lua53/luajit) via "+" and
      // compared against the dropped "max" preset. Adapted to the two
      // in-scope presets: lua54c is already a superset of lua54 (see
      // builtin_standards.ts), so unioning both via "+" must equal lua54c
      // alone. Checks opts.std (not opts.globals, which options.normalize
      // never sets -- the upstream test's own .globals assertion was
      // comparing undefined to undefined and never actually tested
      // anything).
      assertEquals(
        normalize([{ std: "lua54c" }]).std,
        normalize([{ std: "lua54+lua54c" }]).std,
      );
    });

    await t.step("allows std addition", () => {
      // Ground-truth-verified replacement for the upstream test, same
      // "max"/"none"/dropped-preset issue and same opts.globals-is-always-
      // nil issue as above, fixed the same way. Checks that a later
      // "+lua54c" option adds to (does not replace) an earlier "lua54"
      // base.
      assertEquals(
        normalize([{ std: "lua54+lua54c" }]).std,
        normalize([{ std: "lua54" }, { std: "+lua54c" }]).std,
      );
    });

    await t.step("considers read-only and regular globals", () => {
      const opts = normalize([
        {
          std: "lua54",
          globals: { "1": "foo", "2": "bar", "3": "removed" },
          read_globals: { "1": "baz" },
        },
        {
          new_read_globals: { "1": "quux" },
          not_globals: ["removed", "unrelated", "print"],
        },
      ]);
      const std = opts.std as FieldDef;
      assertEquals(typeof std, "object");
      assertEquals(typeof std.fields, "object");

      const fields = std.fields as FieldsTable;
      assertEquals(fields.foo, { read_only: false, other_fields: true });
      assertEquals(fields.bar, { read_only: false, other_fields: true });
      assertEquals(fields.baz, undefined);
      assertEquals(fields.quux, {
        read_only: true,
        deep_read_only: true,
        other_fields: true,
      });
      assertEquals(typeof fields.string, "object");
      assertEquals((fields.string as FieldDef).deep_read_only, true);
      assertEquals((fields.string as FieldDef).other_fields, undefined);
    });

    await t.step("considers macros, ignore, enable and only", () => {
      const opts = normalize([
        { unused: false },
        { ignore: ["412", "1$/bar"] },
        { unused: true, unused_args: false, enable: ["511"] },
        { only: ["foo"] },
      ]);

      const expected: NormalizedRule[] = [
        [[[undefined, "^foo$"]], "only"],
        [[["^21[23]", undefined]], "disable"],
        [[["^[23]", undefined]], "enable"],
        [[["^511", undefined]], "enable"],
        [[["^412", undefined], ["1$", "^bar$"]], "disable"],
      ];

      assertEquals(opts.rules, expected);
    });
  });
});
