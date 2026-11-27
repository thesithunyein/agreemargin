const main = document.querySelector('main');
const route = location.pathname;
const storageKey = 'agreemargin.requests.v1';
const referencePattern = /^([a-f0-9]{24})\.([a-f0-9]{64})$/;
const currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'SGD', 'INR', 'MMK'];
const decisions = { add: 'Approve change', swap: 'Approve swap' };
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  file: '<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10zM13 3v7h7M8 14h8m-8 3h5"/>',
  link: '<path d="m10 13 4-4m-6 7-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m2 8a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-1 1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 7V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  fee: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-14 5h3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  print: '<path d="M6 8V3h12v5m0 8h3V9H3v7h3m0-2h12v7H6zM7 11h1"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5m-3-4a7 7 0 0 1 12-2l2 3M4 15l2 3a7 7 0 0 0 12-2"/>'
};
const amountFormats = new Map();

function icon(name) {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
}

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function money(cents, currency, delta = false) {
  if (!Number.isSafeInteger(cents) || !currencies.includes(currency)) return '—';
  const key = `${currency}-${delta}`;
  if (!amountFormats.has(key)) {
    amountFormats.set(key, new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: delta ? 'exceptZero' : 'auto' }));
  }
  return amountFormats.get(key).format((cents || 0) / 100);
}

function timing(days) {
  return days === 0 ? 'No change' : `+${days} ${days === 1 ? 'day' : 'days'}`;
}

function date(timestamp, time = false) {
  return Intl.DateTimeFormat(undefined, time ? { dateStyle: 'medium', timeStyle: 'long' } : { dateStyle: 'medium' }).format(timestamp);
}

function render(html, loading = false) {
  main.innerHTML = html;
  main.setAttribute('aria-busy', String(loading));
}

function setTitle(title) {
  document.title = `${title} — AgreeMargin`;
}

function link(path, ref) {
  return `${location.origin}${path}#${ref}`;
}

function feedback(form, message = '') {
  form.querySelector('.form-feedback').textContent = message;
}

function pending(button, label) {
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = label;
  return () => {
    button.disabled = false;
    button.innerHTML = original;
  };
}

async function api(method, role, ref, data) {
  const parsed = ref && referencePattern.exec(ref);
  if (ref && !parsed) throw new Error('Open the full request link.');
  const path = parsed ? `/api/requests/${parsed[1]}/${role}` : '/api/requests';
  const headers = { Accept: 'application/json' };
  if (parsed) headers.Authorization = `Bearer ${parsed[2]}`;
  if (data) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { method, headers, body: data && JSON.stringify(data), cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const problem = new Error(result.error || 'Could not load the request. Try again.');
    problem.status = response.status;
    throw problem;
  }
  return result;
}

function saved() {
  try {
    const records = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(records) ? records.filter((item) => referencePattern.test(item?.ref) && typeof item?.title === 'string') : [];
  } catch {
    return [];
  }
}

function saveList(list) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(list));
    return true;
  } catch {
    // The manage link still works when local storage is unavailable.
    return false;
  }
}

function remember(record, ref) {
  const records = saved();
  const item = { ref, title: record.title, project: record.project };
  const index = records.findIndex((entry) => entry.ref === ref);
  if (index === -1) records.unshift(item);
  else records[index] = item;
  saveList(records);
}

function status(record) {
  if (record.status === 'decided') {
    return { add: ['Approved', 'approved'], swap: ['Swap approved', 'approved'], keep: ['Original kept', 'neutral'] }[record.choice];
  }
  return { open: ['Pending', 'pending'], withdrawn: ['Withdrawn', 'neutral'], expired: ['Expired', 'neutral'] }[record.status] ?? ['Unavailable', 'neutral'];
}

function badge(record) {
  const [label, tone] = status(record);
  return `<span class="status ${tone}">${label}</span>`;
}

function heading(title, description = '') {
  return `<div><h1 class="page-title">${title}</h1>${description ? `<p class="page-description">${description}</p>` : ''}</div>`;
}

function amountFor(data, choice) {
  return choice === 'add' ? data.addCents : 0;
}

function impact(data, choice = 'add') {
  return `<dl class="impact" aria-label="Project impact"><div><dt>${icon('fee')}Fee change</dt><dd data-impact-fee class="number">${escape(money(amountFor(data, choice), data.currency, true))}</dd></div><div><dt>${icon('calendar')}Timeline</dt><dd data-impact-time class="number">${timing(choice === 'add' ? data.addDays : 0)}</dd></div></dl>`;
}

function updateImpact(container, data, choice) {
  container.querySelector('[data-impact-fee]').textContent = money(amountFor(data, choice), data.currency, true);
  container.querySelector('[data-impact-time]').textContent = timing(choice === 'add' ? data.addDays : 0);
}

function scope(data, choice = 'add') {
  if (choice === 'keep') return '<p class="muted">The original scope and schedule apply.</p>';
  const details = choice === 'swap' ? data.swap : data.details;
  const lines = details?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
  return lines.length ? `<ul class="scope-list">${lines.map((item) => `<li>${icon('check')}<span>${escape(item)}</span></li>`).join('')}</ul>` : '<p class="muted">Scope items appear here as you type.</p>';
}

function scopeSection(data, choice = 'add') {
  return `<section class="scope"><div class="baseline" data-baseline ${data.baseline ? '' : 'hidden'}><h2>Original agreement</h2><p>${escape(data.baseline)}</p></div><h2 data-scope-label>${choice === 'swap' ? 'Scope swap' : 'Scope items'}</h2><div data-scope-items>${scope(data, choice)}</div></section>`;
}

function updateScope(container, data, choice) {
  const baseline = container.querySelector('[data-baseline]');
  baseline.hidden = !data.baseline;
  baseline.querySelector('p').textContent = data.baseline ?? '';
  container.querySelector('[data-scope-label]').textContent = choice === 'swap' ? 'Scope swap' : 'Scope items';
  container.querySelector('[data-scope-items]').innerHTML = scope(data, choice);
}

