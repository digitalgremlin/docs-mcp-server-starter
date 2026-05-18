#!/usr/bin/env bash
# Local Standby smoke test for the Docs MCP Server Starter.
# Boots the actor, waits for the MCP server, calls all four tools,
# prints results, then shuts down cleanly.
#
# Usage: ./scripts/smoke-test.sh
# Requires: apify-cli, jq (optional — falls back to raw output if missing)

set -euo pipefail

PORT="${ACTOR_STANDBY_PORT:-4321}"
LOG_FILE=$(mktemp -t docs-mcp-smoke.XXXXXX.log)
trap 'cleanup' EXIT INT TERM

cleanup() {
  if [[ -n "${ACTOR_PID:-}" ]] && kill -0 "$ACTOR_PID" 2>/dev/null; then
    echo
    echo "[smoke-test] Stopping actor (pid $ACTOR_PID)..."
    kill -TERM "$ACTOR_PID" 2>/dev/null || true
    wait "$ACTOR_PID" 2>/dev/null || true
  fi
  echo "[smoke-test] Log file: $LOG_FILE"
}

pretty() {
  if command -v jq >/dev/null 2>&1; then
    jq .
  else
    cat
  fi
}

call_mcp() {
  local label="$1" payload="$2"
  echo
  echo "── $label ──"
  curl -sS -X POST "http://localhost:${PORT}" \
    -H 'Content-Type: application/json' \
    -d "$payload" | pretty
}

cd "$(dirname "$0")/.."

echo "[smoke-test] Booting actor (logs → $LOG_FILE)..."
apify run --purge >"$LOG_FILE" 2>&1 &
ACTOR_PID=$!

echo "[smoke-test] Waiting for 'MCP server listening' (max 180s)..."
for _ in $(seq 1 180); do
  if grep -q 'MCP server listening' "$LOG_FILE" 2>/dev/null; then
    echo "[smoke-test] Server is up."
    break
  fi
  if ! kill -0 "$ACTOR_PID" 2>/dev/null; then
    echo "[smoke-test] Actor exited before server came up. Last log lines:"
    tail -40 "$LOG_FILE"
    exit 1
  fi
  sleep 1
done

if ! grep -q 'MCP server listening' "$LOG_FILE"; then
  echo "[smoke-test] Timed out waiting for MCP server. Last log lines:"
  tail -40 "$LOG_FILE"
  exit 1
fi

# initialize handshake
call_mcp "initialize" '{
  "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": { "name": "smoke-test", "version": "0.1.0" } }
}'

call_mcp "tools/list" '{
  "jsonrpc": "2.0", "id": 2, "method": "tools/list"
}'

call_mcp "tools/call → list_sources" '{
  "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": { "name": "list_sources", "arguments": {} }
}'

call_mcp "tools/call → get_toc (Next.js Docs)" '{
  "jsonrpc": "2.0", "id": 4, "method": "tools/call",
  "params": { "name": "get_toc", "arguments": { "source": "Next.js Docs" } }
}'

call_mcp "tools/call → search_docs (\"routing\")" '{
  "jsonrpc": "2.0", "id": 5, "method": "tools/call",
  "params": { "name": "search_docs", "arguments": { "query": "routing", "maxResults": 3 } }
}'

# get_page: pull a real URL out of the get_toc response so the test is data-driven
FIRST_URL=$(curl -sS -X POST "http://localhost:${PORT}" \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0", "id": 99, "method": "tools/call",
    "params": { "name": "get_toc", "arguments": { "source": "Next.js Docs" } }
  }' \
  | (command -v jq >/dev/null 2>&1 \
      && jq -r '.result.content[0].text | fromjson | .pages[0].url // empty' \
      || true))

if [[ -n "$FIRST_URL" ]]; then
  call_mcp "tools/call → get_page ($FIRST_URL)" "$(printf '{
    "jsonrpc": "2.0", "id": 6, "method": "tools/call",
    "params": { "name": "get_page", "arguments": { "url": "%s" } }
  }' "$FIRST_URL")"
else
  echo
  echo "[smoke-test] Skipping get_page (no URL extracted — install jq for full coverage)."
fi

echo
echo "[smoke-test] All MCP tool calls returned. Inspect output above for correctness."
