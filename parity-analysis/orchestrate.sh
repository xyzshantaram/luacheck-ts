#!/usr/bin/env bash
#
# Runs both parity engines over the corpus and diffs their reports.
#
# This is the single reusable command for ticket 6.5.3. It runs the real
# luacheck CLI over every corpus file, times it, runs the TS port over the
# same files in the same order, times it, and diffs the two JSON reports
# per file. See parity-analysis/ts/diff.ts for the comparison rule.
#
# Real luacheck exits nonzero when it finds warnings. That is normal here.
# The invocations below therefore run with set -e disabled.
#
# The script exits 0 when every file matches and nonzero otherwise. The
# exit code of diff.ts becomes the exit code of this script.
set -euo pipefail

# Directory of this script (parity-analysis/). Resolved from wherever the
# script is invoked. ORCH_DIR is used instead of SCRIPT_DIR because
# lua/env.sh overwrites SCRIPT_DIR when sourced.
ORCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Point PATH/LUA_PATH/LUA_CPATH at the local luarocks tree.
source "$ORCH_DIR/lua/env.sh"

# Every corpus file, in sorted glob order. The same order goes to both
# sides, so the reports line up by index.
CORPUS=( "$ORCH_DIR"/corpus/*.lua )

if [ "${#CORPUS[@]}" -eq 0 ]; then
   echo "error: no Lua files found in $ORCH_DIR/corpus/" >&2
   exit 2
fi

echo "Corpus (${#CORPUS[@]} files): ${CORPUS[*]}"

# One temp dir holds both reports. The diff script reads it with a narrow
# --allow-read scope. The dir is removed on exit.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

REAL_REPORT="$TMP_DIR/real-luacheck.json"
TS_REPORT="$TMP_DIR/ts-port.json"

# Real luacheck. Nonzero exit means warnings were found, which is normal,
# so the exit code is not checked. A crash instead produces unparseable
# output, which diff.ts reports loudly.
set +e
REAL_START="$(date +%s%N)"
luacheck --formatter json_formatter --std lua54 --no-config --no-cache "${CORPUS[@]}" > "$REAL_REPORT"
REAL_END="$(date +%s%N)"
set -e

# TS port. A nonzero exit here is a real failure, not a normal case.
set +e
TS_START="$(date +%s%N)"
deno run --allow-read="$ORCH_DIR/corpus" "$ORCH_DIR/ts/run.ts" "${CORPUS[@]}" > "$TS_REPORT"
TS_RC=$?
TS_END="$(date +%s%N)"
set -e

if [ "$TS_RC" -ne 0 ]; then
   echo "error: TS port invocation failed with exit code $TS_RC" >&2
   exit 2
fi

# Wall-clock times, in whole milliseconds.
REAL_MS=$(( (REAL_END - REAL_START) / 1000000 ))
TS_MS=$(( (TS_END - TS_START) / 1000000 ))

# The diff tool prints per-file results and the aggregate summary. Its
# exit code becomes this script's exit code.
set +e
deno run --allow-read="$TMP_DIR" "$ORCH_DIR/ts/diff.ts" "$REAL_REPORT" "$TS_REPORT"
DIFF_RC=$?
set -e

echo
echo "Real luacheck: ${REAL_MS} ms"
echo "TS port: ${TS_MS} ms"

if [ "$TS_MS" -gt 0 ]; then
   DELTA=$(( REAL_MS - TS_MS ))
   RATIO="$(awk -v a="$REAL_MS" -v b="$TS_MS" 'BEGIN { printf "%.2f", a / b }')"
   echo "TS port time is ${RATIO}x the real luacheck time (delta ${DELTA} ms)"
else
   echo "TS port time was too small to measure; no ratio computed"
fi

exit "$DIFF_RC"