function heroGlobe() {
  const colors = ['#429B7D', '#81CAA9', '#AAE5C6', '#3C795F', '#669BA0', '#D5B378'];
  const count = 700;
  const dots = Array.from({ length: count }, (_, index) => {
    const y = 1 - 2 * (index + .5) / count;
    const radius = Math.sqrt(1 - y * y);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius, color: colors[index % colors.length] };
  }).filter(({ z }) => z > 0).sort((a, b) => a.z - b.z);
  return `<div class="hero-art" aria-hidden="true"><svg viewBox="0 0 440 360" fill="none">
    <defs><radialGradient id="globe-light" cx="35%" cy="27%" r="70%"><stop stop-color="#19352B"/><stop offset="1" stop-color="#080D0B"/></radialGradient></defs>
    <circle cx="220" cy="180" r="126" fill="url(#globe-light)"/>
    <ellipse cx="220" cy="180" rx="180" ry="63" transform="rotate(-26 220 180)" stroke="#557064" stroke-dasharray="3 6"/>
    ${dots.map(({ x, y, z, color }) => `<circle cx="${(220 + x * 124).toFixed(2)}" cy="${(180 + y * 124).toFixed(2)}" r="${(1.2 + z * 2.05).toFixed(2)}" fill="${color}" opacity="${(.44 + z * .47).toFixed(2)}"/>`).join('')}
    <path d="M382 100C408 150 343 225 250 270S74 317 57 274" stroke="#A4D9BE" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="382" cy="100" r="10" fill="#19352B"/><circle cx="382" cy="100" r="4" fill="#A4D9BE"/>
    <circle cx="57" cy="274" r="4" fill="#A4D9BE"/>
  </svg></div>`;
}

function workflowArt(symbol) {
  return `<span class="workflow-art" aria-hidden="true"><span class="workflow-object">${icon(symbol)}</span></span>`;
}

function home() {
  const steps = [
    ['file', 'Set the terms', 'List the extra work, fee, and time.'],
    ['link', 'Send one link', 'Your client chooses what to do.'],
    ['check', 'Keep the receipt', 'See what they agreed to and when.']
  ];
  render(`<div class="landing"><section class="orbit-hero" aria-labelledby="home-title">
    <div class="orbit-copy shell">
      <a class="orbit-guide" href="#workflow">See how it works</a>
      <h1 id="home-title"><span><span>Extra work.</span></span> <span><span>Clear approval.</span></span></h1>
      <p>Agree on the fee and timeline before you start.</p>
      <div class="actions"><a class="button secondary" href="/workspace">My requests</a><a class="button primary" href="/new">New request</a></div>
    </div>
    ${heroGlobe()}</section>
    <section class="workflow-band" id="workflow" aria-labelledby="workflow-title"><div class="workflow shell"><h2 id="workflow-title">How it works</h2><ol class="workflow-steps">${steps.map(([name, title, description]) => `<li>${workflowArt(name)}<div><h3>${title}</h3><p>${description}</p></div></li>`).join('')}</ol></div></section>
    <section class="shell landing-section why-agreemargin" aria-labelledby="why-title">
      <div><h2 id="why-title">Why AgreeMargin?</h2><p>When the work changes, give the new terms a place of their own.</p></div>
      <dl class="landing-options">
        <div><dt>Make the tradeoff clear</dt><dd>Show what the new work costs and how it affects delivery.</dd></div>
        <div><dt>Keep the quote current</dt><dd>Send one link. Clients review the latest revision before they decide.</dd></div>
        <div><dt>Match payment to the work</dt><dd>Optional Sui Testnet checkout verifies the transfer against the accepted revision. <a href="/docs#test-payment">How verification works</a></dd></div>
      </dl>
    </section>
    <section class="shell landing-section" aria-labelledby="client-options-title">
      <div><h2 id="client-options-title">Give clients a clear choice</h2><p>One review link shows the fee, the timing, and the options you offer.</p></div>
      <dl class="landing-options">
        <div><dt>Keep the original scope</dt><dd>Continue with the agreed work, fee, and schedule.</dd></div>
        <div><dt>Swap work</dt><dd>Trade one deliverable for another if you’ve offered a swap.</dd></div>
        <div><dt>Add the extra work</dt><dd>Approve the proposed work, extra fee, and revised timeline.</dd></div>
      </dl>
    </section>
    <section class="landing-record" aria-labelledby="studio-record-title"><div class="shell landing-section">
      <div><h2 id="studio-record-title">Know what was agreed</h2><p>Track requests in one place and keep a receipt for each response.</p></div>
      <div class="landing-record-details"><ul>
        <li>${icon('check')}<span>See which revision your client accepted.</span></li>
        <li>${icon('check')}<span>Print the decision with its date and time.</span></li>
        <li>${icon('check')}<span>See pending fees and estimated margin.</span></li>
      </ul><a class="text-action" href="/workspace">Open my requests</a></div>
    </div></section>
    <section class="shell landing-faq" aria-labelledby="landing-faq-title"><h2 id="landing-faq-title">Common questions</h2><div class="faq-list">
      <details><summary>Do clients need an account?</summary><p>Clients open the link, choose an option, and enter their name.</p></details>
      <details><summary>Can I edit a sent request?</summary><p>Yes, while it’s open. Edit it from your manage link. Your client uses the same review link.</p></details>
      <details><summary>Do clients need a wallet?</summary><p>Only for optional test payments. Regular approvals work in the browser.</p></details>
    </div><a class="text-action" href="/faq">View all questions</a></section></div>`);
}

