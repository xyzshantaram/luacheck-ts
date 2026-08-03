// Compares two parity JSON report files and prints a per-file diff.
//
// This script is the diffing half of the parity orchestrator. The bash
// script parity-analysis/orchestrate.sh writes both side reports to
// files, then invokes this script with both file paths. This script does
// not measure time. The bash script measures time.
//
// Each report file is a JSON array with one entry per file. Each entry
// holds the file name and its warnings. A warning has code, line, column,
// and message fields. The Lua formatter and run.ts both emit this shape.
//
// Comparison rule (explicit project decision): two warnings match when
// their message, line, and column are equal. The code field is never
// compared. The warning lists are compared as multisets. A different
// order inside either list is tolerated. Only presence or absence
// differences are reported.
//
// Exit codes:
//   0 - every file matches.
//   1 - at least one file has a warning mismatch.
//   2 - the file lists disagree, or a report file cannot be read or
//       parsed. This is an orchestrator bug, not a parity finding.
//
// Usage:
//   deno run --allow-read=<report dir> parity-analysis/ts/diff.ts \
//     <real-luacheck report> <TS-port report>

interface WarningJson {
  code: number | string;
  line: number;
  column: number;
  message: string;
}

interface FileEntryJson {
  filename: string;
  warnings: WarningJson[];
}

interface WarningGroup {
  warning: WarningJson;
  count: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function die(message: string): never {
  console.error(`error: ${message}`);
  Deno.exit(2);
}

function isFileEntry(value: unknown): value is FileEntryJson {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const entry = value as Record<string, unknown>;

  return typeof entry.filename === "string" && Array.isArray(entry.warnings);
}

function isWarning(value: unknown): value is WarningJson {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const warning = value as Record<string, unknown>;

  return typeof warning.message === "string" &&
    typeof warning.line === "number" &&
    typeof warning.column === "number";
}

async function readReport(path: string): Promise<FileEntryJson[]> {
  let text: string;

  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    die(`cannot read report file ${path}: ${errorMessage(error)}`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    die(`cannot parse report file ${path}: ${errorMessage(error)}`);
  }

  if (!Array.isArray(parsed)) {
    die(`report file ${path} does not contain a JSON array`);
  }

  const report: FileEntryJson[] = [];

  for (const entry of parsed) {
    if (!isFileEntry(entry)) {
      die(`report file ${path} has a malformed file entry`);
    }

    for (const warning of entry.warnings) {
      if (!isWarning(warning)) {
        die(`report file ${path} has a malformed warning in ${entry.filename}`);
      }
    }

    report.push(entry);
  }

  return report;
}

function warningKey(warning: WarningJson): string {
  return JSON.stringify([warning.message, warning.line, warning.column]);
}

function groupWarnings(
  warnings: WarningJson[],
): Map<string, WarningGroup> {
  const groups = new Map<string, WarningGroup>();

  for (const warning of warnings) {
    const key = warningKey(warning);
    const group = groups.get(key);

    if (group) {
      group.count += 1;
    } else {
      groups.set(key, { warning, count: 1 });
    }
  }

  return groups;
}

function describeWarning(warning: WarningJson): string {
  return `line ${warning.line}, column ${warning.column}, message ${
    JSON.stringify(warning.message)
  }`;
}

if (Deno.args.length !== 2) {
  die(
    "expected exactly two report file paths: <real-luacheck report> <TS-port report>",
  );
}

const realReport = await readReport(Deno.args[0]);
const tsReport = await readReport(Deno.args[1]);

// The file lists must agree exactly. A difference here means the two
// sides were invoked with different files, which is an orchestrator bug.
if (realReport.length !== tsReport.length) {
  die(
    `file count mismatch: real luacheck reports ${realReport.length} files, ` +
      `TS port reports ${tsReport.length} files`,
  );
}

for (let i = 0; i < realReport.length; i += 1) {
  if (realReport[i].filename !== tsReport[i].filename) {
    die(
      `file name mismatch at index ${i}: real luacheck has ` +
        `"${realReport[i].filename}", TS port has "${tsReport[i].filename}"`,
    );
  }
}

let filesPassed = 0;
let filesFailed = 0;
let realWarningTotal = 0;
let tsWarningTotal = 0;

for (let i = 0; i < realReport.length; i += 1) {
  const realWarnings = realReport[i].warnings;
  const tsWarnings = tsReport[i].warnings;

  realWarningTotal += realWarnings.length;
  tsWarningTotal += tsWarnings.length;

  const realGroups = groupWarnings(realWarnings);
  const tsGroups = groupWarnings(tsWarnings);

  const realOnly: WarningGroup[] = [];
  const tsOnly: WarningGroup[] = [];

  for (const [key, group] of realGroups) {
    const otherCount = tsGroups.get(key)?.count ?? 0;

    if (group.count > otherCount) {
      realOnly.push({
        warning: group.warning,
        count: group.count - otherCount,
      });
    }
  }

  for (const [key, group] of tsGroups) {
    const otherCount = realGroups.get(key)?.count ?? 0;

    if (group.count > otherCount) {
      tsOnly.push({
        warning: group.warning,
        count: group.count - otherCount,
      });
    }
  }

  const filename = realReport[i].filename;

  if (realOnly.length === 0 && tsOnly.length === 0) {
    filesPassed += 1;
    console.log(`PASS  ${filename}`);
    continue;
  }

  filesFailed += 1;
  console.log(`FAIL  ${filename}`);

  for (const group of realOnly) {
    const extra = group.count > 1 ? ` (${group.count} extra)` : "";

    console.log(
      `  only in real luacheck${extra}: ${describeWarning(group.warning)}`,
    );
  }

  for (const group of tsOnly) {
    const extra = group.count > 1 ? ` (${group.count} extra)` : "";

    console.log(
      `  only in TS port${extra}: ${describeWarning(group.warning)}`,
    );
  }
}

console.log("");
console.log(
  `Summary: ${realReport.length} files, ${filesPassed} passed, ${filesFailed} failed`,
);
console.log(
  `Warnings: ${realWarningTotal} in real luacheck, ${tsWarningTotal} in TS port`,
);

Deno.exit(filesFailed === 0 ? 0 : 1);
