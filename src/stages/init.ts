/**
 * Ported from luacheck's stages/init.lua: the stage registry that drives
 * the whole check pipeline. It lists the 18 stages in run order, imports
 * their modules, merges every stage's `warnings` export (plus the two
 * non-stage codes "011" and "631") into one `stages.warnings` lookup, and
 * exposes `stages.run` to run every stage module against a check state in
 * order. It does not read `chstate` fields itself; each stage module reads
 * and writes the fields it needs.
 */

import type { CheckStateInstance, Warning } from "../check_state.ts";

import * as parseModule from "./parse.ts";
import * as unwrapParensModule from "./unwrap_parens.ts";
import * as linearizeModule from "./linearize.ts";
import * as parseInlineOptionsModule from "./parse_inline_options.ts";
import * as nameFunctionsModule from "./name_functions.ts";
import * as resolveLocalsModule from "./resolve_locals.ts";
import * as detectBadWhitespaceModule from "./detect_bad_whitespace.ts";
import * as detectCompoundOperatorsModule from "./detect_compound_operators.ts";
import * as detectCyclomaticComplexityModule from "./detect_cyclomatic_complexity.ts";
import * as detectEmptyBlocksModule from "./detect_empty_blocks.ts";
import * as detectEmptyStatementsModule from "./detect_empty_statements.ts";
import * as detectGlobalsModule from "./detect_globals.ts";
import * as detectReversedFornumLoopsModule from "./detect_reversed_fornum_loops.ts";
import * as detectUnbalancedAssignmentsModule from "./detect_unbalanced_assignments.ts";
import * as detectUninitAccessesModule from "./detect_uninit_accesses.ts";
import * as detectUnreachableCodeModule from "./detect_unreachable_code.ts";
import * as detectUnusedFieldsModule from "./detect_unused_fields.ts";
import * as detectUnusedLocalsModule from "./detect_unused_locals.ts";

interface StageWarning {
  message_format: string | ((warning: Warning) => string);
  fields: string[];
}

interface StageModule {
  run: (chstate: CheckStateInstance) => void;
  warnings?: Record<string, StageWarning>;
}

export interface StageWarningMeta {
  message_format: string | ((warning: Warning) => string);
  fields: string[];
  fields_set: Set<string>;
}

const BASE_FIELDS = ["code", "line", "column", "end_column"];

const names: string[] = [
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
];

const modules: StageModule[] = [
  parseModule,
  unwrapParensModule,
  linearizeModule,
  parseInlineOptionsModule,
  nameFunctionsModule,
  resolveLocalsModule,
  detectBadWhitespaceModule,
  detectCompoundOperatorsModule,
  detectCyclomaticComplexityModule,
  detectEmptyBlocksModule,
  detectEmptyStatementsModule,
  detectGlobalsModule,
  detectReversedFornumLoopsModule,
  detectUnbalancedAssignmentsModule,
  detectUninitAccessesModule,
  detectUnreachableCodeModule,
  detectUnusedFieldsModule,
  detectUnusedLocalsModule,
];

const warnings: Record<string, StageWarningMeta> = {};

function registerWarnings(newWarnings: Record<string, StageWarning>): void {
  for (const code of Object.keys(newWarnings)) {
    const warning = newWarnings[code];
    const fullFields = [...BASE_FIELDS, ...warning.fields];

    warnings[code] = {
      message_format: warning.message_format,
      fields: fullFields,
      fields_set: new Set(fullFields),
    };
  }
}

// Issues that do not originate from normal check stages (excluding global
// related ones).
registerWarnings({
  "011": {
    message_format: "{msg}",
    fields: ["msg", "prev_line", "prev_column", "prev_end_column"],
  },
  "631": {
    message_format: "line is too long ({end_column} > {max_length})",
    fields: ["max_length", "line_ending"],
  },
});

for (const stageModule of modules) {
  if (stageModule.warnings) {
    registerWarnings(stageModule.warnings);
  }
}

function run(chstate: CheckStateInstance): void {
  for (const stageModule of modules) {
    stageModule.run(chstate);
  }
}

export const stages: {
  names: string[];
  modules: StageModule[];
  warnings: Record<string, StageWarningMeta>;
  run: (chstate: CheckStateInstance) => void;
} = {
  names,
  modules,
  warnings,
  run,
};