function newRequest(existing = null, ref = null) {
  setTitle(existing ? 'Revise request' : 'New request');
  const blank = { addCents: 0, addDays: 0, currency: 'USD', details: '' };
  render(`<div class="shell page"><header class="page-head">${heading(existing ? 'Revise request' : 'New request', existing ? 'The same review link will show the new terms.' : 'Set the terms your client will review.')}</header>
    <nav class="mobile-views" aria-label="Editor view"><button type="button" data-view="edit" aria-pressed="true">Edit terms</button><button type="button" data-view="preview" aria-pressed="false">Client preview</button></nav>
    <div class="editor-layout"><form class="card editor" id="compose"><section class="editor-section" aria-labelledby="scope-title"><h2 id="scope-title">Scope</h2>
      <div class="fields"><div class="field"><label for="studio">Name or studio</label><input id="studio" name="studio" required maxlength="80" autocomplete="organization"></div><div class="field"><label for="project">Project</label><input id="project" name="project" required maxlength="100"></div></div>
      <div class="field"><label for="title">Change title</label><input id="title" name="title" required maxlength="120" placeholder="Add a pricing page"></div>
      <div class="field"><label for="baseline">Original agreement <span class="optional">Optional</span></label><input id="baseline" name="baseline" maxlength="900" placeholder="What did the project already include?"></div>
      <div class="field"><label for="details">Scope items</label><textarea id="details" name="details" required maxlength="1200" aria-describedby="scope-hint"></textarea><span id="scope-hint" class="hint">One deliverable per line.</span></div></section>
      <section class="editor-section" aria-labelledby="impact-title"><h2 id="impact-title">Fee and timing</h2>
      <div class="fields three"><div class="field"><label for="currency">Currency</label><div class="select-wrap"><select id="currency" name="currency">${currencies.map((currency) => `<option>${currency}</option>`).join('')}</select>${icon('chevron')}</div></div>
      <div class="field"><label for="amount">Extra fee</label><input id="amount" name="amount" class="number" type="number" inputmode="decimal" min="0" max="999999.99" step="0.01" placeholder="0.00" required></div>
      <div class="field"><label for="days">Extra days</label><input id="days" name="days" class="number" type="number" inputmode="numeric" min="0" max="365" step="1" value="0" required></div></div>
      <div class="field"><label for="delivery">Delivery cost <span class="optional">Optional</span></label><input id="delivery" name="delivery" class="number" type="number" inputmode="decimal" min="0" max="999999.99" step="0.01" aria-describedby="delivery-hint"><span class="hint" id="delivery-hint">Private estimate for your margin.</span></div>
      <div class="field"><label for="swap">Scope swap <span class="optional">Optional</span></label><textarea id="swap" name="swap" maxlength="600" placeholder="Replace the FAQ page with a pricing page."></textarea></div></section>
      <section class="editor-section"><label class="checkout-toggle"><input id="test-checkout" type="checkbox"><span><strong>Collect test USDC</strong><small>Optional checkout on Sui Testnet. Test funds only.</small></span></label>
      <div class="field" id="receiver-field" hidden><label for="receiver">Receiving wallet</label><input id="receiver" name="receiver" spellcheck="false" autocomplete="off" disabled pattern="0[xX][0-9a-fA-F]{64}" placeholder="0x…" aria-describedby="wallet-hint"><span id="wallet-hint" class="hint">Use a Sui Testnet address. The fee is quoted in USD.</span></div></section>
      <div class="editor-submit"><p class="form-feedback" role="alert"></p><button class="button primary" type="submit">${icon('link')}${existing ? 'Save new revision' : 'Create review link'}</button></div>
    </form><aside class="card editor-preview enter" id="preview" aria-labelledby="preview-heading"><div class="document-line"><h2 id="preview-heading">Client preview</h2><span>Rev ${String((existing?.revision ?? 0) + 1).padStart(2, '0')}</span></div>
      <header class="card-heading"><div><p class="meta" id="preview-project" hidden></p><h3 id="preview-title">Untitled change</h3></div></header>${impact(blank)}${scopeSection(blank)}<p class="swap-preview" id="preview-swap" hidden></p><p class="hint" id="preview-checkout" hidden>Payment in test USDC after approval.</p></aside></div></div>`);
  const form = document.querySelector('#compose');
  const preview = document.querySelector('#preview');
  const project = document.querySelector('#preview-project');
  const swap = document.querySelector('#preview-swap');
  let attempt;
  const toggle = document.querySelector('#test-checkout');
  function checkoutFields() {
    const on = toggle.checked;
    document.querySelector('#receiver-field').hidden = !on;
    form.elements.receiver.disabled = !on;
    form.elements.receiver.required = on;
    if (on) form.elements.currency.value = 'USD';
    for (const option of form.elements.currency.options) option.disabled = on && option.value !== 'USD';
    form.elements.amount.min = on ? '0.01' : '0';
    document.querySelector('#preview-checkout').hidden = !on;
  }
  if (existing) {
    for (const key of ['studio', 'project', 'title', 'details', 'swap', 'currency', 'receiver', 'baseline']) form.elements[key].value = existing[key] ?? '';
    form.elements.amount.value = (existing.addCents / 100).toFixed(2);
    form.elements.days.value = existing.addDays;
    form.elements.delivery.value = existing.deliveryCents == null ? '' : (existing.deliveryCents / 100).toFixed(2);
    toggle.checked = Boolean(existing.receiver);
  }
  checkoutFields();
  refresh();
  toggle.addEventListener('change', () => { checkoutFields(); refresh(); });
  const viewButtons = [...document.querySelectorAll('[data-view]')];
  for (const tab of viewButtons) tab.addEventListener('click', () => {
    document.querySelector('.editor-layout').dataset.active = tab.dataset.view;
    for (const item of viewButtons) item.setAttribute('aria-pressed', String(item === tab));
  });
  function refresh() {
    const values = Object.fromEntries(new FormData(form));
    document.querySelector('#preview-title').textContent = values.title.trim() || 'Untitled change';
    project.textContent = [values.project.trim(), values.studio.trim()].filter(Boolean).join(' · ');
    project.hidden = !project.textContent;
    const data = { ...values, addCents: Math.round(Number(values.amount) * 100), addDays: Number(values.days) };
    updateImpact(preview, data, 'add');
    updateScope(preview, data, 'add');
    swap.hidden = !data.swap.trim();
    swap.textContent = swap.hidden ? '' : `Swap option — ${data.swap.trim()}`;
  }
  form.addEventListener('input', refresh);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback(form);
    const button = event.submitter;
    if (!button || button.disabled) return;
    const restore = pending(button, 'Creating link…');
    const { amount, days, delivery, ...values } = Object.fromEntries(new FormData(form));
    const payload = { ...values, addCents: Math.round(Number(amount) * 100), addDays: Number(days), deliveryCents: delivery === '' ? null : Math.round(Number(delivery) * 100) };
    const signature = JSON.stringify(payload);
    if (attempt?.signature !== signature) attempt = { signature, ownerKey: hex(crypto.getRandomValues(new Uint8Array(32))) };
    try {
      if (existing) {
        await api('PATCH', 'manage', ref, { ...payload, revision: existing.revision });
        location.assign(link('/manage', ref));
        return;
      }
      const created = await api('POST', null, null, { ...payload, ownerKey: attempt.ownerKey });
      remember(created, created.ownerRef);
      location.assign(link('/manage', created.ownerRef));
    } catch (error) {
      feedback(form, error.name === 'TimeoutError' ? 'The request timed out. Try again to recover the same link.' : error.message);
      restore();
    }
  });
}

