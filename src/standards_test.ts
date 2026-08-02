/**
 * Ported busted spec: .reference/luacheck/spec/standards_spec.lua
 *
 * One Deno test per busted `describe` block, with one `t.step` per busted
 * `it` block, mirroring the spec's describe/it nesting.
 *
 * Translation conventions:
 *
 * - `assert.same` -> `assertEquals` (deep equality). `assert.is_true`/
 *   `assert.is_false` -> `assertEquals(ok, true)`/`assertEquals(ok, false)`.
 * - Lua multi-return `local ok, err = f()` -> `const [ok, err] = f()`.
 * - Data-shaped object keys (`fields`, `read_only`, `other_fields`,
 *   `globals`, `read_globals`, `deep_read_only`) are kept snake_case, since
 *   they mirror luacheck's own config/data format 1:1 (see standards.ts's
 *   top comment); only function names are camelCased.
 * - The busted spec's `before_each` (in the "when merging trees" describe
 *   block) becomes a local factory function returning fresh `tree`/`std`
 *   objects, called at the top of each `t.step` that needs them.
 * - `standards.validate_globals_table` has no dedicated describe block in
 *   the upstream spec (it validates a bare fields table used elsewhere,
 *   e.g. by options.lua's custom-globals handling); this is an upstream
 *   gap, not one introduced by the port, so there is no test for it here.
 */

import { assertEquals } from "@std/assert";
import * as standards from "./standards.ts";
import type { FieldDef, StdTable } from "./standards.ts";

