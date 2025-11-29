(() => {
	'use strict';

	const els = {
		apiKey: document.getElementById('apiKey'),
		saveApiKeyBtn: document.getElementById('saveApiKeyBtn'),
		clearDataBtn: document.getElementById('clearDataBtn'),
		apiKeySection: document.getElementById('apiKeySection'),
		changeApiKeyBtn: document.getElementById('changeApiKeyBtn'),
		start: document.getElementById('startDatetime'),
		end: document.getElementById('endDatetime'),
		fetchBtn: document.getElementById('fetchBtn'),
		cancelBtn: document.getElementById('cancelBtn'),
		exportCsvBtn: document.getElementById('exportCsvBtn'),
		exportJsonBtn: document.getElementById('exportJsonBtn'),
		printBtn: document.getElementById('printBtn'),
		status: document.getElementById('status'),
		error: document.getElementById('error'),
		progress: document.getElementById('progress'),
		txBody: document.getElementById('txBody'),
		placeholderRow: document.getElementById('placeholderRow'),
	};

	const STORAGE_KEY = 'blinkApiKey';
	let abortController = null;
	let lastResults = [];
	const GQL_ENDPOINT = 'https://api.blink.sv/graphql';
	const PAGE_SIZE = 50;
	const COINGECKO_RANGE_URL = 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range';

	function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

	function setStatus(msg) {
		if (!els.status) return;
		els.status.textContent = msg || '';
	}

	function setError(msg) {
		if (!els.error) return;
		if (!msg) {
			els.error.hidden = true;
			els.error.textContent = '';
		} else {
			els.error.hidden = false;
			els.error.textContent = msg;
		}
	}

	function setProgress(value, max = 100) {
		if (!els.progress) return;
		if (value == null) {
			els.progress.hidden = true;
			return;
		}
		els.progress.hidden = false;
		els.progress.max = max;
		els.progress.value = Math.max(0, Math.min(value, max));
	}

	function loadApiKey() {
		try {
			const v = localStorage.getItem(STORAGE_KEY);
			return v || '';
		} catch {
			return '';
		}
	}

	function saveApiKey(value) {
		try {
			if (value) localStorage.setItem(STORAGE_KEY, value);
		} catch { /* ignore */ }
	}

	function clearAllData() {
		try { localStorage.removeItem(STORAGE_KEY); } catch {}
		lastResults = [];
		renderRows([]);
		if (els.apiKey) els.apiKey.value = '';
		setStatus('Data cleared.');
		setError('');
		// Reveal API key section since key is cleared
		if (els.apiKeySection) els.apiKeySection.style.display = '';
		if (els.changeApiKeyBtn) els.changeApiKeyBtn.hidden = true;
	}

	function parseLocalDateTime(inputEl) {
		if (!inputEl?.value) return null;
		// Value like "2025-01-31T12:34" interpreted as local time
		const [datePart, timePart] = inputEl.value.split('T');
		if (!datePart || !timePart) return null;
		const [y, m, d] = datePart.split('-').map(Number);
		const [hh, mm] = timePart.split(':').map(Number);
		const dt = new Date(y, (m - 1), d, hh, mm, 0, 0);
		return isNaN(dt.getTime()) ? null : dt;
	}

	function getRangeUTCInclusive() {
		const startLocal = parseLocalDateTime(els.start);
		const endLocal = parseLocalDateTime(els.end);
		if (!startLocal || !endLocal) return null;
		// Inclusive end: add almost one minute to include entire last minute range
		// We'll filter precisely client-side by timestamps.
		return {
			startMsUTC: startLocal.getTime(),
			endMsUTC: endLocal.getTime(),
		};
	}

	function fmtDate(d) {
		try {
			return new Date(d).toLocaleString();
		} catch {
			return '';
		}
	}

	function fmtFiat(amount, currency) {
		if (amount == null) return '';
		let amt;
		try {
			const num = Number(amount);
			amt = Number.isFinite(num) ? `${num.toFixed(2)}` : `${amount}`;
		} catch {
			amt = amount;
		}
		return `${amt} ${currency || ''}`.trim();
	}
	function fmtAmount(amount, currency) {
		if (amount == null) return '';
		if (currency === 'BTC' || currency === 'SATS') {
			return `${amount} sats`;
		}
		if (['USD', 'ZAR'].includes(currency)) {
			return fmtFiat(amount, currency);
		}
		return `${amount} ${currency || ''}`.trim();
	}
	function fmtFiatAmountOnly(amount) {
		if (amount == null) return '';
		const num = Number(amount);
		return Number.isFinite(num) ? `${num.toFixed(2)}` : `${amount}`;
	}
	function fmtDateYmdHms(d) {
		try {
			const ms = parseCreatedAt(d);
			if (!Number.isFinite(ms)) return '';
			const date = new Date(ms);
			const pad = (n) => n.toString().padStart(2, '0');
			const yyyy = date.getFullYear();
			const mm = pad(date.getMonth() + 1);
			const dd = pad(date.getDate());
			const HH = pad(date.getHours());
			const MM = pad(date.getMinutes());
			const SS = pad(date.getSeconds());
			return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
		} catch {
			return '';
		}
	}

	function renderRows(rows, opts = {}) {
		const singleFiatCurrency = opts.singleFiatCurrency || null;
		const tbody = els.txBody;
		if (!tbody) return;
		tbody.innerHTML = '';
		if (!rows || rows.length === 0) {
			const tr = document.createElement('tr');
			const td = document.createElement('td');
			td.colSpan = 4;
			td.className = 'muted';
			td.textContent = 'No transactions found for the selected range.';
			tr.appendChild(td);
			tbody.appendChild(tr);
			return;
		}
		for (const r of rows) {
			const tr = document.createElement('tr');
			const cells = [
				fmtDateYmdHms(r.createdAtMs ?? r.createdAt ?? r.createdAtISO ?? r.createdAtRaw), // 0 Date
				singleFiatCurrency ? fmtFiatAmountOnly(r.fiatAmount) : fmtFiat(r.fiatAmount, r.fiatCurrency), // 1 Amount
				r.memo ?? '', // 2 Memo
				(r.status ?? ''), // 3 Status
			];
			for (let i = 0; i < cells.length; i++) {
				const td = document.createElement('td');
				td.textContent = cells[i] == null ? '' : String(cells[i]);
				// Tooltip for date cell: show Direction and ID/Hash
				if (i === 0) {
					const idOrHash = (r.paymentHash || r.transactionHash || r.id || '').toString();
					const direction = r.direction || '';
					const wallet = r.walletCurrency || '';
					td.title = `Direction: ${direction || '—'}\nWallet: ${wallet || '—'}\nID/Hash: ${idOrHash || '—'}`;
				}
				// Tooltip for Fiat Value cell: show sats amount and fee (if applicable)
				if (i === 1) {
					const isBtc = (r.settlementCurrency === 'BTC' || r.walletCurrency === 'BTC' || r.settlementCurrency === 'SATS');
					const amtSats = isBtc ? (r.amount ?? r.settlementAmount) : null;
					const feeSats = isBtc ? (r.fee ?? r.settlementFee) : null;
					const amtStr = (amtSats == null) ? '—' : `${amtSats} sats`;
					const feeStr = (feeSats == null) ? '—' : `${feeSats} sats`;
					td.title = `Amount: ${amtStr}\nFee: ${feeStr}`;
				}
				// Tooltip for Memo cell: show Counterparty
				if (i === 2) {
					const cp = (r.counterparty ?? r.counterPartyUsername ?? '');
					if (cp) td.title = `Counterparty: ${cp}`;
				}
				tr.appendChild(td);
			}
			tbody.appendChild(tr);
		}
	}

	function download(filename, content, mime = 'text/plain;charset=utf-8') {
		const blob = new Blob([content], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	function toCSV(rows) {
		if (!rows?.length) return 'date,wallet,direction,amount,fiat,fee,memo,counterparty,status,id\n';
		const header = ['date','wallet','direction','amount','fiat','fee','memo','counterparty','status','id'];
		const lines = [header.join(',')];
		for (const r of rows) {
			const line = [
				fmtDate(r.createdAtMs ?? r.createdAt ?? r.createdAtISO ?? r.createdAtRaw),
				r.walletCurrency ?? '',
				r.direction ?? '',
				(r.amount ?? r.settlementAmount) ?? '',
				r.fiatAmount ?? '',
				(r.fee ?? r.settlementFee) ?? '',
				(r.memo ?? '').replaceAll('"','""'),
				(r.counterparty ?? r.counterPartyUsername ?? '').replaceAll('"','""'),
				r.status ?? '',
				(r.paymentHash || r.transactionHash || r.id || '').toString(),
			].map(v => `"${String(v ?? '')}"`);
			lines.push(line.join(','));
		}
		return lines.join('\n');
	}

	function printPage() {
		window.print();
	}

	async function gqlRequest(query, variables = {}, signal) {
		const apiKey = loadApiKey();
		if (!apiKey) throw new Error('Missing API key. Please save your API key.');
		const res = await fetch(GQL_ENDPOINT, {
			method: 'POST',
			mode: 'cors',
			credentials: 'omit',
			headers: {
				'Content-Type': 'application/json',
				'X-API-KEY': apiKey,
			},
			body: JSON.stringify({ query, variables }),
			signal,
		});
		if (!res.ok) {
			let text = '';
			try { text = await res.text(); } catch {}
			throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
		}
		const json = await res.json();
		if (json.errors?.length) {
			const msg = json.errors.map(e => e.message).join('; ');
			throw new Error(msg || 'GraphQL error');
		}
		return json.data;
	}

	async function gqlRequestWithRetry(query, variables = {}, signal, maxRetries = 4) {
		let attempt = 0;
		while (true) {
			try {
				return await gqlRequest(query, variables, signal);
			} catch (e) {
				const msg = String(e?.message || '');
				const transient = /HTTP (429|5\d\d)/.test(msg);
				if (!transient || attempt >= maxRetries) throw e;
				const delay = Math.min(2000, 300 * Math.pow(2, attempt));
				await sleep(delay);
				attempt++;
			}
		}
	}

	async function getWallets(signal) {
		const q = `
			query MeWallets {
				me {
					defaultAccount {
						wallets {
							id
							walletCurrency
						}
					}
				}
			}
		`;
		const d = await gqlRequest(q, {}, signal);
		const wallets = d?.me?.defaultAccount?.wallets ?? [];
		return wallets.filter(Boolean);
	}

	function parseCreatedAt(createdAt) {
		// Attempt to parse multiple possible shapes (ms, seconds, ISO)
		if (createdAt == null) return NaN;
		if (typeof createdAt === 'number') {
			// Heuristic: if too small, assume seconds
			return createdAt < 2_000_000_000 ? createdAt * 1000 : createdAt;
		}
		const asNum = Number(createdAt);
		if (!Number.isNaN(asNum)) {
			return asNum < 2_000_000_000 ? asNum * 1000 : asNum;
		}
		const t = Date.parse(createdAt);
		return Number.isNaN(t) ? NaN : t;
	}

	function mapTxNode(node, walletCurrency) {
		const createdAtMs = parseCreatedAt(node?.createdAt);
		const settlementCurrency = node?.settlementCurrency || walletCurrency;
		let fiatAmount = null;
		let fiatCurrency = null;
		if (node?.settlementDisplayAmount != null && node?.settlementDisplayCurrency) {
			fiatAmount = Number(node.settlementDisplayAmount);
			fiatCurrency = node.settlementDisplayCurrency;
		} else if (settlementCurrency === 'USD' && node?.settlementAmount != null) {
			// If the wallet is USD, the settlement amount is already fiat
			fiatAmount = Number(node.settlementAmount);
			fiatCurrency = 'USD';
		}
		return {
			id: node?.id,
			createdAtMs,
			walletCurrency,
			direction: node?.direction || '',
			amount: node?.settlementAmount ?? node?.amount,
			fee: node?.settlementFee ?? node?.fee,
			settlementCurrency,
			fiatAmount: Number.isFinite(fiatAmount) ? fiatAmount : null,
			fiatCurrency: fiatCurrency || null,
			memo: node?.memo || '',
			counterparty: node?.initiationVia?.counterPartyUsername || node?.initiationVia?.counterpartyUsername || node?.counterPartyUsername || node?.counterparty || '',
			status: node?.status || '',
			paymentHash: node?.settlementVia?.paymentHash,
			transactionHash: node?.settlementVia?.transactionHash,
			raw: node,
		};
	}

	async function fetchWalletTransactions(wallet, signal, onProgress) {
		let after = null;
		let hasNext = true;
		const out = [];
		const q = `
			query WalletTxs($walletId: WalletId!, $first: Int!, $after: String) {
				me {
					defaultAccount {
						walletById(walletId: $walletId) {
							id
							walletCurrency
							transactions(first: $first, after: $after) {
								pageInfo { hasNextPage endCursor }
								edges {
									cursor
									node {
										id
										createdAt
										status
										direction
										settlementAmount
										settlementCurrency
										settlementDisplayAmount
										settlementDisplayCurrency
										settlementFee
										memo
										initiationVia {
											__typename
											... on InitiationViaIntraLedger {
												counterPartyUsername
											}
										}
									}
								}
							}
						}
					}
				}
			}
		`;
		let pages = 0;
		while (hasNext) {
			const data = await gqlRequestWithRetry(q, { walletId: wallet.id, first: PAGE_SIZE, after }, signal);
			const w = data?.me?.defaultAccount?.walletById;
			const page = w?.transactions;
			const edges = page?.edges ?? [];
			for (const e of edges) {
				if (e?.node) out.push(mapTxNode(e.node, w?.walletCurrency || wallet.walletCurrency));
			}
			hasNext = Boolean(page?.pageInfo?.hasNextPage);
			after = page?.pageInfo?.endCursor || null;
			pages++;
			onProgress?.(pages, out.length);
		}
		return out;
	}

	async function fetchAllWalletsAndTransactions(signal) {
		const wallets = await getWallets(signal);
		if (!wallets.length) return [];
		const all = [];
		let totalFetched = 0;
		for (let i = 0; i < wallets.length; i++) {
			const w = wallets[i];
			setStatus(`Fetching wallet ${i + 1}/${wallets.length} (${w.walletCurrency})…`);
			const txs = await fetchWalletTransactions(w, signal, (pages, _count) => {
				setProgress(Math.min(100, 10 + pages * 5));
			});
			totalFetched += txs.length;
			all.push(...txs);
		}
		setProgress(100);
		return all;
	}

	function findNearestPriceUSD(prices, tMs) {
		// prices: array of [timestampMs, priceUsd]
		if (!prices?.length || !Number.isFinite(tMs)) return null;
		let lo = 0, hi = prices.length - 1;
		while (lo < hi) {
			const mid = Math.floor((lo + hi) / 2);
			if (prices[mid][0] < tMs) lo = mid + 1;
			else hi = mid;
		}
		const idx = lo;
		const prev = prices[idx - 1] ?? null;
		const curr = prices[idx] ?? null;
		if (!prev) return curr?.[1] ?? null;
		if (!curr) return prev?.[1] ?? null;
		const dtPrev = Math.abs(prev[0] - tMs);
		const dtCurr = Math.abs(curr[0] - tMs);
		return dtPrev <= dtCurr ? prev[1] : curr[1];
	}

	async function fetchUsdPriceSeriesForRange(startMs, endMs, signal) {
		// CoinGecko expects UNIX seconds
		const from = Math.floor(startMs / 1000) - 60;
		const to = Math.floor(endMs / 1000) + 60;
		const url = `${COINGECKO_RANGE_URL}?vs_currency=usd&from=${from}&to=${to}`;
		const res = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', signal });
		if (!res.ok) throw new Error(`Price fetch failed: ${res.status}`);
		const data = await res.json();
		// data.prices is array of [ms, priceUSD]
		const prices = Array.isArray(data?.prices) ? data.prices.filter(p => Array.isArray(p) && p.length >= 2) : [];
		prices.sort((a, b) => a[0] - b[0]);
		return prices;
	}

	async function hydrateFiatForTransactions(rows, signal) {
		if (!rows?.length) return rows || [];
		// If all have fiat already, skip
		if (rows.every(r => r.fiatAmount != null && r.fiatCurrency)) return rows;
		// Compute range over rows missing fiat, only for BTC-settled
		const missing = rows.filter(r => (r.fiatAmount == null || !r.fiatCurrency) && (r.settlementCurrency === 'BTC' || r.walletCurrency === 'BTC' || r.settlementCurrency === 'SATS'));
		if (!missing.length) return rows;
		const minT = Math.min(...missing.map(r => r.createdAtMs || Infinity));
		const maxT = Math.max(...missing.map(r => r.createdAtMs || -Infinity));
		if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return rows;
		setStatus('Resolving fiat values…');
		setProgress(90, 100);
		let prices = [];
		try {
			prices = await fetchUsdPriceSeriesForRange(minT, maxT, signal);
		} catch {
			// best-effort; if price fetch fails, we leave fiat empty
			return rows;
		}
		for (const r of missing) {
			const p = findNearestPriceUSD(prices, r.createdAtMs);
			if (!Number.isFinite(p)) continue;
			// settlement amount is in sats for BTC wallet/settlement
			const sats = Number(r.amount);
			if (!Number.isFinite(sats)) continue;
			const usdPerBtc = p;
			const usdPerSat = usdPerBtc / 100_000_000;
			const usd = sats * usdPerSat;
			r.fiatAmount = Number.isFinite(usd) ? usd : null;
			r.fiatCurrency = 'USD';
		}
		return rows;
	}

	// Event wiring and initialization
	function init() {
		// Load key
		const key = loadApiKey();
		if (key && els.apiKey) els.apiKey.value = key;
		// Hide API section if key exists; keep change button visible
		if (key) {
			if (els.apiKeySection) els.apiKeySection.style.display = 'none';
			if (els.changeApiKeyBtn) els.changeApiKeyBtn.hidden = false;
		} else {
			if (els.changeApiKeyBtn) els.changeApiKeyBtn.hidden = true;
		}

		// Wire actions (functional implementations arrive in subsequent tasks)
		els.saveApiKeyBtn?.addEventListener('click', () => {
			const value = els.apiKey?.value?.trim();
			if (!value) { setError('Please enter an API key.'); return; }
			saveApiKey(value);
			setError('');
			setStatus('API key saved.');
			// Hide section after saving; show change button
			if (els.apiKeySection) els.apiKeySection.style.display = 'none';
			if (els.changeApiKeyBtn) els.changeApiKeyBtn.hidden = false;
		});

		els.changeApiKeyBtn?.addEventListener('click', () => {
			if (els.apiKeySection) els.apiKeySection.style.display = '';
			if (els.apiKey) els.apiKey.focus();
		});

		// Pressing Enter on either date input triggers fetching transactions
		const triggerFetchOnEnter = (e) => {
			if (e?.key === 'Enter') {
				e.preventDefault();
				els.fetchBtn?.click();
			}
		};
		els.start?.addEventListener('keydown', triggerFetchOnEnter);
		els.end?.addEventListener('keydown', triggerFetchOnEnter);

		els.clearDataBtn?.addEventListener('click', () => {
			if (!confirm('Clear API key and all fetched data?')) return;
			clearAllData();
		});

		els.fetchBtn?.addEventListener('click', async () => {
			setError('');
			setStatus('Fetching wallets…');
			const range = getRangeUTCInclusive();
			if (!range) { setError('Please select a valid start and end date/time.'); return; }
			try {
				abortController = new AbortController();
				const allTxs = await fetchAllWalletsAndTransactions(abortController.signal);
				// Filter by local-inclusive range client-side
				const filtered = allTxs.filter(r => {
					const t = r.createdAtMs;
					return Number.isFinite(t) && t >= range.startMsUTC && t <= range.endMsUTC;
				});
				// Sort newest first
				filtered.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
				// Hydrate fiat values if needed
				const withFiat = await hydrateFiatForTransactions(filtered, abortController.signal);
				// Determine if all fiat currencies are the same
				const currencies = new Set(withFiat.map(r => r.fiatCurrency).filter(Boolean));
				const singleFiatCurrency = currencies.size === 1 ? [...currencies][0] : null;
				// Update header accordingly
				const hdr = document.getElementById('amountHeader');
				if (hdr) hdr.textContent = singleFiatCurrency ? `Amount (${singleFiatCurrency})` : 'Amount';
				lastResults = withFiat;
				renderRows(withFiat, { singleFiatCurrency });
				setStatus(`Loaded ${withFiat.length} transaction(s).`);
			} catch (e) {
				setError(e?.message || 'Request failed.');
				setStatus('');
			} finally {
				setProgress(null);
				abortController = null;
			}
		});

		els.cancelBtn?.addEventListener('click', () => {
			if (abortController) {
				abortController.abort();
				setStatus('Cancelled.');
				setProgress(null);
			}
		});

		els.exportCsvBtn?.addEventListener('click', () => {
			const csv = toCSV(lastResults);
			download('blink-transactions.csv', csv, 'text/csv;charset=utf-8');
		});

		els.exportJsonBtn?.addEventListener('click', () => {
			const json = JSON.stringify(lastResults ?? [], null, 2);
			download('blink-transactions.json', json, 'application/json;charset=utf-8');
		});

		els.printBtn?.addEventListener('click', printPage);
	}

	document.addEventListener('DOMContentLoaded', init);
})();
