/* ═══════════════════════════════════════════
   STOCK MANAGER — app.js
   Uni Nuts India LLP · Audit: 18.04.26
═══════════════════════════════════════════ */

// ── Tab switching ──────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + tab).classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
}

// ══════════════════════════════════════════
//  TAB 1: STOCK PARSER
// ══════════════════════════════════════════

// Build a search index from AUDIT_PRODUCTS
const auditIndex = AUDIT_PRODUCTS.map(p => ({
  ...p,
  nameLower: p.name.toLowerCase(),
  nameTokens: tokenize(p.name),
  barcodeNum: p.barcode.replace(/\D/g, '')
}));

function tokenize(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

// Levenshtein distance for fuzzy match
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.92;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

function tokenOverlap(queryTokens, productTokens) {
  if (!queryTokens.length || !productTokens.length) return 0;
  let hits = 0;
  for (const qt of queryTokens) {
    if (productTokens.some(pt => pt.startsWith(qt) || qt.startsWith(pt) || similarity(qt, pt) > 0.8)) hits++;
  }
  return hits / Math.max(queryTokens.length, productTokens.length);
}

function matchProduct(rawLine) {
  // Extract numeric ID if present
  const numMatch = rawLine.match(/\b(\d{5,6})\b/);
  const qtyMatch = rawLine.match(/(\d+(?:\.\d+)?)\s*(?:kg|pcs|box|gm|gram|pc|piece|g)\b/i) ||
                   rawLine.match(/[-–:]\s*(\d+(?:\.\d+)?)\s*$/);
  const qty = qtyMatch ? parseFloat(qtyMatch[1]) : null;

  // Unit detection in raw
  let detectedUnit = null;
  if (/\bkg\b/i.test(rawLine)) detectedUnit = 'Kg';
  else if (/\bpcs\b|\bpc\b|\bpiece/i.test(rawLine)) detectedUnit = 'Pcs';
  else if (/\bbox\b/i.test(rawLine)) detectedUnit = 'Box';
  else if (/\bgm\b|\bgram\b/i.test(rawLine)) detectedUnit = 'Gm';

  // Strip quantity from query text
  let queryText = rawLine
    .replace(/\d+(?:\.\d+)?\s*(?:kg|pcs|box|gm|gram|pc|piece|g)\b/gi, '')
    .replace(/[-–:]\s*\d+(?:\.\d+)?\s*$/, '')
    .replace(/\b\d{5,6}\b/, '')
    .trim();

  const queryTokens = tokenize(queryText);
  let bestScore = 0;
  let bestProduct = null;

  for (const p of auditIndex) {
    let score = 0;

    // 1. Exact barcode/internal code match
    if (numMatch) {
      const num = numMatch[1];
      if (p.barcode === num || p.barcodeNum === num) { score = 1.0; }
      else if (p.quebuster === num) { score = 0.97; }
    }

    // 2. Name similarity
    if (score < 0.97 && queryText.length > 1) {
      const nameSim = similarity(queryText, p.name);
      const tokenSim = tokenOverlap(queryTokens, p.nameTokens);
      const combined = Math.max(nameSim, tokenSim * 0.9);
      score = Math.max(score, combined);
    }

    if (score > bestScore) {
      bestScore = score;
      bestProduct = p;
    }
  }

  return { product: bestProduct, score: bestScore, qty, detectedUnit };
}

let parsedResults = [];

function parseStock() {
  const raw = document.getElementById('raw-input').value.trim();
  if (!raw) return;

  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 1);
  parsedResults = [];

  let matched = 0, flagged = 0, unmatched = 0;

  for (const line of lines) {
    const { product, score, qty, detectedUnit } = matchProduct(line);

    let status, conf;
    if (score >= 0.88) { status = 'ok'; conf = 'high'; matched++; }
    else if (score >= 0.60) { status = 'review'; conf = 'medium'; flagged++; }
    else { status = 'fail'; conf = 'low'; unmatched++; }

    parsedResults.push({
      raw: line,
      product,
      score: Math.round(score * 100),
      qty,
      detectedUnit,
      status,
      conf
    });
  }

  // Update stats
  document.getElementById('stat-matched').textContent = matched;
  document.getElementById('stat-flagged').textContent = flagged;
  document.getElementById('stat-unmatched').textContent = unmatched;
  document.getElementById('stat-total').textContent = lines.length;
  document.getElementById('stats-bar').classList.remove('hidden');
  document.getElementById('parser-results').classList.remove('hidden');

  renderResults(parsedResults);
}

