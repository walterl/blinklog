## Blink Transactions Viewer

Client-only web app to view and export your Blink wallet transactions over a selected date/time range. No backend or third‑party libraries are used; everything runs in your browser.

### Key Features
- Fetch transactions directly from Blink via GraphQL (`X-API-KEY` header)
- Filter by local date/time range
- Compact, print‑friendly table with informative tooltips
- Fiat-at-settlement display, with automatic fallback to historical prices
- Export to CSV or JSON

### How It Works
- Primary data source: Blink GraphQL at `https://api.blink.sv/graphql`
  - Requests include your API key via the `X-API-KEY` header (kept in localStorage on your device).
  - Transactions are fetched per wallet: `me -> defaultAccount -> walletById(walletId: ...) -> transactions(...)`.
  - For fiat-at-settlement, fields like `settlementDisplayAmount` and `settlementDisplayCurrency` are used when available.
  - Counterparty for intra-ledger transfers is taken from `initiationVia { ... on InitiationViaIntraLedger { counterPartyUsername } }`.
- Fallback for fiat values (BTC-settled transactions only):
  - If fiat-at-settlement isn’t provided, the app fetches a price series from CoinGecko (`/coins/bitcoin/market_chart/range`) and computes USD at the transaction time.

### Requirements
- A modern browser (Chrome, Firefox, Safari, Edge).
- A Blink API Key with permission to read your account’s wallets and transactions.

### Setup
1. Clone or download this repository.
2. Serve the folder locally or just open `index.html` in your browser.
   - Optional local static server:
     - Python 3: `python3 -m http.server 5500`
     - Node: `npx serve .`
3. Open the app in your browser (e.g., `http://localhost:5500` if using the Python server).

### Usage
1. Save API Key
   - Click “Change API Key” (top-right) or use the API Key panel.
   - Paste your Blink API key and click “Save”. The key is stored in `localStorage`.
2. Select Date/Time Range
   - Choose start and end (local time). Press Enter in either field to trigger “Fetch Transactions”.
3. Fetch
   - Click “Fetch Transactions”. The app will load wallets, then transactions, and display them newest first.
4. Read the Table
   - Columns: Date/Time, Amount, Memo, Status.
   - Tooltips:
     - Hover Date/Time: shows Direction, Wallet, and ID/Hash.
     - Hover Amount: shows sats Amount and sats Fee (for BTC-settled).
     - Hover Memo: shows Counterparty (when available).
   - If all fiat currencies match, header shows “Amount (CUR)”, and rows hide the currency suffix.
5. Export or Print
   - Export CSV or JSON via buttons.
   - Use “Print” for a streamlined printable layout.

### CSV Format
- Headers are title‑cased. Notable columns:
  - “Amount sats”: settlement amount in sats (if available)
  - “Amount fiat”: fiat-at-settlement or computed fiat value
  - “Fiat Currency”: the fiat currency used for “Amount fiat”

### Privacy & Security
- Your API key never leaves your browser; it’s used solely to call Blink’s GraphQL endpoint.
- No third‑party proxies or analytics.
- Historical prices are fetched from CoinGecko only when needed and only for the visible time range.

### Troubleshooting
- “Missing API key” or 401 errors: ensure the API key is saved and valid.
- GraphQL parsing errors: Blink’s schema can evolve. If you see “cannot query field …”, update the app’s GraphQL query to match the current schema.
- Empty results: confirm date/time range and that your account has transactions in that range.

### Development
- No build step; pure HTML/CSS/JS.
- Project layout:
  - `index.html` – UI and markup
  - `styles.css` – styling and print rules
  - `app.js` – logic, GraphQL calls, rendering, exports
- Run a static server (optional) during development for consistent CORS behavior.

### Notes
- This is a read‑only viewer intended for personal use.
- When Blink provides fiat-at-settlement values, those are preferred; otherwise, a best‑effort conversion is computed from CoinGecko’s historical data.


