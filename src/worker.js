const currencies = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'SGD', 'INR', 'MMK']);
const paths = new Set(['/', '/new', '/workspace', '/review', '/manage', '/privacy', '/docs', '/faq']);
const reviewPeriod = 30 * 24 * 60 * 60 * 1000;
const windowLength = 60 * 60 * 1000;
const assetTypes = { 'app.css': 'text/css', 'app.js': 'text/javascript', 'mark.svg': 'image/svg+xml' };

const headers = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function respond(body, type, status = 200, extra = {}) {
  return new Response(body, { status, headers: { ...headers, 'Content-Type': `${type}; charset=utf-8`, ...extra } });
}

function json(body, status = 200) {
  return respond(JSON.stringify(body), 'application/json', status);
}

async function readJson(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Send this request as JSON.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Add the required details.');
  let buffer = '';
  let size = 0;
  const decoder = new TextDecoder();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 10000) {
      await reader.cancel();
      throw new HttpError(413, 'This request is too long.');
    }
    buffer += decoder.decode(chunk.value, { stream: true });
  }
  try {
    const result = JSON.parse(buffer + decoder.decode());
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch {
    throw new HttpError(400, 'Check the details and try again.');
  }
}

function field(value, label, max, optional = false) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value === 'string') {
    const clean = value.trim();
    if ((clean || optional) && clean.length <= max) return clean;
  }
  throw new HttpError(422, `${label} must be ${optional ? 'at most' : 'between 1 and'} ${max} characters.`);
}

function validate(data) {
  if (!currencies.has(data.currency)) throw new HttpError(422, 'Choose a supported currency.');
  if (!Number.isSafeInteger(data.addCents) || data.addCents < 0 || data.addCents > 99999999) {
    throw new HttpError(422, 'Enter a fee from 0 to 999,999.99.');
  }
  if (!Number.isSafeInteger(data.addDays) || data.addDays < 0 || data.addDays > 365) {
    throw new HttpError(422, 'Enter 0 to 365 extra days.');
  }
  const deliveryCents = data.deliveryCents ?? null;
  if (deliveryCents !== null && (!Number.isSafeInteger(deliveryCents) || deliveryCents < 0 || deliveryCents > 99999999)) {
    throw new HttpError(422, 'Enter a delivery cost from 0 to 999,999.99.');
  }
  return {
    baseline: field(data.baseline, 'Original scope', 900, true),
    ...(data.receiver ? { receiver: address(data.receiver) } : {}),
    studio: field(data.studio, 'Your name', 80),
    project: field(data.project, 'Project name', 100),
    title: field(data.title, 'Change title', 120),
    details: field(data.details, 'Change details', 1200),
    currency: data.currency,
    addCents: data.addCents,
    addDays: data.addDays,
    deliveryCents,
    swap: field(data.swap, 'Swap details', 600, true)
  };
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hash(value) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

function random(bytes) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function expose(row, role) {
  const { deliveryCents = null, ...details } = JSON.parse(row.details);
  return {
    id: row.id,
    ...details,
    revision: details.revision ?? 1,
    ...(details.payment?.state === 'awaiting' && role === 'review' ? { payUrl: checkoutUrl(details) } : {}),
    ...(role === 'manage' ? { deliveryCents } : {}),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status === 'open' && row.expires_at <= Date.now() ? 'expired' : row.status,
    choice: row.choice,
    respondent: row.respondent,
    decidedAt: row.decided_at
  };
}

async function rateLimit(request, db, now) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return;
  const windowEnd = (Math.floor(now / windowLength) + 1) * windowLength;
  const visitor = await hash(`create:${windowEnd}:${ip}`);
  const { count } = await db.prepare(`INSERT INTO creation_limits (visitor, window_end, count) VALUES (?, ?, 1)
    ON CONFLICT(visitor) DO UPDATE SET count = count + 1 RETURNING count`).bind(visitor, windowEnd).first();
  if (count === 1 && Math.random() < 0.05) {
    await db.prepare('DELETE FROM creation_limits WHERE window_end < ?').bind(now).run();
  }
  if (count > 25) throw new HttpError(429, 'Too many new requests. Try again in an hour.');
}

