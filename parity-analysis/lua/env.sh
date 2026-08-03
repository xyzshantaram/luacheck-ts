# Environment for the real-luacheck parity harness.
#
# Source this file, not execute it:
#   source parity-analysis/lua/env.sh
#
# It sets PATH/LUA_PATH/LUA_CPATH for the local luarocks tree (installed by
# parity-analysis/setup.sh) and puts parity-analysis/lua/ on LUA_PATH so the
# custom json_formatter module is requireable by its bare module name.

# Directory of this script (parity-analysis/lua/). BASH_SOURCE is used
# instead of $0 because this file is sourced, not executed.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PARITY_DIR="$(dirname "$SCRIPT_DIR")"

# Point PATH/LUA_PATH/LUA_CPATH at the local luarocks tree.
eval "$(luarocks path --tree "$PARITY_DIR/.luarocks")"

# Put the custom formatter module first on LUA_PATH.
export LUA_PATH="$SCRIPT_DIR/?.lua;$LUA_PATH"