function requestHeader(data) {
  return `<div class="document-line"><span>${icon('file')} Change request</span><span>Rev ${String(data.revision ?? 1).padStart(2, '0')}</span></div><header class="receipt-header"><div class="receipt-meta"><p class="meta">${escape(data.project)} · ${escape(data.studio)}</p>${badge(data)}</div><h1>${escape(data.title)}</h1></header>`;
}

function decisionRecord(data) {
  return `<section class="record-summary enter"><h2>${icon('check')}Decision recorded</h2><dl class="record-details">
    <dt>Recorded by</dt><dd>${escape(data.respondent)}</dd><dt>Decision time</dt><dd><time datetime="${new Date(data.decidedAt).toISOString()}">${escape(date(data.decidedAt, true))}</time></dd>
    <dt>Reference</dt><dd class="number reference">${escape(data.id)}</dd></dl><button class="button secondary print" type="button">${icon('print')}Print receipt</button></section>`;
}

function closedRecord(data) {
  return `<section class="record-summary"><h2>${data.status === 'expired' ? 'Request expired' : 'Request withdrawn'}</h2><p class="muted">Ask the sender for a new review link.</p></section>`;
}

function paymentSection(data) {
  const p = data.payment;
  if (!p) return '';
  const verified = p.state === 'verified';
  return `<section class="settlement"><div class="document-line"><span>${icon('fee')} Payment</span><span>Sui Testnet</span></div>
    <h2>${verified ? 'Test transfer verified' : 'Test payment pending'}</h2><p class="settlement-amount number">${(data.addCents / 100).toFixed(2)} test USDC</p>
    <p class="hint">Test funds have no cash value.</p>
    ${verified ? `<p class="hint">Confirmed ${escape(date(p.chainTime, true))} · Checkpoint ${escape(p.checkpoint)}</p><a class="text-action" href="https://suiscan.xyz/testnet/tx/${encodeURIComponent(p.digest)}" target="_blank" rel="noreferrer">View transaction ↗</a>` :
      `<p class="hint">The terms are approved. You can come back to this link to finish payment or verify a transfer.</p><ol class="payment-steps">
        <li><strong>Prepare your wallet.</strong> Open Slush, switch to Sui Testnet, and check that your wallet has test USDC for the fee and test SUI for network fees. <a href="/docs#test-payment" target="_blank" rel="noopener">Wallet setup guide ↗</a></li>
        ${data.payUrl ? `<li><strong>Review and send.</strong> Open checkout and confirm the test network, amount, and receiving address in your wallet.<br><a class="button primary" href="${escape(data.payUrl)}" target="_blank" rel="noreferrer">Open test checkout ↗</a></li>` : '<li><strong>Wait for the client to send.</strong> The checkout is on their review link.</li>'}
        <li><strong>Verify the transfer.</strong> In your wallet activity, open the payment and copy its transaction ID. If the client sent it, ask them to share the ID.</li>
      </ol>
      <form id="verify-payment" class="no-print"><div class="field"><label for="digest">Transaction ID</label><input id="digest" name="digest" required maxlength="44" autocomplete="off" spellcheck="false" aria-describedby="digest-help"><p class="hint" id="digest-help">Paste the ID from the wallet. It may be labeled “digest”.</p></div><button class="button secondary" type="submit">Verify transfer</button><p class="form-feedback" role="alert"></p></form>`}
    <details><summary>Payment details</summary><dl class="record-details"><dt>Pay from</dt><dd class="reference number">${escape(p.payer)}</dd><dt>Pay to</dt><dd class="reference number">${escape(data.receiver)}</dd><dt>Revision hash</dt><dd class="reference number">${escape(p.commitment)}</dd></dl></details>
    <button class="text-action no-print" type="button" id="export-proof">Download revision record</button></section>`;
}

function bindPayment(data, ref, role) {
  if (!data.payment) return;
  document.querySelector('#export-proof').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ ...data.payment, hashAlgorithm: 'SHA-256', encoding: 'UTF-8' }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agreemargin-' + data.id + '-rev-' + data.revision + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  });
  document.querySelector('#verify-payment')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const restore = pending(form.querySelector('button'), 'Checking Sui Testnet…');
    feedback(form);
    try {
      const updated = await api('POST', role + '/payment', ref, { digest: form.elements.digest.value.trim() });
      if (role === 'manage') await manage(updated, ref);
      else review(updated, ref);
      main.focus();
    } catch (error) { feedback(form, error.message); restore(); }
  });
}