function renderResults(results) {
  const tbody = document.getElementById('results-body');
  tbody.innerHTML = '';

  results.forEach((r, i) => {
    const p = r.product;
    const confClass = { high: 'conf-high', medium: 'conf-medium', low: 'conf-low' }[r.conf];
    const statusClass = { ok: 'status-ok', review: 'status-review', fail: 'status-fail' }[r.status];
    const statusLabel = { ok: '✅ Matched', review: '⚠️ Please Verify', fail: '❌ Not Found' }[r.status];
    const unitWarn = r.detectedUnit && p && r.detectedUnit !== p.unit
      ? `<span title="Unit mismatch! Written: ${r.detectedUnit}, Expected: ${p.unit}" style="color:var(--amber);cursor:help"> ⚠️</span>` : '';

    tbody.innerHTML += `
      <tr data-conf="${r.conf}">
        <td>${i + 1}</td>
        <td><span class="raw-text" title="${esc(r.raw)}">${esc(r.raw.substring(0, 40))}${r.raw.length > 40 ? '…' : ''}</span></td>
        <td class="product-name-cell">${p ? esc(p.name) : '<span style="color:var(--red)">—</span>'}</td>
        <td>${p ? `<span class="id-chip">${esc(p.barcode)}</span>` : '—'}</td>
        <td>${p ? `<span class="id-chip">${esc(p.quebuster)}</span>` : '—'}</td>
        <td>${p ? esc(p.unit) + unitWarn : '—'}</td>
        <td class="qty-cell">${r.qty !== null ? r.qty : '<span style="color:var(--text3)">—</span>'}</td>
        <td><span class="conf-badge ${confClass}">${r.score}%</span></td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
      </tr>`;
  });
}

function filterResults(type, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#results-body tr').forEach(tr => {
    const conf = tr.dataset.conf;
    if (type === 'all') tr.classList.remove('filtered-hide');
    else if (type === 'high' && conf === 'high') tr.classList.remove('filtered-hide');
    else if (type === 'review' && conf === 'medium') tr.classList.remove('filtered-hide');
    else if (type === 'low' && conf === 'low') tr.classList.remove('filtered-hide');
    else tr.classList.add('filtered-hide');
  });
}

function clearParser() {
  document.getElementById('raw-input').value = '';
  document.getElementById('stats-bar').classList.add('hidden');
  document.getElementById('parser-results').classList.add('hidden');
  parsedResults = [];
}

function loadSample() {
  document.getElementById('raw-input').value =
`Almonds Regular - 25 kg
mamra 12 kg
100003 - 24
Walnut kernel 2 pcs 30
Anjeer Premium 40kg
52291 50
Pecan Nuts 13.6 kg
Chia Seeds 5kg
Pumpkin Seed - 12.5
blueberrys 4.54
Raisins Grade1 10 kg
Cashew W240 25 kg
abcd xyz product`;
}

