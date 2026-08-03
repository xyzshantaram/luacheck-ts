#!/usr/bin/env bash
#
# Installs the real luacheck 1.2.0 rock into a local, project-scoped
# luarocks tree at parity-analysis/.luarocks so the system Lua install is
# not touched. Idempotent: safe to re-run.
#
# luarocks resolves and installs luacheck's own CLI dependencies (argparse,
# luafilesystem) automatically as part of this command.
set -euo pipefail

# Directory of this script (parity-analysis/), resolved from wherever the
# script is invoked.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LUAROCKS_TREE="$SCRIPT_DIR/.luarocks"

# Skip the install if the tree already contains a luacheck binary.
if [ -x "$LUAROCKS_TREE/bin/luacheck" ]; then
   echo "luacheck 1.2.0 already installed in $LUAROCKS_TREE; nothing to do."
   exit 0
fi

luarocks install --tree "$LUAROCKS_TREE" luacheck 1.2.0

echo
echo "Install complete. Source the environment before invoking luacheck:"
echo "  source $SCRIPT_DIR/lua/env.sh"
