# Blink Lightning client-only transactions viewer

## Decisions locked in
- Use Blink Lightning API; integrate directly from the browser. Reference: [Blink API docs](https://dev.blink.sv/)
- GraphQL endpoint: `https://api.blink.sv/graphql` (POST JSON)
- Authentication header: `X-API-KEY: blink_your_api_key_here`
- Date/time inputs are interpreted in the user’s local timezone, inclusive boundaries.
- No build step, no third-party libraries. Single-page vanilla HTML/CSS/JS.

## Missing/ambiguous items to finalize
- CORS viability: confirm that requests from `http://localhost` (and chosen static host) are allowed; if blocked, instruct requesting origin access. No proxy will be introduced.
- Pagination: confirm cursor-based approach and maximum page size; loop until `hasNextPage` false; handle rate limits with small backoff, per wallet.
- Time filtering: prefer server-side range filters; if unavailable, fetch by pages and filter client-side for correctness.
- Table schema: finalize displayed columns (timestamp, wallet/currency, direction, amount with units (sats or USD), fees, memo, counterparty, status, hash/id).
- Local storage security: store API key in `localStorage` by default; optional user passphrase encryption via Web Crypto (AES-GCM) to keep broad browser support.
- Clear-all semantics: clearing removes API key, cached data, and in-memory state with a confirmation prompt.
- Print stylesheet: repeat table headers on each page; hide controls; margins and orientation guidance.
- Static serving note: advise serving over HTTP(S) (not file://) for `fetch` and CORS reliability.

## Implementation outline
- Files: `index.html` (UI), `styles.css` (light theme + print media rules), `app.js` (logic).
- Flow:
  1) On load, read stored API key; if present, prefill and test with a lightweight query (e.g., wallets discovery).
  2) Automatically discover BTC and USD wallets; user sets only the date/time range; convert local-inclusive to UTC for API filters.
  3) For each wallet, fetch transactions via paginated requests until complete, respecting rate limits; merge results from both wallets and sort by date desc.
  4) Map and render rows; expose CSV/JSON export (optional) and print view.
  5) Provide Clear Data that wipes storage and state.
- Error UX: invalid key, CORS blocked, network/retry with backoff, empty results, cancel long fetch.
- Print UX: controls hidden; table fits width; monospace for IDs; page-break rules.

## Local testing server
- Add a tiny Node.js static server (`server.js`) using only built-in modules (`http`, `fs`, `path`). No third-party deps.
- Purpose: serve files over http://localhost to avoid `file://` CORS issues. It does not proxy API calls.
- Run: `node server.js` then open `http://localhost:8080`.
- Minimal implementation (for reference):

```javascript
// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const port = process.env.PORT || 8080;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const filePath = path.join(process.cwd(), urlPath === '/' ? 'index.html' : urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log(`Serving on http://localhost:${port}`));
```

## Commit strategy
- Commit in logical chunks.
- At the coarsest granularity, a single commit must not span multiple TODO items.
- Prefer one commit per TODO item; if a TODO is large, split into smaller atomic commits.
- Use clear messages with a short scope and reference the TODO ID (e.g., `[key-storage-ui]`).

## References
- Blink API docs: [https://dev.blink.sv/](https://dev.blink.sv/)


