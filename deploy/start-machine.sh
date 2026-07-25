#!/usr/bin/env bash
set -euo pipefail

export YES_PUSHER_NETWORK_MODE="server"
export YES_PUSHER_TRANSPORT="${YES_PUSHER_TRANSPORT:-websocket}"
export YES_PUSHER_SERVER_BIND="${YES_PUSHER_SERVER_BIND:-*}"
export YES_PUSHER_SERVER_PORT="${PORT:-${YES_PUSHER_SERVER_PORT:-8787}}"
export YES_PUSHER_STATE_PATH="${YES_PUSHER_STATE_PATH:-/data/yes-pusher-shared-state.json}"
export HOME="${HOME:-/data/godot-home}"

mkdir -p "$(dirname "$YES_PUSHER_STATE_PATH")" "$HOME"

# The image build generates this cache. Rebuild it defensively if a future
# image or mount removes it, otherwise class_name references fail at startup.
if [[ ! -f /app/.godot/global_script_class_cache.cfg ]]; then
  echo "Godot global class cache missing; importing project before startup"
  godot --headless --path /app --import
fi

echo "Starting YES Pusher authoritative machine on port ${YES_PUSHER_SERVER_PORT}"
echo "Persistent state: ${YES_PUSHER_STATE_PATH}"

exec godot --headless --path /app -- --server
