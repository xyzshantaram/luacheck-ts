/**
 * Ported busted spec: .reference/luacheck/spec/resolve_locals_spec.lua
 *
 * One Deno test per busted `describe` block, with one `t.step` per busted
 * `it` block (same convention as linearize_test.ts).
 *
 * `helper.get_chstate_after_stage("resolve_locals", src)` runs the
 * pipeline up to and including resolve_locals; `getChstateAfterResolveLocals`
 * below inlines that by calling `parse.run`/`unwrap_parens.run`/
 * `linearize.run`/`resolve_locals.run` directly, since `stages/init.ts`'s
 * registry (ticket 4.8) doesn't exist yet.
 *
 * The spec's own `used_variables_to_string`/`get_used_variables_as_string`
 * locals are ported as `usedVariablesToString`/`getUsedVariablesAsString`
 * below, translating `value.var_node` to `value.varNode`,
 * `chstate:offset_to_column` to `chstate.offsetToColumn`,
 * `item.used_values` to `item.usedValues`, `chstate.top_line.items` to
 * `chstate.topLine.items` (a `Stack`, walked 1-based like linearize.ts's
 * own `for (let i = 1; i <= line.items.size; i++)` loops, not a plain JS
 * array), and `item.accesses`/`next(item.accesses)` to
 * `"accesses" in item && item.accesses.size > 0` (`Item`'s `Jump`/`Cjump`/
 * `Noop` variants have no `accesses` field at all in this port, matching
 * the Lua `item.accesses` truthiness check; the remaining variants'
 * `accesses` is always a `Map`, never `nil`, so only the emptiness half of
 * the original check needs a `.size` read). `var.name` is unchanged.
 *
 * `run` from ./resolve_locals.ts does not exist yet (ticket 4.3's
 * implementation dispatch adds it); a throwing placeholder stands in so
 * this file type-checks - `deno test` failing here is expected.
 *
 * Porter's flag for the implementation dispatch: resolve_locals.lua's
 * closure-propagation direction is easy to get backwards from the prose
 * alone. `propagate_main_assignments` walks *forward* from an assignment's
 * own item (`i + 1`) to find accesses/closures it can reach, including
 * closures created *after* the assignment. `propagate_closure_creations`
 * instead walks forward from the item a closure is *created* at (index
 * `i`, not `i + 1`, since the closure is "live" starting at its own
 * creation item) to find *later* accesses/assignments it can reach - but
 * `cross_resolve_closures` (called from inside the closure-creation walk)
 * connects that closure with *every* other closure created in the same
 * reached item symmetrically, in both directions, regardless of which one
 * was created first textually. There is no backward walk anywhere: values
 * are connected to accesses that can be reached by forward flow-graph
 * propagation from the assignment or closure-creation site, never the
 * reverse, which is what makes `main_assignment_propagation_callback`'s
 * `overwriting_item`/exit-condition bookkeeping (not just the entrance
 * condition) load-bearing - it is the only mechanism that stops a live
 * value from being treated as reaching past a later assignment that
 * overwrites it.
 */

import { assertEquals } from "@std/assert";
import { checkStateNew } from "../check_state.ts";
import type { CheckStateInstance } from "../check_state.ts";
import { run as parseRun } from "./parse.ts";
import { run as unwrapParensRun } from "./unwrap_parens.ts";
import { run as linearizeRun } from "./linearize.ts";
import type { Item, ScanningItem } from "./linearize.ts";
import { run as resolveLocalsRun } from "./resolve_locals.ts";

function getChstateAfterResolveLocals(source: string): CheckStateInstance {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  chstate.warnings = [];
  unwrapParensRun(chstate);
  chstate.warnings = [];
  linearizeRun(chstate);
  chstate.warnings = [];
  resolveLocalsRun(chstate);
  return chstate;
}

function usedVariablesToString(
  chstate: CheckStateInstance,
  item: ScanningItem,
): string {
  const buf: string[] = [];

  for (const [variable, values] of item.usedValues) {
    const valuesBuf: string[] = [];

    for (const value of values) {
      const line = value.varNode.line as number;
      const column = chstate.offsetToColumn(
        line,
        value.varNode.offset as number,
      );
      valuesBuf.push(`${line}:${column}`);
    }

    buf.push(`${variable.name} = (${valuesBuf.join(", ")})`);
  }

  buf.sort();
  return `${item.tag}: ${buf.join("; ")}`;
}

function getUsedVariablesAsString(source: string): string {
  const chstate = getChstateAfterResolveLocals(source);
  const buf: string[] = [];

  for (let i = 1; i <= chstate.topLine.items.size; i++) {
    const item = chstate.topLine.items[i] as Item;

    if ("accesses" in item && item.accesses.size > 0) {
      buf.push(usedVariablesToString(chstate, item));
    }
  }

  return buf.join("\n");
}

Deno.test("resolve_locals", async (t) => {
  await t.step("when resolving values", async (t) => {
    await t.step("resolves values in linear cases", () => {
      assertEquals(
        getUsedVariablesAsString("local a = 6\nprint(a)\n"),
        "Eval: a = (1:7)",
      );
    });

    await t.step("resolves values after ifs", () => {
      assertEquals(
        getUsedVariablesAsString(
          "local a\n\nif expr then\n   a = 5\nend\n\nprint(a)\n",
        ),
        "Eval: a = (1:7, 4:4)",
      );

      assertEquals(
        getUsedVariablesAsString(
          "local a = 3\n\nif expr then\n   a = 4\nelseif expr then\n" +
            "   a = 5\n   a = 8\n\n   if expr then\n      a = 7\n   end\n" +
            "else\n   a = 6\nend\n\nprint(a)\n",
        ),
        "Eval: a = (4:4, 7:4, 10:7, 13:4)",
      );
    });

    await t.step("resolves values after loops", () => {
      assertEquals(
        getUsedVariablesAsString(
          "local a\n\nwhile not a do\n   if expr then\n" +
            "      a = expr2\n   end\nend\n\nprint(a)\n",
        ),
        "Eval: a = (1:7, 5:7)\nEval: a = (1:7, 5:7)",
      );

      assertEquals(
        getUsedVariablesAsString(
          "local a, b = 1, 2\nfor k, v in pairs(t) do\n   a = k\n\n" +
            "   if v then\n      print(a, b)\n   end\nend\n\nprint(a, b)\n",
        ),
        "Set: k = (2:5)\nEval: v = (2:8)\nEval: a = (3:4); b = (1:10)\n" +
          "Eval: a = (1:7, 3:4); b = (1:10)",
      );
    });
  });

  await t.step("when resolving upvalues", async (t) => {
    await t.step("resolves set upvalues naively", () => {
      assertEquals(
        getUsedVariablesAsString(
          "local a\n\nlocal function f()\n   a = 5\nend\n\nf()\nprint(a)\n",
        ),
        "Eval: f = (3:16)\nEval: a = (1:7, 4:4)",
      );
    });

    await t.step("naively determines where closure is live", () => {
      assertEquals(
        getUsedVariablesAsString(
          "local a = 4\n\nprint(a)\n\nlocal function f()\n   a = 5\nend\n\n" +
            "print(a)\n",
        ),
        "Eval: a = (1:7)\nEval: a = (1:7, 6:4)",
      );
    });

    await t.step("naively determines where closure is live in loops", () => {
      assertEquals(
        getUsedVariablesAsString(
          "local a = 4\n\nrepeat\n   print(a)\n\n" +
            "   escape(function() a = 5 end)\nuntil a\n",
        ),
        "Eval: a = (1:7, 6:22)\nEval: a = (1:7, 6:22)",
      );
    });
  });
});
