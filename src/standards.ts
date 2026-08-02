/**
 * Ported from luacheck's standards.lua: generic std-table helpers used to
 * validate, merge, and normalize the trees that describe allowed globals
 * and their fields (see `builtin_standards.ts` for the concrete Lua 5.4
 * data built on top of this module).
 *
 * Table/object keys that are part of the data format itself (`fields`,
 * `read_only`, `other_fields`, `deep_read_only`, `globals`, `read_globals`)
 * are kept as the original snake_case names: they mirror luacheck's public
 * option/config format 1:1 (see PLAN.md's public API decision), not
 * internal identifiers. Only function/variable names are camelCased.
 *
 * A Lua fields table may have non-string keys, whose values are then plain
 * field-name strings (`{fields = {"foo"}}` is sugar for
 * `{fields = {foo = {other_fields = true}}}`). Since JS object keys are
 * always strings, that "array part" is represented here as an entry whose
 * *key* is a canonical decimal-integer string ("0", "1", "2", ...) and
 * whose *value* is the field name, matching the array-part convention
 * already established for AST nodes in parser.ts.
 */

export interface FieldDef {
  read_only?: boolean;
  other_fields?: boolean;
  fields?: FieldsTable;
  deep_read_only?: boolean;
}

export type FieldsTable = Record<string, FieldDef | string>;

export interface StdTable {
  globals?: FieldsTable;
  read_globals?: FieldsTable;
}

function luaType(value: unknown): string {
  if (value === undefined || value === null) return "nil";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "function") return "function";
  return "table";
}

function isArrayIndexKey(key: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(key);
}

/**
 * Validates an optional table mapping field names to field definitions or non-string keys to names.
 * `index` is an optional string specifying position of the field table in the root table.
 * Returns true if the table is valid, false, an error message, and index of the table with the error otherwise.
 */
function validateFields(
  fields: FieldsTable | undefined,
  isRoot: boolean,
  index?: string,
): [boolean, string?, string?] {
  if (fields === undefined) {
    return [true];
  }

  const fieldType = isRoot ? "global" : "field";

  if (luaType(fields) !== "table") {
    return [
      false,
      `${fieldType}s table expected, got ${luaType(fields)}`,
      index,
    ];
  }

  for (const [key, value] of Object.entries(fields)) {
    if (!isArrayIndexKey(key)) {
      const newIndex = `${index ?? ""}.${key}`;

      if (luaType(value) !== "table") {
        return [
          false,
          `${fieldType} description table expected, got ${luaType(value)}`,
          newIndex,
        ];
      }

      const fieldDef = value as FieldDef;

      if (
        fieldDef.read_only !== undefined &&
        typeof fieldDef.read_only !== "boolean"
      ) {
        const err =
          `invalid value of option 'read_only': boolean expected, got ${
            luaType(fieldDef.read_only)
          }`;
        return [false, err, newIndex];
      }

      if (
        fieldDef.other_fields !== undefined &&
        typeof fieldDef.other_fields !== "boolean"
      ) {
        const err =
          `invalid value of option 'other_fields': boolean expected, got ${
            luaType(fieldDef.other_fields)
          }`;
        return [false, err, newIndex];
      }

      const [ok, err, errIndex] = validateFields(
        fieldDef.fields,
        false,
        `${newIndex}.fields`,
      );

      if (!ok) {
        return [false, err, errIndex];
      }
    } else if (typeof value !== "string") {
      const newIndex = `${index ?? ""}[${key}]`;
      return [
        false,
        `string expected as ${fieldType} name, got ${luaType(value)}`,
        newIndex,
      ];
    }
  }

  return [true];
}

/** Validates a field table. Returns true if the table is valid, false and an error message otherwise. */
export function validateGlobalsTable(
  globalsTable?: FieldsTable,
): [boolean, string?] {
  const [ok, err, errIndex] = validateFields(globalsTable, true);

  if (ok) {
    return [true];
  }

  const errPrefix = errIndex ? `in field ${errIndex}: ` : "";
  return [false, errPrefix + err];
}

/** Validates an std table in user-side format. Returns true if the table is valid, false and an error message otherwise. */
export function validateStdTable(stdTable: StdTable): [boolean, string?] {
  let [ok, err, errIndex] = validateFields(stdTable.globals, true, ".globals");

  if (ok) {
    [ok, err, errIndex] = validateFields(
      stdTable.read_globals,
      true,
      ".read_globals",
    );
  }

  if (ok) {
    return [true];
  }

  const errPrefix = `in field ${errIndex}: `;
  return [false, errPrefix + err];
}

const infinitelyIndexableDef: FieldDef = { other_fields: true };

