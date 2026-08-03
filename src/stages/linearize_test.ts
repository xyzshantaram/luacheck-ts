/**
 * Ported busted spec: .reference/luacheck/spec/linearize_spec.lua
 *
 * One Deno test per busted `describe` block, with one `t.step` per busted
 * `it` block (same convention as standards_test.ts/options_test.ts/
 * parser_test.ts).
 *
 * `helper.get_chstate_after_stage("linearize", src)` runs the pipeline up
 * to and including linearize, clearing `chstate.warnings` after each
 * earlier stage so only linearize's own warnings survive; `getLine` below
 * inlines that by calling `parse.run`/`unwrap_parens.run`/`linearize.run`
 * directly, since `stages/init.ts`'s registry (ticket 4.8) doesn't exist
 * yet.
 *
 * `get_line`'s `pcall` + "return the error table if the linearizer threw a
 * structured syntax error, otherwise re-throw" is a try/catch here, using
 * `instanceof SyntaxError`/a plain shallow copy for the same reason
 * `getError` does in parser_test.ts: `assertEquals` treats different-prototype
 * objects as unequal even when their own fields match.
 */

import { assertEquals } from "@std/assert";
import { checkStateNew } from "../check_state.ts";
import { SyntaxError } from "../parser.ts";
import { run as parseRun } from "./parse.ts";
import { run as unwrapParensRun } from "./unwrap_parens.ts";
import {
  type EvalItem,
  type Item,
  type LineInstance,
  type LocalItem,
  run as linearizeRun,
  type SetItem,
  type Var,
} from "./linearize.ts";

function getChstateAfterLinearize(source: string) {
  const chstate = checkStateNew(source);
  parseRun(chstate);
  chstate.warnings = [];
  unwrapParensRun(chstate);
  chstate.warnings = [];
  linearizeRun(chstate);
  return chstate;
}

function getLineOrThrow(src: string): LineInstance {
  return getChstateAfterLinearize(src).topLine;
}

function getLine(src: string): LineInstance | Record<string, unknown> {
  try {
    return getLineOrThrow(src);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return { ...(err as Record<string, unknown>) };
    }
    throw err;
  }
}

function itemToString(item: Item): string {
  if (item.tag === "Jump" || item.tag === "Cjump") {
    return `${item.tag} -> ${item.to}`;
  } else if (item.tag === "Eval") {
    return `Eval ${(item as EvalItem).node.tag}`;
  } else if (item.tag === "Local") {
    const local = item as LocalItem;
    const length = (() => {
      let n = 0;
      while (local.lhs[String(n + 1)] !== undefined) n++;
      return n;
    })();
    const buf: string[] = [];

    for (let i = 1; i <= length; i++) {
      const node = local.lhs[String(i)] as { var: Var };
      buf.push(
        `${node.var.name} (${node.var.scopeStart}..${node.var.scopeEnd})`,
      );
    }

    return `Local ${buf.join(", ")}`;
  } else {
    return item.tag;
  }
}

function getLineAsString(src: string): string {
  const line = getLineOrThrow(src);
  const buf: string[] = [];

  for (let i = 1; i <= line.items.size; i++) {
    const item = line.items[i] as Item;
    buf.push(`${i}: ${itemToString(item)}`);
  }

  return buf.join("\n");
}

function valueInfoToString(item: LocalItem | SetItem): string {
  const buf: string[] = [];

  for (const [variable, value] of item.setVariables!) {
    let suffix = "";
    if (value.empty) suffix += ", empty";
    if (value.secondaries) {
      suffix += `, ${value.secondaries.length} secondaries`;
      if (value.secondaries.used) suffix += ", used";
    }

    buf.push(`${variable.name} (${variable.type} / ${value.type}${suffix})`);
  }

  buf.sort();
  return `${item.tag}: ${buf.join(", ")}`;
}

function getValueInfoAsString(src: string): string {
  const line = getLineOrThrow(src);
  const buf: string[] = [];

  for (let i = 1; i <= line.items.size; i++) {
    const item = line.items[i] as Item;
    if (item.tag === "Local" || item.tag === "Set") {
      buf.push(valueInfoToString(item as LocalItem | SetItem));
    }
  }

  return buf.join("\n");
}

