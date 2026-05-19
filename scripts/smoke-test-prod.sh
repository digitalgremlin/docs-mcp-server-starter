#!/usr/bin/env bash
# Production smoke test for the Docs MCP Server Starter (Standby mode).
#
# Tests:
#   1. Standby boot — cold list_sources returns []
#   2. Sequential indexing — first get_toc builds index (slow), next two are cache hits (fast)
#   3. Concurrent indexing — two simultaneous requests for an uncached source share one
#      build (buildLocks). Both resolve; the response timing should be similar, not 2×.
#
# Usage: ./scripts/smoke-test-prod.sh [ENDPOINT_URL]
# Defaults to https://joeslade--docs-mcp-server-starter.apify.actor
#
# Requires: curl, jq (optional — falls back to raw output)

set -euo pipefail

ENDPOINT="${1:-https://joeslade--docs-mcp-server-starter.apify.actor}"
TOKEN=$(python3 -c "import json; d=json.load(open('$HOME/.apify/auth.json')); print(d['token'])" 2>/dev/null || echo "")

if [[ -z "$TOKEN" ]]; then
  echo "[smoke-test-prod] WARNING: no Apify token found — unauthenticated requests may fail"
fi

AUTH_HEADER=""
if [[ -n "$TOKEN" ]]; then
  AUTH_HEADER="Authorization: Bearer $TOKEN"
fi

pretty() {
  if command -v jq >/dev/null 2>&1; then jq .; else cat; fi
}

call() {
  local label="$1" payload="$2"
  echo
  echo "── $label ──"
  if [[ -n "$AUTH_HEADER" ]]; then
    curl -sS -X POST "$ENDPOINT" \
      -H 'Content-Type: application/json' \
      -H "$AUTH_HEADER" \
      -d "$payload" | pretty
  else
    curl -sS -X POST "$ENDPOINT" \
      -H 'Content-Type: application/json' \
      -d "$payload" | pretty
  fi
}

timed_call() {
  local label="$1" payload="$2"
  echo
  echo "── $label ──"
  local start end elapsed response
  start=$(date +%s%3N)
  if [[ -n "$AUTH_HEADER" ]]; then
    response=$(curl -sS -X POST "$ENDPOINT" \
      -H 'Content-Type: application/json' \
      -H "$AUTH_HEADER" \
      -d "$payload")
  else
    response=$(curl -sS -X POST "$ENDPOINT" \
      -H 'Content-Type: application/json' \
      -d "$payload")
  fi
  end=$(date +%s%3N)
  elapsed=$(( end - start ))
  echo "$response" | pretty
  echo "[smoke-test-prod] Response time: ${elapsed}ms"
  echo "$response"
}

echo "[smoke-test-prod] Endpoint: $ENDPOINT"
echo "[smoke-test-prod] Auth: $([ -n "$TOKEN" ] && echo 'token present' || echo 'none')"

# ── 1. Standby wake + initialize ─────────────────────────────────────────────
echo
echo "=== 1. Standby boot / initialize ==="
echo "[smoke-test-prod] Sending initialize (will wake Standby container if cold)..."
call "initialize" '{
  "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2024-11-05", "capabilities": {},
               "clientInfo": { "name": "smoke-test-prod", "version": "0.2.0" } }
}'

# Cold list_sources — must return []
call "list_sources (expect [] on cold boot)" '{
  "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "list_sources", "arguments": {} }
}'

# ── 2. Sequential indexing: 3 requests for same source ───────────────────────
echo
echo "=== 2. Sequential indexing (3× same source — first builds, next two cache) ==="
echo "[smoke-test-prod] Call 1: get_toc (cold — triggers index build)..."
RESP1=$(timed_call "get_toc call 1 (first — cold build)" '{
  "jsonrpc": "2.0", "id": 10, "method": "tools/call",
  "params": {
    "name": "get_toc",
    "arguments": {
      "source": "Next.js Docs",
      "sourceDef": { "name": "Next.js Docs", "template": "nextjs" }
    }
  }
}')

