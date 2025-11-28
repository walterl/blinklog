(() => {
	'use strict';

	const els = {
		apiKey: document.getElementById('apiKey'),
		saveApiKeyBtn: document.getElementById('saveApiKeyBtn'),
		clearDataBtn: document.getElementById('clearDataBtn'),
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
	}

	function toLocalISOStringNoSeconds(d) {
		const date = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
		return date.toISOString().slice(0, 16);
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

	function fmtAmount(amount, currency) {
		if (amount == null) return '';
		if (currency === 'BTC' || currency === 'SATS') {
			return `${amount} sats`;
		}
		if (currency === 'USD') {
			// amount expected in cents or dollars? We'll show raw with symbol for clarity.
			return `$${amount}`;
		}
		return `${amount} ${currency || ''}`.trim();
	}

	function renderRows(rows) {
		const tbody = els.txBody;
		if (!tbody) return;
		tbody.innerHTML = '';
		if (!rows || rows.length === 0) {
			const tr = document.createElement('tr');
			const td = document.createElement('td');
			td.colSpan = 9;
			td.className = 'muted';
			td.textContent = 'No transactions found for the selected range.';
			tr.appendChild(td);
			tbody.appendChild(tr);
			return;
		}
		for (const r of rows) {
			const tr = document.createElement('tr');
			const cells = [
				fmtDate(r.createdAtMs ?? r.createdAt ?? r.createdAtISO ?? r.createdAtRaw),
				r.walletCurrency ?? '',
				r.direction ?? '',
				fmtAmount(r.amount ?? r.settlementAmount, r.settlementCurrency ?? r.walletCurrency),
				fmtAmount(r.fee ?? r.settlementFee, r.settlementCurrency ?? r.walletCurrency),
				r.memo ?? '',
				r.counterparty ?? r.counterPartyUsername ?? '',
				r.status ?? '',
				(r.paymentHash || r.transactionHash || r.id || '').toString(),
			];
			for (let i = 0; i < cells.length; i++) {
				const td = document.createElement('td');
				td.textContent = cells[i] == null ? '' : String(cells[i]);
				if (i === 8) td.className = 'mono small';
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
		if (!rows?.length) return 'date,wallet,direction,amount,fee,memo,counterparty,status,id\n';
		const header = ['date','wallet','direction','amount','fee','memo','counterparty','status','id'];
		const lines = [header.join(',')];
		for (const r of rows) {
			const line = [
				fmtDate(r.createdAtMs ?? r.createdAt ?? r.createdAtISO ?? r.createdAtRaw),
				r.walletCurrency ?? '',
				r.direction ?? '',
				(r.amount ?? r.settlementAmount) ?? '',
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

	// Event wiring and initialization
	function init() {
		// Load key
		const key = loadApiKey();
		if (key && els.apiKey) els.apiKey.value = key;

		// Wire actions (functional implementations arrive in subsequent tasks)
		els.saveApiKeyBtn?.addEventListener('click', () => {
			const value = els.apiKey?.value?.trim();
			if (!value) { setError('Please enter an API key.'); return; }
			saveApiKey(value);
			setError('');
			setStatus('API key saved.');
		});

		els.clearDataBtn?.addEventListener('click', () => {
			if (!confirm('Clear API key and all fetched data?')) return;
			clearAllData();
		});

		els.fetchBtn?.addEventListener('click', async () => {
			setError('');
			setStatus('Testing API key…');
			try {
				abortController = new AbortController();
				// Lightweight check: fetch current account wallets
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
				const data = await gqlRequest(q, {}, abortController.signal);
				const wallets = data?.me?.defaultAccount?.wallets ?? [];
				if (!Array.isArray(wallets) || wallets.length === 0) {
					setStatus('API key ok, but no wallets found.');
				} else {
					setStatus(`API key ok. Found ${wallets.length} wallet(s).`);
				}
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