function review(data, ref, notice = '', draft = null) {
  setTitle(data.status === 'decided' ? 'Decision receipt' : 'Client approval');
  const choice = data.choice ?? 'add';
  const options = [['add', 'Add the change'], ...(data.swap ? [['swap', 'Swap work']] : []), ['keep', 'Keep original scope']];
  const form = `<form id="decision" class="decision-form"><fieldset><legend>Choose how to proceed</legend>${options.map(([key, label]) => `<label class="choice"><input type="radio" name="choice" value="${key}"${key === choice ? ' checked' : ''}><strong>${label}</strong><span class="number">${key === 'add' ? escape(money(data.addCents, data.currency, true)) : 'Same fee'}</span></label>`).join('')}</fieldset>
    <div class="field"><label for="respondent">Your name</label><input id="respondent" name="name" autocomplete="name" required maxlength="80"></div>
    ${data.receiver ? `<div class="field" id="payer-field"><label for="payer">Your paying wallet · Sui Testnet</label><input id="payer" name="payer" required pattern="0x[0-9a-fA-F]{64}" autocomplete="off" spellcheck="false" placeholder="0x…"><span class="hint">Copy your public address from Slush. <a href="/docs#test-payment" target="_blank" rel="noopener">New to wallets? Set one up ↗</a><br> The studio receives test USDC at <span class="wallet-address">${escape(data.receiver)}</span>.</span></div>` : ''}<p class="hint">Your name appears as entered on the receipt. Reply by ${escape(date(data.expiresAt))}.</p><p class="form-feedback" role="alert"></p><button type="submit" class="button primary sign-off">${icon('check')}${data.receiver ? 'Approve terms' : 'Approve change'}</button></form>`;
  render(`<div class="shell receipt-shell"><article class="card receipt-card">${notice ? `<p class="revision-notice" role="alert">${escape(notice)}</p>` : ''}${requestHeader(data)}${impact(data, choice)}${scopeSection(data, choice)}${data.status === 'open' ? form : data.status === 'decided' ? decisionRecord(data) + paymentSection(data) : closedRecord(data)}</article></div>`);
  bindPayment(data, ref, 'review');
  document.querySelector('.print')?.addEventListener('click', () => print());
  const node = document.querySelector('#decision');
  if (!node) return;
  if (draft) node.elements.name.value = draft.name;
  const button = node.querySelector('button');
  const card = document.querySelector('.receipt-card');
  node.addEventListener('change', (event) => {
    if (event.target.name !== 'choice') return;
    const next = event.target.value;
    updateImpact(card, data, next);
    updateScope(card, data, next);
    if (node.elements.payer) {
      node.elements.payer.disabled = next !== 'add';
      document.querySelector('#payer-field').hidden = next !== 'add';
    }
    button.innerHTML = `${icon('check')}${next === 'add' && data.receiver ? 'Approve terms' : next === 'keep' ? 'Confirm choice' : decisions[next]}`;
  });
  node.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    feedback(node);
    const values = Object.fromEntries(new FormData(node));
    const restore = pending(button, 'Recording…');
    const choices = [...node.querySelectorAll('input[type=radio]')];
    for (const radio of choices) radio.disabled = true;
    try {
      review(await api('POST', 'review', ref, { ...values, revision: data.revision }), ref);
      main.focus();
    } catch (error) {
      if (error.status === 409) {
        await openRequest('review', error.message, { ...data, name: values.name });
        main.focus();
        return;
      }
      feedback(node, error.name === 'TimeoutError' ? 'Could not confirm the decision. Refresh to check its status.' : error.message);
      for (const radio of choices) radio.disabled = false;
      restore();
    }
  });
}

async function clientLink(ref) {
  const [id, ownerKey] = ref.split('.');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`AgreeMargin client link v1:${ownerKey}`));
  return link('/review', `${id}.${hex(new Uint8Array(bytes))}`);
}

function hex(bytes) {
  return Array.from(bytes, (part) => part.toString(16).padStart(2, '0')).join('');
}

function showDialog(title, copy, action = '') {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.innerHTML = `<form method="dialog"><h2 id="dialog-title">${title}</h2>${copy}<div class="actions">${action ? `<button class="button danger" value="confirm">${action}</button>` : ''}<button class="button secondary" value="cancel" autofocus>${action ? 'Cancel' : 'Close'}</button></div></form>`;
  const trigger = document.activeElement;
  document.body.append(dialog);
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => {
    const confirmed = dialog.returnValue === 'confirm';
    dialog.remove();
    trigger?.focus();
    resolve(confirmed);
  }, { once: true }));
}

async function copyLink(button, value, label = 'Link') {
  try {
    await navigator.clipboard.writeText(value);
    if (button.dataset.copied) return;
    const original = button.innerHTML;
    button.dataset.copied = 'true';
    button.innerHTML = `${icon('check')}Copied`;
    button.setAttribute('aria-live', 'polite');
    setTimeout(() => { button.innerHTML = original; delete button.dataset.copied; }, 1600);
  } catch {
    void showDialog(`Copy ${label.toLowerCase()}`, `<div class="field"><label for="copy-value">${label}</label><textarea id="copy-value" rows="${label === 'Client message' ? 7 : 2}" readonly>${escape(value)}</textarea></div>`);
    const field = document.querySelector('#copy-value');
    field.focus();
    field.select();
  }
}

async function manage(data, ref) {
  setTitle('Manage request');
  remember(data, ref);
  const url = await clientLink(ref);
  const clientMessage = [
    `Please review this change for ${data.project}`,
    data.title,
    `Extra fee: ${money(data.addCents, data.currency)} · Schedule: ${timing(data.addDays)}`,
    `Choose an option by ${date(data.expiresAt)}: ${url}`,
    'If you can’t open the link, let me know so I can check your access.'
  ].join('\n\n');
  const choice = data.choice ?? 'add';
  render(`<div class="shell receipt-shell"><article class="card receipt-card">${requestHeader(data)}${impact(data, choice)}${scopeSection(data, choice)}${data.status === 'decided' ? decisionRecord(data) : data.status === 'open' ? '' : closedRecord(data)}
    ${paymentSection(data)}<section class="manage-links no-print"><h2>${data.status === 'open' ? 'Send to your client' : 'Share the record'}</h2>
    <p class="hint">${data.status === 'open' ? `Send this review link to your client. Replies close ${escape(date(data.expiresAt))}.` : 'Use the review link to share the client view.'}</p>
    <div class="actions"><button class="button primary" id="copy-client" type="button">${icon('copy')}Copy review link</button>${data.status === 'open' ? '<button class="button secondary" id="copy-message" type="button">Copy client message</button>' : ''}<a class="button secondary" href="${escape(url)}" target="_blank" rel="noreferrer">Open client view ↗</a></div></section>
    <section class="manage-links no-print"><h2>Studio access</h2><p class="hint">Save the private manage link to open this request on another device.</p><div class="actions">${data.status === 'open' ? `<a class="button secondary" href="${link('/new', ref)}">Revise terms</a>` : ''}<button class="button secondary" id="copy-owner" type="button">${icon('copy')}Copy manage link</button></div>
    ${data.deliveryCents != null ? `<p class="hint">Delivery cost <span class="number">${escape(money(data.deliveryCents, data.currency))}</span></p>` : ''}</section></article>
    <details class="request-controls no-print"><summary>More actions</summary><p class="form-feedback" role="alert"></p><div class="actions">${data.status === 'open' ? '<button class="button secondary" id="withdraw" type="button">Withdraw request</button>' : ''}<button class="button danger" id="delete" type="button">Delete request</button></div></details></div>`);
  document.querySelector('.print')?.addEventListener('click', () => print());
  bindPayment(data, ref, 'manage');
  document.querySelector('#copy-client').addEventListener('click', (event) => copyLink(event.currentTarget, url));
  document.querySelector('#copy-message')?.addEventListener('click', (event) => copyLink(event.currentTarget, clientMessage, 'Client message'));
  document.querySelector('#copy-owner').addEventListener('click', (event) => copyLink(event.currentTarget, link('/manage', ref)));
  document.querySelector('#withdraw')?.addEventListener('click', (event) => changeRequest(event.currentTarget, ref, false));
  document.querySelector('#delete').addEventListener('click', (event) => changeRequest(event.currentTarget, ref, true));
}