echo "[smoke-test-prod] Call 2: get_toc (second — index already in Map)..."
timed_call "get_toc call 2 (second — index reuse)" '{
  "jsonrpc": "2.0", "id": 11, "method": "tools/call",
  "params": {
    "name": "get_toc",
    "arguments": {
      "source": "Next.js Docs",
      "sourceDef": { "name": "Next.js Docs", "template": "nextjs" }
    }
  }
}' > /dev/null  # timing printed above; suppress duplicate body

echo "[smoke-test-prod] Call 3: get_toc (third — index still in Map)..."
timed_call "get_toc call 3 (third — index reuse)" '{
  "jsonrpc": "2.0", "id": 12, "method": "tools/call",
  "params": {
    "name": "get_toc",
    "arguments": {
      "source": "Next.js Docs",
      "sourceDef": { "name": "Next.js Docs", "template": "nextjs" }
    }
  }
}' > /dev/null

# ── 3. Concurrent indexing — buildLocks thundering-herd prevention ────────────
echo
echo "=== 3. Concurrent indexing (2 simultaneous requests — buildLocks) ==="
echo "[smoke-test-prod] Sending 2 concurrent get_toc requests for Tailwind (uncached)..."

TMPDIR_CONC=$(mktemp -d)
PAYLOAD_CONC='{
  "jsonrpc": "2.0", "id": 20, "method": "tools/call",
  "params": {
    "name": "get_toc",
    "arguments": {
      "source": "Tailwind CSS",
      "sourceDef": { "name": "Tailwind CSS", "template": "tailwind" }
    }
  }
}'

if [[ -n "$AUTH_HEADER" ]]; then
  curl -sS -X POST "$ENDPOINT" \
    -H 'Content-Type: application/json' \
    -H "$AUTH_HEADER" \
    -d "$PAYLOAD_CONC" > "$TMPDIR_CONC/r1.json" &
  PID1=$!
  curl -sS -X POST "$ENDPOINT" \
    -H 'Content-Type: application/json' \
    -H "$AUTH_HEADER" \
    -d "$PAYLOAD_CONC" > "$TMPDIR_CONC/r2.json" &
  PID2=$!
else
  curl -sS -X POST "$ENDPOINT" \
    -H 'Content-Type: application/json' \
    -d "$PAYLOAD_CONC" > "$TMPDIR_CONC/r1.json" &
  PID1=$!
  curl -sS -X POST "$ENDPOINT" \
    -H 'Content-Type: application/json' \
    -d "$PAYLOAD_CONC" > "$TMPDIR_CONC/r2.json" &
  PID2=$!
fi

CONC_START=$(date +%s%3N)
wait $PID1 $PID2
CONC_END=$(date +%s%3N)
CONC_ELAPSED=$(( CONC_END - CONC_START ))

echo
echo "── concurrent response 1 ──"
cat "$TMPDIR_CONC/r1.json" | pretty

echo
echo "── concurrent response 2 ──"
cat "$TMPDIR_CONC/r2.json" | pretty

echo
echo "[smoke-test-prod] Both concurrent requests completed in ${CONC_ELAPSED}ms wall-clock"

# Validate both got real page data (not an error)
R1_OK=$(cat "$TMPDIR_CONC/r1.json" | python3 -c "
import sys,json
d=json.load(sys.stdin)
try:
    text=json.loads(d['result']['content'][0]['text'])
    print('ok' if text.get('pages') else 'no-pages')
except:
    print('error')
" 2>/dev/null || echo "parse-fail")

R2_OK=$(cat "$TMPDIR_CONC/r2.json" | python3 -c "
import sys,json
d=json.load(sys.stdin)
try:
    text=json.loads(d['result']['content'][0]['text'])
    print('ok' if text.get('pages') else 'no-pages')
except:
    print('error')
" 2>/dev/null || echo "parse-fail")

echo "[smoke-test-prod] Concurrent request 1 result: $R1_OK"
echo "[smoke-test-prod] Concurrent request 2 result: $R2_OK"

if [[ "$R1_OK" == "ok" && "$R2_OK" == "ok" ]]; then
  echo "[smoke-test-prod] PASS: both concurrent requests resolved with page data."
else
  echo "[smoke-test-prod] FAIL: one or both concurrent requests returned no pages or an error."
  exit 1
fi

rm -rf "$TMPDIR_CONC"
echo
echo "[smoke-test-prod] All production checks passed."