Deno.test("standards", async (t) => {
  await t.step("validate_std_table", async (t) => {
    await t.step(
      "returns false and an error message if argument table has wrong field types",
      () => {
        let [ok, err] = standards.validateStdTable({
          globals: "all of them" as unknown as StdTable["globals"],
        });
        assertEquals(ok, false);
        assertEquals(
          err,
          "in field .globals: globals table expected, got string",
        );

        [ok, err] = standards.validateStdTable(
          { read_globals: "yes" as unknown as StdTable["read_globals"] },
        );
        assertEquals(ok, false);
        assertEquals(
          err,
          "in field .read_globals: globals table expected, got string",
        );
      },
    );

    await t.step(
      "returns false and an error message if argument table has invalid definitions as values",
      () => {
        const [ok, err] = standards.validateStdTable({
          globals: { foo: "bar" as unknown as FieldDef },
        });
        assertEquals(ok, false);
        assertEquals(
          err,
          "in field .globals.foo: global description table expected, got string",
        );
      },
    );

    await t.step(
      "returns false and an error message if argument table has invalid names as values",
      () => {
        const [ok, err] = standards.validateStdTable({
          globals: { "1": 12345 as unknown as string },
        });
        assertEquals(ok, false);
        assertEquals(
          err,
          "in field .globals[1]: string expected as global name, got number",
        );
      },
    );

    await t.step(
      "returns false and an error message if definition tables have wrong field types",
      () => {
        let [ok, err] = standards.validateStdTable({
          globals: { foo: { read_only: "not_really" as unknown as boolean } },
        });
        assertEquals(ok, false);
        assertEquals(
          err,
          "in field .globals.foo: invalid value of option 'read_only': boolean expected, got string",
        );

        [ok, err] = standards.validateStdTable({
          read_globals: { bar: { other_fields: 0 as unknown as boolean } },
        });
        assertEquals(ok, false);
        assertEquals(
          err,
          "in field .read_globals.bar: invalid value of option 'other_fields': boolean expected, got number",
        );
      },
    );

    await t.step("detects invalid nested definitions", () => {
      const [ok, err] = standards.validateStdTable({
        globals: { foo: { fields: { bar: 12345 as unknown as FieldDef } } },
      });
      assertEquals(ok, false);
      assertEquals(
        err,
        "in field .globals.foo.fields.bar: field description table expected, got number",
      );
    });

    await t.step("returns true if argument std table is valid", () => {
      assertEquals(standards.validateStdTable({})[0], true);
      assertEquals(
        standards.validateStdTable({ unrelated: 123 } as StdTable)[0],
        true,
      );
      assertEquals(
        standards.validateStdTable({
          globals: {
            "1": "foo",
            bar: { read_only: true, other_fields: false },
          },
        })[0],
        true,
      );
    });
  });

  await t.step("add_std_table", async (t) => {
    await t.step("adds two empty stds", () => {
      const fstd: FieldDef = {};
      standards.addStdTable(fstd, {});
      assertEquals(fstd, {});
    });

    await t.step("when merging trees", async (t) => {
      function makeTreeAndStd(): { tree: FieldDef; std: StdTable } {
        const tree: FieldDef = {
          fields: {
            foo: {
              read_only: false,
              other_fields: true,
              fields: {
                nested: { read_only: true },
              },
            },
          },
        };

        const std: StdTable = {
          read_globals: {
            foo: {
              other_fields: false,
              fields: {
                nested: { other_fields: true },
                nested2: {},
              },
            },
          },
          globals: { "1": "bar" },
        };

        return { tree, std };
      }

      await t.step("merges in a tree", () => {
        const { tree, std } = makeTreeAndStd();
        standards.addStdTable(tree, std);

        assertEquals(tree, {
          fields: {
            foo: {
              read_only: false,
              other_fields: true,
              fields: {
                nested: { read_only: true, other_fields: true },
                nested2: {},
              },
            },
            bar: { read_only: false, other_fields: true },
          },
        });
      });

      await t.step(
        "merges in a tree and overwrites fields with overwrite = true",
        () => {
          const { tree, std } = makeTreeAndStd();
          standards.addStdTable(tree, std, true);

          assertEquals(tree, {
            fields: {
              foo: {
                read_only: true,
                other_fields: false,
                fields: {
                  nested: { read_only: true, other_fields: true },
                  nested2: {},
                },
              },
              bar: { read_only: false, other_fields: true },
            },
          });
        },
      );

      await t.step("can ignore top-level array part of std", () => {
        const { tree, std } = makeTreeAndStd();
        standards.addStdTable(tree, std, true, true);

        assertEquals(tree, {
          fields: {
            foo: {
              read_only: true,
              other_fields: false,
              fields: {
                nested: { read_only: true, other_fields: true },
                nested2: {},
              },
            },
          },
        });
      });
    });
  });

  await t.step("overwrite_field", async (t) => {
    await t.step("adds definition of a field if it does not exist", () => {
      const tree: FieldDef = {
        fields: {
          foo: {},
        },
      };

      standards.overwriteField(tree, ["foo", "bar"], false);

      assertEquals(tree, {
        fields: {
          foo: {
            fields: {
              bar: { other_fields: true, read_only: false },
            },
          },
        },
      });
    });

    await t.step("overwrites existing definitions", () => {
      const tree: FieldDef = {
        fields: {
          foo: {
            fields: {
              bar: { other_fields: false, read_only: false, fields: { k: {} } },
            },
          },
        },
      };

      standards.overwriteField(tree, ["foo", "bar"], true);

      assertEquals(tree, {
        fields: {
          foo: {
            fields: {
              bar: { other_fields: true, read_only: true },
            },
          },
        },
      });
    });
  });

  await t.step("remove_field", async (t) => {
    await t.step("removes definition of a field if it exists", () => {
      const tree: FieldDef = {
        fields: {
          foo: {
            fields: {
              bar: { other_fields: false, read_only: false },
              baz: {},
            },
          },
        },
      };

      standards.removeField(tree, ["foo", "bar"]);

      assertEquals(tree, {
        fields: {
          foo: {
            fields: {
              baz: {},
            },
          },
        },
      });
    });

    await t.step("does nothing if definition does not exist already", () => {
      const tree: FieldDef = {
        fields: {
          foo: {
            fields: {
              bar: { other_fields: false, read_only: false },
            },
          },
        },
      };

      standards.removeField(tree, ["foo", "baz"]);

      assertEquals(tree, {
        fields: {
          foo: {
            fields: {
              bar: { other_fields: false, read_only: false },
            },
          },
        },
      });
    });
  });

  await t.step("finalize", async (t) => {
    await t.step(
      "annotates nodes without writable fields with deep_read_only = true",
      () => {
        const tree: FieldDef = {
          read_only: true,
          fields: {
            foo: {
              read_only: false,
              fields: {
                nested: { other_fields: true },
              },
            },
            bar: {
              fields: { one: { other_fields: true }, another: {} },
            },
          },
        };

        standards.finalize(tree);

        assertEquals(tree, {
          read_only: true,
          fields: {
            foo: {
              read_only: false,
              fields: {
                nested: { other_fields: true },
              },
            },
            bar: {
              deep_read_only: true,
              fields: {
                one: { deep_read_only: true, other_fields: true },
                another: { deep_read_only: true },
              },
            },
          },
        });
      },
    );
  });

  await t.step("def_fields", async (t) => {
    await t.step(
      "returns a definition table containing empty fields with given names",
      () => {
        assertEquals(standards.defFields("foo", "bar"), {
          fields: {
            foo: {},
            bar: {},
          },
        });
      },
    );
  });
});