async function changeRequest(button, ref, remove) {
  const label = remove ? 'Delete request' : 'Withdraw request';
  const description = remove ? 'This permanently removes the request and disables both links.' : 'The review link will stop accepting a decision.';
  if (!(await showDialog(label, `<p>${description}</p>`, label))) return;
  const restore = pending(button, remove ? 'Deleting…' : 'Withdrawing…');
  try {
    const record = await api(remove ? 'DELETE' : 'POST', 'manage', ref);
    if (remove) {
      saveList(saved().filter((item) => item.ref !== ref));
      location.assign('/workspace');
    } else {
      await manage(record, ref);
      main.focus();
    }
  } catch (error) {
    document.querySelector('.form-feedback').textContent = error.message;
    restore();
  }
}

async function openRequest(role, notice = '', draft = null) {
  render('<div class="shell receipt-shell"><div class="card receipt-card" role="status"><span class="screen-reader">Loading request</span><div class="skeleton short"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>', true);
  const ref = location.hash.slice(1);
  try {
    if (!referencePattern.test(ref)) throw Object.assign(new Error('Open the full link from the sender.'), { status: 404 });
    const data = await api('GET', role === 'edit' ? 'manage' : role, ref);
    if (role === 'edit' && data.status === 'open') newRequest(data, ref);
    else if (role === 'edit') location.replace(link('/manage', ref));
    else if (role === 'review') {
      if (draft && data.status === 'open' && data.revision !== draft.revision) {
        notice = `The quote changed. Extra fee: ${money(draft.addCents, draft.currency)} → ${money(data.addCents, data.currency)}. Schedule: ${timing(draft.addDays)} → ${timing(data.addDays)}. Review the updated terms before confirming.`;
      }
      review(data, ref, notice, draft);
    }
    else await manage(data, ref);
  } catch (error) {
    setTitle('Request unavailable');
    render(`<div class="shell receipt-shell"><div class="card receipt-card">${heading('Request unavailable', escape(error.message))}<div class="actions error-actions">${error.status === 404 ? '<a class="button secondary" href="/">Home</a>' : '<button id="retry" class="button primary" type="button">Try again</button>'}</div></div></div>`);
    document.querySelector('#retry')?.addEventListener('click', () => openRequest(role, notice, draft));
  }
}

function currencyTotals(records, amount) {
  const totals = new Map();
  for (const record of records) totals.set(record.currency, (totals.get(record.currency) ?? 0) + amount(record));
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, cents]) => money(cents, currency));
}

function responseTime(records) {
  if (!records.length) return '—';
  const minutes = records.reduce((total, { decidedAt, createdAt }) => total + Math.max(0, decidedAt - createdAt), 0) / records.length / 60000;
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 1440) return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(minutes / 60)} hr`;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(minutes / 1440)} days`;
}

function metrics(records, loading = false) {
  const decided = records.filter((record) => record.status === 'decided');
  const approved = decided.filter((record) => record.choice === 'add');
  const costed = approved.filter((record) => Number.isSafeInteger(record.deliveryCents));
  const missing = approved.length - costed.length;
  const pending = records.filter((record) => record.status === 'open');
  const figures = [
    ['fee', 'Estimated margin', currencyTotals(costed, (record) => record.addCents - record.deliveryCents), missing ? `${missing} ${missing === 1 ? 'approval needs' : 'approvals need'} a delivery cost` : 'Approved fees less estimated delivery cost'],
    ['calendar', 'Pending amount', currencyTotals(pending, (record) => record.addCents), `${pending.length} ${pending.length === 1 ? 'request' : 'requests'} awaiting reply`],
    ['clock', 'Response time', [responseTime(decided)], 'Average across decisions']
  ];
  return figures.map(([symbol, title, values, caption]) => `<section class="card metric"><h2>${icon(symbol)}${title}</h2><p class="metric-value number">${(values.length ? values : ['—']).map((value) => `<span>${escape(value)}</span>`).join('')}</p><p class="hint">${loading ? 'Loading requests…' : caption}</p></section>`).join('');
}

function ledgerRows(entries) {
  return entries.map(({ item, record, index, loading }) => `<tr><th scope="row"><a href="${link('/manage', item.ref)}">${escape(record?.title ?? item.title)}</a><span class="meta">${escape(record?.project ?? item.project)}</span></th>
    <td>${loading ? '<span class="muted">Loading</span>' : badge(record ?? {})}${record?.payment ? `<span class="meta">${record.payment.state === 'verified' ? 'Test transfer verified' : 'Test payment pending'}</span>` : ''}</td><td class="ledger-fee number">${record ? escape(money(record.choice ? amountFor(record, record.choice) : record.addCents, record.currency)) : '—'}</td>
    <td class="date number">${record ? `<time datetime="${new Date(record.createdAt).toISOString()}">${escape(date(record.createdAt))}</time>` : '—'}</td>
    <td class="table-action">${record ? `<button type="button" class="button secondary copy-small" data-copy-index="${index}" aria-label="Copy review link for ${escape(record.title)}">${icon('copy')}Copy link</button>` : '—'}</td></tr>`).join('');
}

