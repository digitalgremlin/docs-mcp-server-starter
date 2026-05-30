#!/usr/bin/env bash
# Tiny JSON-RPC client for the Docs MCP Server Starter, used by demo/demo.tape
# to record the README demo GIF against a local Standby server.
#
# It wraps the same curl recipe as scripts/smoke-test.sh but unwraps the
# MCP envelope (result.content[0].text is a JSON string) so the visible
# output is clean tool JSON — what an MCP client effectively "sees".
#
# Usage:
#   ./demo/mcp.sh sources                 # list_sources
#   ./demo/mcp.sh toc                     # get_toc (Next.js Docs, lazy-indexed)
#   ./demo/mcp.sh search "<query>"        # search_docs over Next.js Docs
#   ./demo/mcp.sh page "<url>"            # get_page for a specific URL
#   ./demo/mcp.sh warm <n>                # cache first <n> TOC pages (cache warmup)
#   ./demo/mcp.sh first-url               # print the first TOC url (for scripting)
#
# Requires: curl, jq. Server: local Standby on ACTOR_STANDBY_PORT (default 4321).

set -euo pipefail

PORT="${ACTOR_STANDBY_PORT:-4321}"
URL="http://localhost:${PORT}"
SOURCE="Next.js Docs"
SOURCE_DEF='{ "name": "Next.js Docs", "template": "nextjs" }'

# Unwrap the MCP envelope: result.content[0].text holds the tool result as a
# JSON string. Parse it back to an object; fall back to the raw payload.
unwrap='if (.result.content[0].text? // empty) != "" then (.result.content[0].text | fromjson) else . end'

rpc() {
  curl -sS -X POST "$URL" -H 'Content-Type: application/json' -d "$1"
}

call() {
  # $1 = id, $2 = tool name, $3 = arguments JSON
  rpc "$(printf '{"jsonrpc":"2.0","id":%s,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$1" "$2" "$3")"
}

cmd="${1:-}"
case "$cmd" in
  sources)
    call 1 list_sources '{}' | jq "$unwrap"
    ;;
  toc)
    call 2 get_toc "$(printf '{"source":"%s","sourceDef":%s}' "$SOURCE" "$SOURCE_DEF")" \
      | jq "$unwrap | { source, pages: (.pages | length) }"
    ;;
  search)
    q="${2:?search query required}"
    call 3 search_docs "$(printf '{"query":"%s","source":"%s","sourceDef":%s,"maxResults":3}' "$q" "$SOURCE" "$SOURCE_DEF")" \
      | jq "$unwrap"
    ;;
  page)
    u="${2:?page url required}"
    call 4 get_page "$(printf '{"url":"%s"}' "$u")" \
      | jq "$unwrap | { url, title, source, cachedAt, chars: (.content | length) }"
    ;;
  first-url)
    call 9 get_toc "$(printf '{"source":"%s","sourceDef":%s}' "$SOURCE" "$SOURCE_DEF")" \
      | jq -r "$unwrap | .pages[0].url // empty"
    ;;
  warm)
    n="${2:-5}"
    mapfile -t urls < <(call 9 get_toc "$(printf '{"source":"%s","sourceDef":%s}' "$SOURCE" "$SOURCE_DEF")" \
      | jq -r "$unwrap | .pages[].url" | head -n "$n")
    for u in "${urls[@]}"; do
      call 4 get_page "$(printf '{"url":"%s"}' "$u")" >/dev/null
    done
    echo "warmed ${#urls[@]} pages"
    ;;
  *)
    echo "usage: $0 {sources|toc|search <q>|page <url>|warm <n>|first-url}" >&2
    exit 2
    ;;
esac