Deno.test("linearize", async (t) => {
  await t.step("when handling post-parse syntax errors", async (t) => {
    await t.step("detects gotos without labels", () => {
      assertEquals(getLine("goto fail"), {
        line: 1,
        offset: 1,
        endOffset: 4,
        msg: "no visible label 'fail'",
      });
    });

    await t.step("detects break outside loops", () => {
      assertEquals(getLine("break"), {
        line: 1,
        offset: 1,
        endOffset: 5,
        msg: "'break' is not inside a loop",
      });
      assertEquals(
        getLine("while true do function f() break end end"),
        {
          line: 1,
          offset: 28,
          endOffset: 32,
          msg: "'break' is not inside a loop",
        },
      );
    });

    await t.step("detects duplicate labels", () => {
      assertEquals(getLine("::fail::\n::fail::"), {
        line: 2,
        offset: 10,
        endOffset: 17,
        prevLine: 1,
        prevOffset: 1,
        prevEndOffset: 8,
        msg: "label 'fail' already defined on line 1",
      });
    });

    await t.step("detects varargs outside vararg functions", () => {
      assertEquals(getLine("function f() return ... end"), {
        line: 1,
        offset: 21,
        endOffset: 23,
        msg: "cannot use '...' outside a vararg function",
      });
      assertEquals(
        getLine(
          "function f(...) return function() return ... end end",
        ),
        {
          line: 1,
          offset: 42,
          endOffset: 44,
          msg: "cannot use '...' outside a vararg function",
        },
      );
    });
  });

  await t.step("when linearizing flow", async (t) => {
    await t.step("linearizes empty source correctly", () => {
      assertEquals(getLineAsString(""), "1: Local ... (2..1)");
    });

    await t.step("linearizes do-end blocks correctly", () => {
      assertEquals(
        getLineAsString("do end\ndo print(foo) end"),
        "1: Local ... (2..4)\n2: Noop\n3: Noop\n4: Eval Call",
      );
    });

    await t.step("linearizes loops correctly", () => {
      assertEquals(
        getLineAsString(
          "while cond do\n   local s = io.read()\n   print(s)\nend",
        ),
        "1: Local ... (2..8)\n2: Noop\n3: Eval Id\n4: Cjump -> 9\n" +
          "5: Local s (6..6)\n6: Eval Call\n7: Noop\n8: Jump -> 3",
      );

      assertEquals(
        getLineAsString(
          "repeat\n   local s = io.read()\n   print(s)\nuntil cond",
        ),
        "1: Local ... (2..6)\n2: Noop\n3: Local s (4..5)\n" +
          "4: Eval Call\n5: Eval Id\n6: Cjump -> 3",
      );

      assertEquals(
        getLineAsString(
          "for i = 1, #t do\n   print(t[i])\nend",
        ),
        "1: Local ... (2..9)\n2: Noop\n3: Eval Number\n4: Eval Op\n" +
          "5: Cjump -> 10\n6: Local i (7..7)\n7: Eval Call\n8: Noop\n" +
          "9: Jump -> 5",
      );

      assertEquals(
        getLineAsString(
          "for k, v in pairs(t) do\n   print(k, v)\nend",
        ),
        "1: Local ... (2..8)\n2: Noop\n3: Eval Call\n4: Cjump -> 9\n" +
          "5: Local k (6..6), v (6..6)\n6: Eval Call\n7: Noop\n8: Jump -> 4",
      );
    });

    await t.step(
      "linearizes loops with literal condition correctly",
      () => {
        assertEquals(
          getLineAsString("while 1 do\n   foo()\nend"),
          "1: Local ... (2..6)\n2: Noop\n3: Eval Number\n" +
            "4: Eval Call\n5: Noop\n6: Jump -> 3",
        );

        assertEquals(
          getLineAsString("while false do\n   foo()\nend"),
          "1: Local ... (2..7)\n2: Noop\n3: Eval False\n4: Jump -> 8\n" +
            "5: Eval Call\n6: Noop\n7: Jump -> 3",
        );

        assertEquals(
          getLineAsString("repeat\n   foo()\nuntil true"),
          "1: Local ... (2..4)\n2: Noop\n3: Eval Call\n4: Eval True",
        );

        assertEquals(
          getLineAsString("repeat\n   foo()\nuntil nil"),
          "1: Local ... (2..5)\n2: Noop\n3: Eval Call\n4: Eval Nil\n" +
            "5: Jump -> 3",
        );
      },
    );

    await t.step("linearizes nested loops and breaks correctly", () => {
      assertEquals(
        getLineAsString(
          "while cond() do\n" +
            "   stmts()\n" +
            "\n" +
            "   while cond() do\n" +
            "      stmts()\n" +
            "\n" +
            "      if cond() then\n" +
            "         break\n" +
            "      end\n" +
            "\n" +
            "      stmts()\n" +
            "   end\n" +
            "\n" +
            "   if cond() then\n" +
            "      break\n" +
            "   end\n" +
            "end",
        ),
        "1: Local ... (2..24)\n2: Noop\n3: Eval Call\n4: Cjump -> 25\n" +
          "5: Eval Call\n6: Noop\n7: Eval Call\n8: Cjump -> 18\n" +
          "9: Eval Call\n10: Noop\n11: Eval Call\n12: Cjump -> 15\n" +
          "13: Jump -> 18\n14: Jump -> 15\n15: Eval Call\n16: Noop\n" +
          "17: Jump -> 7\n18: Noop\n19: Eval Call\n20: Cjump -> 23\n" +
          "21: Jump -> 25\n22: Jump -> 23\n23: Noop\n24: Jump -> 3",
      );
    });

    await t.step("linearizes if correctly", () => {
      assertEquals(
        getLineAsString(
          "if cond() then\n" +
            "   if cond() then\n" +
            "      stmts()\n" +
            "   elseif cond() then\n" +
            "      stmts()\n" +
            "   else\n" +
            "      stmts()\n" +
            "   end\n" +
            "end",
        ),
        "1: Local ... (2..15)\n2: Noop\n3: Eval Call\n4: Cjump -> 16\n" +
          "5: Noop\n6: Eval Call\n7: Cjump -> 10\n8: Eval Call\n" +
          "9: Jump -> 15\n10: Eval Call\n11: Cjump -> 14\n" +
          "12: Eval Call\n13: Jump -> 15\n14: Eval Call\n15: Jump -> 16",
      );
    });

    await t.step("linearizes if with literal condition correctly", () => {
      assertEquals(
        getLineAsString(
          "if true then\n" +
            "   if cond() then\n" +
            "      stmts()\n" +
            "   elseif false then\n" +
            "      stmts()\n" +
            "   else\n" +
            "      stmts()\n" +
            "   end\n" +
            "end",
        ),
        "1: Local ... (2..14)\n2: Noop\n3: Eval True\n4: Noop\n" +
          "5: Eval Call\n6: Cjump -> 9\n7: Eval Call\n8: Jump -> 14\n" +
          "9: Eval False\n10: Jump -> 13\n11: Eval Call\n12: Jump -> 14\n" +
          "13: Eval Call\n14: Jump -> 15",
      );
    });

    await t.step("linearizes gotos correctly", () => {
      assertEquals(
        getLineAsString(
          "::label1::\n" +
            "stmts()\n" +
            "goto label1\n" +
            "stmts()\n" +
            "goto label2\n" +
            "stmts()\n" +
            "::label2::\n" +
            "stmts()\n" +
            "\n" +
            "do\n" +
            "   goto label2\n" +
            "   stmts()\n" +
            "   ::label2::\n" +
            "end",
        ),
        "1: Local ... (2..13)\n2: Eval Call\n3: Noop\n4: Jump -> 2\n" +
          "5: Eval Call\n6: Noop\n7: Jump -> 9\n8: Eval Call\n" +
          "9: Eval Call\n10: Noop\n11: Noop\n12: Jump -> 14\n" +
          "13: Eval Call",
      );
    });
  });

  await t.step("when registering values", async (t) => {
    await t.step("registers values in empty chunk correctly", () => {
      assertEquals(
        getValueInfoAsString(""),
        "Local: ... (arg / arg)",
      );
    });

    await t.step("registers values in assignments correctly", () => {
      assertEquals(
        getValueInfoAsString("local a = b\na = d"),
        "Local: ... (arg / arg)\nLocal: a (var / var)\nSet: a (var / var)",
      );
    });

    await t.step("registers empty values correctly", () => {
      assertEquals(
        getValueInfoAsString("local a, b = 4\na, b = 5"),
        "Local: ... (arg / arg)\n" +
          "Local: a (var / var), b (var / var, empty)\n" +
          "Set: a (var / var), b (var / var)",
      );
    });

    await t.step("registers function values as of type func", () => {
      assertEquals(
        getValueInfoAsString("local function f() end"),
        "Local: ... (arg / arg)\nLocal: f (var / func)",
      );
    });

    await t.step(
      "registers overwritten args and counters as of type var",
      () => {
        assertEquals(
          getValueInfoAsString("for i = 1, 10 do i = 6 end"),
          "Local: ... (arg / arg)\nLocal: i (loopi / loopi)\n" +
            "Set: i (loopi / var)",
        );
      },
    );

    await t.step("registers groups of secondary values", () => {
      assertEquals(
        getValueInfoAsString(
          "local a, b, c = f(), g()\na, b, c = f(), g()",
        ),
        "Local: ... (arg / arg)\n" +
          "Local: a (var / var), b (var / var, 2 secondaries), " +
          "c (var / var, 2 secondaries)\n" +
          "Set: a (var / var), b (var / var, 2 secondaries), " +
          "c (var / var, 2 secondaries)",
      );
    });

    await t.step(
      "marks groups of secondary values used if one of values is put into global or index",
      () => {
        assertEquals(
          getValueInfoAsString("local a\ng, a = f()"),
          "Local: ... (arg / arg)\nLocal: a (var / var, empty)\n" +
            "Set: a (var / var, 1 secondaries, used)",
        );
      },
    );
  });
});
