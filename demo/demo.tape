# Docs MCP Server Starter — README demo GIF
# Render with:  vhs demo/demo.tape   (from the repo root)
# Requires: vhs (github.com/charmbracelet/vhs), apify-cli, jq, curl.
#
# The Hidden block boots a local Standby server, waits for it to come up, and
# warms the Next.js index + page cache so search_docs returns real hits on
# camera. The Show block records the four MCP tools in action.

Output demo/demo.gif

# ── Flammable Toys theme ──────────────────────────────────────────────
Set Theme { "name": "FlammableToys", "background": "#1A1A2E", "foreground": "#FFF8F0", "cursor": "#F5B731", "selection": "#4A4A5A", "black": "#1A1A2E", "red": "#E74C3C", "green": "#2ECC71", "yellow": "#F5B731", "blue": "#4A4A5A", "magenta": "#E8751A", "cyan": "#F5B731", "white": "#FFF8F0", "brightBlack": "#4A4A5A", "brightRed": "#E74C3C", "brightGreen": "#2ECC71", "brightYellow": "#F5B731", "brightBlue": "#4A4A5A", "brightMagenta": "#E8751A", "brightCyan": "#F5B731", "brightWhite": "#FFF8F0" }

Set FontSize 20
Set Width 1200
Set Height 700
Set Padding 28
Set PlaybackSpeed 1.0
Set TypingSpeed 55ms

# ── Setup (not recorded) ──────────────────────────────────────────────
Hide
  Type "cd $(git rev-parse --show-toplevel) && clear" Enter
  # Boot Standby in the background, capture logs, wait for the server.
  Type "LOG=$(mktemp); apify run --purge >\"$LOG\" 2>&1 & APID=$!" Enter
  Type "until grep -q 'MCP server listening' \"$LOG\"; do sleep 1; done" Enter
  # Warm the Next.js index + page cache so search returns content hits.
  Type "./demo/mcp.sh warm 8 >/dev/null" Enter
  Type "clear" Enter
Show

# ── Recorded demo ─────────────────────────────────────────────────────
Type "# 1. What docs are indexed? (Standby builds the index on first request)"
Enter
Sleep 600ms
Type "./demo/mcp.sh toc"
Enter
Sleep 2.5s

Type "# 2. Search the live docs — keyword, no vector store"
Enter
Sleep 600ms
Type "./demo/mcp.sh search 'server actions'"
Enter
Sleep 3s

Type "# 3. Fetch a full page (LRU cache hit -> cachedAt is set)"
Enter
Sleep 600ms
Type "./demo/mcp.sh page \"$(./demo/mcp.sh first-url)\""
Enter
Sleep 3.5s

Type "# Your AI assistant just queried today's docs over MCP."
Enter
Sleep 2.5s

# ── Teardown (not recorded) ───────────────────────────────────────────
Hide
  Type "kill -TERM \"$APID\" 2>/dev/null; wait \"$APID\" 2>/dev/null; rm -f \"$LOG\"" Enter
Show