async function create(request, db) {
  const input = await readJson(request);
  const details = validate(input);
  checkCheckoutTerms(details);
  if (input.ownerKey !== undefined && !(typeof input.ownerKey === 'string' && /^[a-f0-9]{64}$/.test(input.ownerKey))) {
    throw new HttpError(422, 'Reload the form and try again.');
  }
  const now = Date.now();
  const ownerKey = input.ownerKey ?? random(32);
  const id = input.ownerKey ? (await hash(`AgreeMargin request id v1:${ownerKey}`)).slice(0, 24) : random(12);
  const clientKey = await hash(`AgreeMargin client link v1:${ownerKey}`);
  const [ownerHash, clientHash] = await Promise.all([hash(ownerKey), hash(clientKey)]);
  let record = input.ownerKey ? await db.prepare('SELECT details FROM requests WHERE id = ? AND owner_hash = ?').bind(id, ownerHash).first() : null;
  if (!record) {
    await rateLimit(request, db, now);
    record = await db.prepare(`INSERT INTO requests (id, owner_hash, client_hash, details, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING details`).bind(id, ownerHash, clientHash, JSON.stringify(details), now, now + reviewPeriod).first();
    record ??= await db.prepare('SELECT details FROM requests WHERE id = ? AND owner_hash = ?').bind(id, ownerHash).first();
  }
  if (!record) throw new HttpError(409, 'Could not reserve this request. Reload the form and try again.');
  const { title, project } = JSON.parse(record.details);
  return json({ id, title, project, ownerRef: `${id}.${ownerKey}`, clientRef: `${id}.${clientKey}` }, 201);
}

async function authorized(request, db, id, role) {
  const key = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!key) throw new HttpError(404, 'This link is incomplete or no longer works.');
  const column = role === 'manage' ? 'owner_hash' : 'client_hash';
  const record = await db.prepare(`SELECT * FROM requests WHERE id = ? AND ${column} = ?`).bind(id, await hash(key)).first();
  if (!record) throw new HttpError(404, 'This link is incomplete or no longer works.');
  return record;
}

function checkCheckoutTerms(details) {
  if (details.receiver && (details.currency !== 'USD' || !details.addCents)) {
    throw new HttpError(422, 'For testnet checkout, quote a positive fee in USD.');
  }
}

function checkRevision(input, details) {
  if ((input.revision ?? 1) !== (details.revision ?? 1)) {
    throw new HttpError(409, 'The studio revised this request. Review the latest terms.');
  }
}

async function revise(request, db, record) {
  const input = await readJson(request);
  const previous = JSON.parse(record.details);
  checkRevision(input, previous);
  const next = validate(input);
  checkCheckoutTerms(next);
  next.revision = (previous.revision ?? 1) + 1;
  const row = await db.prepare(`UPDATE requests SET details = ? WHERE id = ? AND details = ?
    AND status = 'open' AND expires_at > ? RETURNING *`)
    .bind(JSON.stringify(next), record.id, record.details, Date.now()).first();
  if (!row) throw new HttpError(409, 'This request changed or closed. Reopen it before editing.');
  return json(expose(row, 'manage'));
}

async function reconcile(request, db, record, role) {
  const details = JSON.parse(record.details);
  if (!details.payment || record.status !== 'decided') throw new HttpError(409, 'Choose and approve the paid revision first.');
  const { digest } = await readJson(request);
  if (details.payment.state === 'verified') {
    if (digest !== details.payment.digest) throw new HttpError(409, 'This revision already has a verified transaction.');
    return json(expose(record, role));
  }
  details.payment = await verifyPayment(digest, record, details);
  const row = await db.prepare('UPDATE requests SET details = ? WHERE id = ? AND details = ? RETURNING *')
    .bind(JSON.stringify(details), record.id, record.details).first();
  if (row) return json(expose(row, role));
  const current = await db.prepare('SELECT * FROM requests WHERE id = ?').bind(record.id).first();
  if (current && JSON.parse(current.details).payment?.digest === digest) return json(expose(current, role));
  throw new HttpError(409, 'The request changed. Refresh to see its status.');
}

