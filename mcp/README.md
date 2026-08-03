# cresc-mcp

MCP server for discovering pay-per-article writing on [Cresc](https://cresc.vercel.app).

Ask your assistant for writing on a topic; it searches every onboarded Cresc creator's
published articles and hands you a link where you pay a few cents in USDC and read.

## Install

Claude Desktop (`claude_desktop_config.json`) or any MCP client:

```json
{
  "mcpServers": {
    "cresc": {
      "command": "npx",
      "args": ["-y", "cresc-mcp"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add cresc -- npx -y cresc-mcp
```

No API key. No wallet. Nothing to configure.

## Tools

| Tool | What it does |
|---|---|
| `search_articles` | Ranked full-text search over article titles, topics and excerpts. Empty query browses the most recent. Returns title, author, topics, price, excerpt, and a read link. |
| `get_article` | Re-confirms one article's current price and link by `slug` + `site`. Cresc prices retune hourly. |

## What it does *not* do

It never returns article bodies. Bodies are paywalled and this server holds no keys and
makes no payments — it returns the publisher's own excerpt plus the link where the
**reader** pays. Payment happens in the browser, at that link.

## Config

| Env | Default | Purpose |
|---|---|---|
| `CRESC_API_URL` | `https://cresc.vercel.app` | Point at a local or self-hosted Cresc deployment. |

## Local development

```bash
npm install
npm run build
CRESC_API_URL=http://localhost:3000 npx @modelcontextprotocol/inspector node dist/index.js
```

Note: this is a stdio server — stdout carries JSON-RPC. Never `console.log`; log to stderr.