function exportParserExcel() {
  if (!parsedResults.length) return;
  const rows = [['#','Raw Input','Matched Product','Internal Code','QueBuster ID','Unit','Qty','Confidence %','Status','Unit Warning']];
  parsedResults.forEach((r, i) => {
    const p = r.product;
    const unitWarn = r.detectedUnit && p && r.detectedUnit !== p.unit ? 'MISMATCH: written ' + r.detectedUnit + ', expected ' + p.unit : '';
    rows.push([
      i + 1,
      r.raw,
      p ? p.name : '',
      p ? p.barcode : '',
      p ? p.quebuster : '',
      p ? p.unit : '',
      r.qty !== null ? r.qty : '',
      r.score + '%',
      { ok: 'Matched', review: 'Please Verify', fail: 'Not Found' }[r.status],
      unitWarn
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [4,30,30,14,12,10,8,12,14,30].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Parsed Stock');
  const fname = 'Stock_Parser_' + safeDate() + '.xlsx';
  XLSX.writeFile(wb, fname, { bookType: 'xlsx' });
}

function copyReport() {
  if (!parsedResults.length) return;
  let txt = `STOCK PARSE REPORT — ${today()}\n${'='.repeat(60)}\n\n`;
  parsedResults.forEach((r, i) => {
    const p = r.product;
    const flag = r.status === 'review' ? ' ⚠️ PLEASE VERIFY' : r.status === 'fail' ? ' ❌ NOT FOUND' : '';
    txt += `${i+1}. ${r.raw}\n`;
    txt += `   → ${p ? p.name : 'UNMATCHED'} | Confidence: ${r.score}%${flag}\n`;
    if (p) txt += `   ID: ${p.barcode} | QB: ${p.quebuster} | Unit: ${p.unit} | Qty: ${r.qty ?? '?'}\n`;
    txt += '\n';
  });
  navigator.clipboard.writeText(txt).then(() => {
    const btn = document.querySelector('.btn-copy');
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = '📋 Copy Report', 2000);
  });
}

// ══════════════════════════════════════════
//  TAB 2: STOCK ENTRY
// ══════════════════════════════════════════

let selectedProduct = null;
let entryLog = [];

// Build combined lookup from both audit products and product master
const allSearchable = AUDIT_PRODUCTS.map(p => {
  const masterEntry = PRODUCT_MASTER[p.quebuster];
  return {
    name: p.name,
    masterName: masterEntry ? masterEntry.name : '',
    barcode: p.barcode,
    quebuster: p.quebuster,
    unit: p.unit,
    nameLower: p.name.toLowerCase(),
    tokens: tokenize(p.name)
  };
});

function searchProducts() {
  const q = document.getElementById('product-search').value.trim();
  const dd = document.getElementById('search-dropdown');
  if (q.length < 1) { dd.classList.add('hidden'); return; }

  const ql = q.toLowerCase();
  const qTokens = tokenize(q);

  const scored = allSearchable.map(p => {
    let score = 0;
    // Exact barcode match
    if (p.barcode === q || p.quebuster === q) score = 1;
    // Starts with
    else if (p.nameLower.startsWith(ql)) score = 0.95;
    // Contains
    else if (p.nameLower.includes(ql)) score = 0.85;
    // Token overlap
    else score = tokenOverlap(qTokens, p.tokens) * 0.8;
    return { ...p, score };
  })
  .filter(p => p.score > 0.2)
  .sort((a, b) => b.score - a.score)
  .slice(0, 10);

  if (!scored.length) { dd.classList.add('hidden'); return; }

  dd.innerHTML = scored.map(p => {
    const hl = highlight(p.name, q);
    return `<div class="search-item" onclick="selectProduct(${JSON.stringify(p).replace(/"/g, '&quot;')})">
      <div class="search-item-name">${hl}</div>
      <div class="search-item-meta">Internal: ${p.barcode} · QB: ${p.quebuster} · ${p.unit}</div>
    </div>`;
  }).join('');
  dd.classList.remove('hidden');
}

function highlight(text, query) {
  if (!query) return esc(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return esc(text);
  return esc(text.substring(0, idx)) +
    `<span class="match-highlight">${esc(text.substring(idx, idx + query.length))}</span>` +
    esc(text.substring(idx + query.length));
}

function selectProduct(p) {
  selectedProduct = p;
  document.getElementById('product-search').value = p.name;
  document.getElementById('search-dropdown').classList.add('hidden');
  document.getElementById('sp-name').textContent = p.name;
  document.getElementById('sp-barcode').textContent = p.barcode;
  document.getElementById('sp-qb').textContent = p.quebuster;
  document.getElementById('sp-unit').textContent = p.unit;
  document.getElementById('selected-product').classList.remove('hidden');
  document.getElementById('entry-error').classList.add('hidden');
  document.getElementById('qty-input').focus();
}

function clearSelection() {
  selectedProduct = null;
  document.getElementById('product-search').value = '';
  document.getElementById('qty-input').value = '';
  document.getElementById('remark-input').value = '';
  document.getElementById('unit-override').value = '';
  document.getElementById('loc-select').value = '';
  document.getElementById('selected-product').classList.add('hidden');
  document.getElementById('search-dropdown').classList.add('hidden');
  document.getElementById('entry-error').classList.add('hidden');
}

function addEntry() {
  const errEl = document.getElementById('entry-error');
  errEl.classList.add('hidden');

  if (!selectedProduct) { showError('Please search and select a product first.'); return; }
  const qtyVal = document.getElementById('qty-input').value.trim();
  if (!qtyVal || isNaN(parseFloat(qtyVal)) || parseFloat(qtyVal) <= 0) {
    showError('Please enter a valid quantity greater than 0.'); return;
  }
  const qty = parseFloat(qtyVal);
  const unitOverride = document.getElementById('unit-override').value;
  const unit = unitOverride || selectedProduct.unit;
  const loc = document.getElementById('loc-select').value;
  const remark = document.getElementById('remark-input').value.trim();
  const now = new Date();

  // Unit mismatch warning (don't block, just warn)
  if (unitOverride && unitOverride !== selectedProduct.unit) {
    showError(`⚠️ Unit override "${unitOverride}" differs from expected "${selectedProduct.unit}". Entry added but flagged.`, 'warn');
  }

  entryLog.push({
    id: Date.now(),
    name: selectedProduct.name,
    barcode: selectedProduct.barcode,
    quebuster: selectedProduct.quebuster,
    qty,
    unit,
    expectedUnit: selectedProduct.unit,
    location: loc,
    remark,
    time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString('en-IN')
  });

  renderEntryLog();
  clearSelection();
}

function showError(msg, type = 'error') {
  const el = document.getElementById('entry-error');
  el.textContent = msg;
  el.style.background = type === 'warn' ? 'rgba(245,158,11,.12)' : 'rgba(239,68,68,.12)';
  el.style.borderColor = type === 'warn' ? 'rgba(245,158,11,.3)' : 'rgba(239,68,68,.3)';
  el.style.color = type === 'warn' ? 'var(--amber)' : 'var(--red)';
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function removeEntry(id) {
  entryLog = entryLog.filter(e => e.id !== id);
  renderEntryLog();
}

function renderEntryLog() {
  const wrap = document.getElementById('entry-log-wrap');
  const header = document.getElementById('entry-log-header');
  const empty = document.getElementById('empty-log');
  const body = document.getElementById('entry-log-body');

  if (!entryLog.length) {
    wrap.classList.add('hidden');
    header.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  wrap.classList.remove('hidden');
  header.classList.remove('hidden');
  empty.classList.add('hidden');

  document.getElementById('log-count').textContent = entryLog.length + ' entr' + (entryLog.length === 1 ? 'y' : 'ies');
  document.getElementById('log-date').textContent = 'Date: ' + entryLog[0].date;

  body.innerHTML = entryLog.map((e, i) => {
    const unitWarn = e.unit !== e.expectedUnit
      ? `<span title="Unit mismatch!" style="color:var(--amber)"> ⚠️</span>` : '';
    return `<tr>
      <td>${i + 1}</td>
      <td class="product-name-cell">${esc(e.name)}</td>
      <td><span class="id-chip">${esc(e.barcode)}</span></td>
      <td><span class="id-chip">${esc(e.quebuster)}</span></td>
      <td class="qty-cell">${e.qty}</td>
      <td>${esc(e.unit)}${unitWarn}</td>
      <td>${esc(e.location) || '<span style="color:var(--text3)">—</span>'}</td>
      <td>${esc(e.remark) || '<span style="color:var(--text3)">—</span>'}</td>
      <td style="color:var(--text2)">${e.time}</td>
      <td><button class="delete-btn" onclick="removeEntry(${e.id})">✕ Remove</button></td>
    </tr>`;
  }).join('');
}

function clearLog() {
  if (!confirm('Clear all entries? This cannot be undone.')) return;
  entryLog = [];
  renderEntryLog();
}

function exportEntryExcel() {
  if (!entryLog.length) return;
  const date = safeDate();
  const rows = [
    ['Uni Nuts India LLP - Daily Stock Entry Log'],
    ['Date: ' + date + '  |  Exported: ' + new Date().toLocaleString('en-IN')],
    [],
    ['#', 'Product Name', 'Internal Code', 'QueBuster ID', 'Quantity', 'Unit', 'Expected Unit', 'Unit Match', 'Location', 'Remark', 'Time']
  ];
  entryLog.forEach((e, i) => {
    rows.push([
      i + 1,
      e.name,
      e.barcode,
      e.quebuster,
      e.qty,
      e.unit,
      e.expectedUnit,
      e.unit === e.expectedUnit ? 'OK' : 'MISMATCH',
      e.location,
      e.remark,
      e.time
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } }];
  ws['!cols'] = [4, 32, 14, 12, 10, 10, 12, 10, 18, 22, 8].map(w => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DailyStock');
  const fname = 'DailyStock_' + date + '.xlsx';
  XLSX.writeFile(wb, fname, { bookType: 'xlsx' });
}

// ── Helpers ────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function safeDate() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return dd + '-' + mm + '-' + yyyy;
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) {
    document.getElementById('search-dropdown').classList.add('hidden');
  }
});

// Enter key in qty
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('qty-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addEntry();
  });
  document.getElementById('product-search').addEventListener('keydown', e => {
    if (e.key === 'Escape') document.getElementById('search-dropdown').classList.add('hidden');
  });
});