async function decide(request, db, record) {
  const body = await readJson(request);
  const { choice } = body;
  const details = JSON.parse(record.details);
  checkRevision(body, details);
  if (!(choice === 'keep' || choice === 'add' || (choice === 'swap' && details.swap))) {
    throw new HttpError(422, 'Choose an available option.');
  }
  const name = field(body.name, 'Your name', 80);
  const now = Date.now();
  if (choice === 'add' && details.receiver) details.payment = await checkout(record, details, address(body.payer), now);
  const updated = await db.prepare(`UPDATE requests SET status = 'decided', choice = ?, respondent = ?, decided_at = ?, details = ?
    WHERE id = ? AND client_hash = ? AND details = ? AND status = 'open' AND expires_at > ? RETURNING *`)
    .bind(choice, name, now, JSON.stringify(details), record.id, record.client_hash, record.details, now).first();
  if (!updated) throw new HttpError(409, 'This request has closed. Refresh to see its status.');
  return json(expose(updated, 'review'));
}

async function handleApi(request, url, db) {
  if (!db) throw new HttpError(503, 'Requests are temporarily unavailable. Try again shortly.');
  if (request.method !== 'GET' && request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) {
    throw new HttpError(403, 'Open AgreeMargin to make this change.');
  }
  if (url.pathname === '/api/requests' && request.method === 'POST') return create(request, db);
  const match = /^\/api\/requests\/([a-f0-9]{24})\/(manage|review)(\/payment)?$/.exec(url.pathname);
  if (!match) throw new HttpError(404, 'This page does not exist.');
  const [, id, role] = match;
  const record = await authorized(request, db, id, role);
  if (match[3]) {
    if (request.method !== 'POST') throw new HttpError(405, 'Use the receipt to verify a transaction.');
    return reconcile(request, db, record, role);
  }
  if (request.method === 'PATCH' && role === 'manage') return revise(request, db, record);
  if (request.method === 'GET') return json(expose(record, role));
  if (request.method === 'POST' && role === 'review') return decide(request, db, record);
  if (request.method === 'POST' && role === 'manage') {
    const row = await db.prepare(`UPDATE requests SET status = 'withdrawn' WHERE id = ? AND owner_hash = ?
      AND status = 'open' AND expires_at > ? RETURNING *`).bind(id, record.owner_hash, Date.now()).first();
    if (!row) throw new HttpError(409, 'This request has already closed.');
    return json(expose(row, role));
  }
  if (request.method === 'DELETE' && role === 'manage') {
    await db.prepare('DELETE FROM requests WHERE id = ? AND owner_hash = ?').bind(id, record.owner_hash).run();
    return new Response(null, { status: 204, headers });
  }
  throw new HttpError(405, 'This action is unavailable.');
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return await handleApi(request, url, env.DB);
      if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'This action is unavailable.');
      if (url.pathname === '/FAQ') return Response.redirect(new URL('/faq', url), 308);
      const name = url.pathname.slice(1);
      if (name === 'dm-sans-latin.woff2') {
        const body = request.method === 'HEAD' ? null : Uint8Array.from(atob(assets[name]), (char) => char.charCodeAt(0));
        return new Response(body, { headers: { ...headers, 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=86400' } });
      }
      if (Object.hasOwn(assetTypes, name)) {
        return respond(request.method === 'HEAD' ? null : assets[name], assetTypes[name], 200, { 'Cache-Control': 'public, max-age=3600' });
      }
      if (paths.has(url.pathname)) {
        const noIndex = ['/review', '/manage', '/workspace'].includes(url.pathname);
        return respond(request.method === 'HEAD' ? null : assets['app.html'], 'text/html', 200, noIndex ? { 'X-Robots-Tag': 'noindex, nofollow' } : {});
      }
      throw new HttpError(404, 'This page does not exist.');
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error('AgreeMargin request failed', error?.message);
      return json({ error: 'We could not finish that action. Try again shortly.' }, 500);
    }
  }
};