function addFields(
  def: FieldDef,
  fields: FieldsTable | undefined,
  overwrite: boolean | undefined,
  ignoreArrayPart: boolean,
  defaultReadOnly: boolean | undefined,
): void {
  if (!fields) {
    return;
  }

  for (const [key, rawFieldDef] of Object.entries(fields)) {
    const isArrayEntry = isArrayIndexKey(key);

    if (isArrayEntry && ignoreArrayPart) {
      continue;
    }

    const fieldName = isArrayEntry ? (rawFieldDef as string) : key;
    const fieldDef = isArrayEntry
      ? infinitelyIndexableDef
      : (rawFieldDef as FieldDef);

    if (!def.fields) {
      def.fields = {};
    }

    if (def.fields[fieldName] === undefined) {
      def.fields[fieldName] = {};
    }

    const existingFieldDef = def.fields[fieldName] as FieldDef;
    let newReadOnly = fieldDef.read_only;

    if (newReadOnly === undefined) {
      newReadOnly = defaultReadOnly;
    }

    if (newReadOnly !== undefined) {
      if (overwrite || newReadOnly === false) {
        existingFieldDef.read_only = newReadOnly;
      }
    }

    if (fieldDef.other_fields !== undefined) {
      if (overwrite || fieldDef.other_fields === true) {
        existingFieldDef.other_fields = fieldDef.other_fields;
      }
    }

    addFields(existingFieldDef, fieldDef.fields, overwrite, false, undefined);
  }
}

/**
 * Merges in an std table in user-side format.
 * By default the new state of normalized std is a union of the standard tables being merged,
 * e.g. if either table allows some field to be mutated, result should allow it, too.
 * If `overwrite` is truthy, read-only statuses from the new std table overwrite existing values.
 * If `ignoreTopArrayPart` is truthy, non-string keys in `globals` and `read_globals` tables
 * in `stdTable` are not processed.
 */
export function addStdTable(
  finalStd: FieldDef,
  stdTable: StdTable,
  overwrite?: boolean,
  ignoreTopArrayPart?: boolean,
): void {
  addFields(finalStd, stdTable.globals, overwrite, !!ignoreTopArrayPart, false);
  addFields(
    finalStd,
    stdTable.read_globals,
    overwrite,
    !!ignoreTopArrayPart,
    true,
  );
}

/**
 * Overwrites or adds definition of a field with given read-only status and any nested keys.
 * Field is specified as an array of field names.
 */
export function overwriteField(
  finalStd: FieldDef,
  fieldNames: string[],
  readOnly: boolean,
): void {
  let fieldDef = finalStd;

  for (const fieldName of fieldNames) {
    if (!fieldDef.fields) {
      fieldDef.fields = {};
    }

    if (fieldDef.fields[fieldName] === undefined) {
      fieldDef.fields[fieldName] = { read_only: readOnly };
    }

    fieldDef = fieldDef.fields[fieldName] as FieldDef;
  }

  for (const key of Object.keys(fieldDef)) {
    delete (fieldDef as Record<string, unknown>)[key];
  }

  fieldDef.read_only = readOnly;
  fieldDef.other_fields = true;
}

/**
 * Removes definition of a field from a normalized std table.
 * Field is specified as an array of field names.
 */
export function removeField(finalStd: FieldDef, fieldNames: string[]): void {
  let fieldDef = finalStd;
  let parentDef: FieldDef | undefined;

  for (const fieldName of fieldNames) {
    parentDef = fieldDef;

    if (!fieldDef.fields || fieldDef.fields[fieldName] === undefined) {
      return;
    }

    fieldDef = fieldDef.fields[fieldName] as FieldDef;
  }

  if (parentDef) {
    delete parentDef.fields![fieldNames[fieldNames.length - 1]];
  }
}

function inferDeepReadOnlyStatuses(def: FieldDef, readOnly: boolean): void {
  let deepReadOnly = !def.other_fields || readOnly;

  if (def.fields) {
    for (const rawFieldDef of Object.values(def.fields)) {
      const fieldDef = rawFieldDef as FieldDef;
      let fieldReadOnly = readOnly;

      if (fieldDef.read_only !== undefined) {
        fieldReadOnly = fieldDef.read_only;
      }

      inferDeepReadOnlyStatuses(fieldDef, fieldReadOnly);
      deepReadOnly = deepReadOnly && fieldReadOnly && !!fieldDef.deep_read_only;
    }
  }

  if (deepReadOnly) {
    def.deep_read_only = true;
  }
}

/**
 * Finishes building a normalized std tables.
 * Adds `deep_read_only` fields with `true` value to definition tables
 * that do not have any writable fields, recursively.
 */
export function finalize(finalStd: FieldDef): void {
  inferDeepReadOnlyStatuses(finalStd, true);
}

const empty: FieldDef = {};

/** Returns a definition table containing empty fields with given names. */
export function defFields(...fields: string[]): FieldDef {
  const result: FieldsTable = {};

  for (const field of fields) {
    result[field] = empty;
  }

  return { fields: result };
}
