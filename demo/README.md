# Demo GIF

`demo.gif` (embedded at the top of the main README) is recorded from a live
local Standby server using [VHS](https://github.com/charmbracelet/vhs).

## Render it

```bash
# from the repo root
brew install vhs        # or: go install github.com/charmbracelet/vhs@latest
vhs demo/demo.tape      # or: npm run demo:gif
```

This writes `demo/demo.gif`. The tape:

1. **Hidden setup** — boots `apify run` in the background, waits for the
   `MCP server listening` log line, then warms the Next.js index and page
   cache (`./demo/mcp.sh warm 8`) so `search_docs` returns real content hits
   on camera.
2. **Recorded** — runs `get_toc`, `search_docs`, and `get_page` through the
   `demo/mcp.sh` JSON-RPC helper.
3. **Hidden teardown** — stops the background actor.

## Requirements

- [`vhs`](https://github.com/charmbracelet/vhs)
- `apify-cli`, `curl`, `jq`
- Node deps installed (`npm install`)

## Files

- `demo.tape` — the VHS script (theme, timing, command sequence).
- `mcp.sh` — tiny JSON-RPC client that unwraps the MCP envelope so the visible
  output is clean tool JSON. Also usable standalone for manual pokes:
  `./demo/mcp.sh search "routing"`.

Re-render and commit `demo/demo.gif` whenever the tool output shape changes.