function workspace() {
  setTitle('My requests');
  const items = saved();
  render(`<div class="shell page"><header class="page-head ledger-head">${heading('My requests', 'Track requests saved in this browser.')}<div class="actions">${items.length ? `<button class="button secondary" id="refresh" type="button">${icon('refresh')}Refresh</button>` : ''}<a class="button primary" href="/new">${icon('plus')}New request</a></div></header>
    <div class="metrics" id="metrics" aria-busy="${Boolean(items.length)}">${metrics([], Boolean(items.length))}</div>
    <section class="card ledger" aria-labelledby="ledger-title"><div class="ledger-title"><h2 id="ledger-title" tabindex="-1">Requests</h2><p class="hint" id="ledger-feedback" role="status"></p></div>
    ${items.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Request ledger"><table><thead><tr><th scope="col">Request</th><th scope="col">Status</th><th scope="col" class="ledger-fee">Fee</th><th scope="col">Sent</th><th scope="col" class="table-action">Review link</th></tr></thead><tbody>${ledgerRows(items.map((item) => ({ item, loading: true })))}</tbody></table></div>` : '<div class="empty"><span class="outline-icon">' + icon('file') + '</span><h3>No requests yet</h3><p>Create a request to track its fee and decision here.</p></div>'}</section>
    <details class="recovery"><summary>Open a saved manage link</summary><form id="recover"><div class="field"><label for="manage-link">Manage link</label><input id="manage-link" type="url" name="link" autocomplete="off" required></div><button class="button secondary" type="submit">Open link</button><p class="form-feedback" role="alert"></p></form></details>
    <details class="recovery"><summary>Back up or restore your request list</summary>
      <p class="hint">Use a backup to open your requests in another browser. Keep this file private. Anyone with it can manage those requests.</p>
      <div class="actions"><button class="button secondary" id="export-requests" type="button"${items.length ? '' : ' disabled'}>Download backup</button></div>
      <form id="import-requests"><div class="field"><label for="request-backup">AgreeMargin backup file</label><input id="request-backup" name="backup" type="file" accept=".json,application/json" required></div><button class="button secondary" type="submit">Restore requests</button><p class="form-feedback" role="alert"></p></form></details></div>`);
  document.querySelector('#recover').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const url = new URL(new FormData(form).get('link'));
      if (url.origin !== location.origin || url.pathname !== '/manage' || !referencePattern.test(url.hash.slice(1))) throw new Error();
      location.assign(url.href);
    } catch {
      feedback(form, 'Paste a full AgreeMargin manage link.');
    }
  });
  document.querySelector('#export-requests').addEventListener('click', () => {
    const backup = JSON.stringify({ version: 1, origin: location.origin, requests: saved() });
    const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
    const download = document.createElement('a');
    download.href = url;
    download.download = 'agreemargin-request-backup.json';
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.querySelector('#import-requests').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const restore = pending(form.querySelector('button'), 'Restoring…');
    try {
      const file = form.elements.backup.files[0];
      if (!file?.size || file.size > 5 * 1024 * 1024) {
        feedback(form, 'Choose an AgreeMargin backup file under 5 MB.');
        return;
      }
      const backup = JSON.parse(await file.text());
      if (backup.version !== 1 || backup.origin !== location.origin ||
          !Array.isArray(backup.requests) || !backup.requests.length ||
          !backup.requests.every(item => typeof item?.ref === 'string' && referencePattern.test(item.ref) &&
            typeof item.title === 'string' && typeof item.project === 'string')) {
        feedback(form, 'Choose a valid backup from this AgreeMargin site.');
        return;
      }
      const local = new Map(saved().map(item => [item.ref, item]));
      for (const { ref, title, project } of backup.requests) {
        if (!local.has(ref)) local.set(ref, { ref, title, project });
      }
      if (!saveList([...local.values()])) {
        feedback(form, 'This browser could not save your requests. Check your storage settings and retry.');
        return;
      }
      workspace();
      const status = document.querySelector('#ledger-feedback');
      status.textContent = 'Request list restored. Checking availability…';
      document.querySelector('#ledger-title').focus();
    } catch {
      feedback(form, 'This file could not be read. Choose an AgreeMargin backup and try again.');
    } finally {
      restore();
    }
  });
  if (!items.length) return;
  const refresh = document.querySelector('#refresh');
  const values = document.querySelector('#metrics');
  const table = document.querySelector('tbody');
  let links = [];
  table.addEventListener('click', (event) => {
    const button = event.target.closest('[data-copy-index]');
    if (button) void copyLink(button, links[Number(button.dataset.copyIndex)]);
  });
  async function load() {
    const restore = pending(refresh, 'Refreshing…');
    const entries = [];
    for (let offset = 0; offset < items.length; offset += 8) {
      const batch = items.slice(offset, offset + 8);
      entries.push(...await Promise.all(batch.map(async (item, index) => {
        try {
          const [record, url] = await Promise.all([api('GET', 'manage', item.ref), clientLink(item.ref)]);
          return { item, record, url, index: offset + index };
        } catch {
          return { item, index: offset + index };
        }
      })));
    }
    entries.sort((a, b) => (b.record?.createdAt ?? 0) - (a.record?.createdAt ?? 0));
    links = Object.fromEntries(entries.map(({ index, url }) => [index, url]));
    table.innerHTML = ledgerRows(entries);
    const loaded = entries.flatMap(({ record }) => record ? [record] : []);
    values.innerHTML = metrics(loaded);
    values.setAttribute('aria-busy', 'false');
    const missing = entries.length - loaded.length;
    document.querySelector('#ledger-feedback').textContent = missing ? `${missing} ${missing === 1 ? 'request unavailable' : 'requests unavailable'}` : `${loaded.length} ${loaded.length === 1 ? 'request' : 'requests'}`;
    restore();
  }
  refresh.addEventListener('click', load);
  void load();
}

function guide(isFaq) {
  setTitle(isFaq ? 'FAQ' : 'How to use AgreeMargin');
  const questions = [
    ['Do I need a crypto wallet?', 'For a regular request, open the review link, choose an option, and enter your name. A wallet is required only when you choose added work on a request with test checkout enabled.'],
    ['Does approval send money?', 'Approval records your decision and unlocks checkout. The transfer happens when you confirm it in your wallet. The receipt shows when AgreeMargin verifies it.'],
    ['Can I use real money here?', 'Checkout uses Sui Testnet and test tokens. Test USDC and test SUI have no cash value.'],
    ['Why did verification fail?', 'Check that the wallet was on Sui Testnet and the ID came from this checkout. A new transfer can take time to appear. Keep the ID and retry verification before attempting another payment.'],
    ['What if the price changed while I was reviewing?', 'AgreeMargin prompts you to review the latest revision before accepting. Once you record a decision, the accepted terms are locked.'],
    ['Which link should I share?', 'Send the review link to the client. Save the manage link privately so you can open the request on another device.'],
    ['Can my client keep the original scope?', 'Yes. They can keep the original scope, approve the addition, or choose a swap if you offered one.'],
    ['How long can clients reply?', 'Clients have 30 days from creation to reply. If a request expires, create a new one and share its review link.'],
    ['Where are my requests on another device?', 'Download a backup in My requests, then restore it on the other device. You can also open a saved manage link. Keep the file and links private.'],
    ['What does estimated margin mean?', 'It’s the approved extra fee less the private delivery cost you entered. It estimates margin on approved work. The payment state shows whether a test transfer was verified.'],
    ['How do I save a decision receipt?', 'Open the decided request and select Print receipt. Choose Save as PDF in your browser if you want a file.'],
    ['What happens if I withdraw or delete a request?', 'Withdrawing stops new decisions on an open request. Deleting removes the hosted record and disables both links. Save any receipt you need first.'],
    ['What if Slush closes before I finish?', 'Reopen the review link. If you already paid, get the transaction ID from Slush Activity and verify it before trying to pay again.']
  ];
  const content = isFaq ? `<div class="faq-list">${questions.map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}</div>` : `
    <nav class="guide-nav" aria-label="On this page"><a href="#send">Send a request</a><a href="#manage">Manage requests</a><a href="#review">Review a change</a><a href="#receipts">Receipts and ledger</a><a href="#test-payment">Make a test payment</a></nav>
    <section id="send"><h2>Send a request</h2><ol><li>Describe the original agreement and what changed.</li><li>Enter the extra fee and time. Compare the client preview.</li><li>Create the review link and send it to your client. Keep the manage link private.</li></ol><a class="button primary" href="/new">Create a request</a></section>
    <section id="manage"><h2>Manage requests</h2><h3>Revise an open request</h3><p>Open its manage link and select <strong>Revise terms</strong>. Save the new scope, fee, or timing. The same review link shows the new revision. If your client already has the old version open, they’ll be asked to review the update.</p>
    <h3>Open a request on another device</h3><p>Choose <strong>Copy manage link</strong> in the studio view and save it privately. Open it directly on the other device or paste it into <strong>Open a saved manage link</strong> in My requests. Anyone with the manage link can manage that request.</p>
    <h3>Move your request list</h3><p>In <strong>My requests</strong>, open <strong>Back up or restore your request list</strong> and download a backup. Open the same AgreeMargin site in the new browser and restore the file there. This adds saved links to the existing list. The file contains private manage links and cannot recover deleted requests.</p>
    <h3>Close or remove a request</h3><p>Use <strong>More actions</strong> to withdraw an open request or delete a record. A withdrawn request stops accepting responses. A deleted request can no longer be opened by either link.</p></section>
    <section id="review"><h2>Review a change</h2><ol><li>Open the link from your studio. Check the revision, fee, and timeline.</li><li>Choose added work, a scope swap if offered, or the original scope.</li><li>Enter your name and confirm. You can print the decision receipt.</li></ol><p>Your decision locks that revision. If the terms need to change after approval, ask the studio for a new request.</p></section>
    <section id="receipts"><h2>Receipts and ledger</h2><p>After the client decides, both sides can open their original links to see the choice, revision, and decision time. Use <strong>Print receipt</strong> to print or save a PDF through your browser.</p><p><strong>My requests</strong> shows the requests saved in this browser. Pending fees are grouped by currency. Estimated margin uses the approved fee and the private delivery cost when one was entered.</p></section>
    <section id="test-payment"><h2>Make a test payment</h2><p>Use this when the studio offers Sui Testnet checkout. You’ll need a wallet and test funds.</p><ol>
    <li>Open <a href="https://slush.app/" target="_blank" rel="noreferrer">Slush</a>, create or open a wallet, and select Sui Testnet. Copy your public wallet address. It starts with <code>0x</code>. Keep your recovery phrase private.</li>
    <li>Use the <a href="https://faucet.sui.io/" target="_blank" rel="noreferrer">Sui faucet</a> for test SUI and the <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Circle faucet</a> for test USDC. Select Sui Testnet and use the same public address for both.</li>
    <li>Return to the review link, paste your wallet address, and approve the revision. Open test checkout and confirm the amount and destination in Slush.</li>
    <li>Copy the transaction ID from wallet activity. Paste it on the receipt and choose <strong>Verify transfer</strong>.</li></ol>
    <h3>If verification is pending</h3><p>Keep the transaction ID and retry after it appears in a Testnet checkpoint. AgreeMargin checks the approved amount, asset, sending wallet, recipient, and Payment Kit receipt. A transfer made with the wallet’s regular Send button cannot verify this checkout.</p></section>`;
  render(`<div class="shell receipt-shell"><article class="card receipt-card guide enter">${heading(isFaq ? 'Frequently asked questions' : 'How to use AgreeMargin', isFaq ? 'Help with requests, receipts, and test payments.' : 'Create, share, and track changes to client work.')}${content}<a class="text-action" href="${isFaq ? '/docs' : '/faq'}">${isFaq ? 'Read the walkthrough' : 'Read the FAQ'}</a></article></div>`);
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

function privacy() {
  setTitle('Privacy & access');
  render(`<div class="shell receipt-shell"><div class="card receipt-card privacy">${heading('Privacy &amp; access')}
    <section><h2>What we store</h2><p>Request details, the name entered with a decision, and the decision time. Your delivery cost is visible through the manage link. This browser keeps your manage links.</p></section>
    <section><h2>Who can open a request</h2><p>The review link lets a client view the request and choose an option. Your manage link can also withdraw or delete the request. Save a private copy.</p></section>
    <section><h2>When replies close</h2><p>Review links accept replies for 30 days and show the record until the sender deletes it.</p></section>
    <section><h2>What the receipt shows</h2><p>The receipt records the name as entered, the choice, and its timestamp.</p></section></div></div>`);
}

if (route === '/review') document.querySelector('.header nav').hidden = true;
if (route === '/workspace') document.querySelector('#workspace-nav').setAttribute('aria-current', 'page');
document.querySelector(`.footer-links a[href="${CSS.escape(route)}"]`)?.setAttribute('aria-current', 'page');
if (['/', '/new', '/workspace'].includes(route)) document.querySelector('#new-nav').hidden = true;
const pages = { '/': home, '/new': () => location.hash ? openRequest('edit') : newRequest(), '/workspace': workspace, '/review': () => openRequest('review'), '/manage': () => openRequest('manage'), '/privacy': privacy, '/docs': () => guide(false), '/faq': () => guide(true) };
pages[route]?.();
