import assert from 'node:assert/strict';
import { openDatabase } from './database.mjs';
import worker from '../dist/server/index.js';

const DB = openDatabase();
const origin = 'https://agreemargin.test';
const send = (path, method = 'GET', data, key, extras = {}) => {
  const headers = { Origin: origin, ...extras };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (data) headers['Content-Type'] = 'application/json';
  return worker.fetch(new Request(origin + path, { method, headers, body: data && JSON.stringify(data) }), { DB });
};

const details = { studio: 'Studio', project: 'Website', title: 'Add a pricing page', details: '<img src=bad> New pricing page', currency: 'USD', addCents: 60000, addDays: 2, swap: 'Swap out the FAQ page' };
const make = async (data = details) => {
  const response = await send('/api/requests', 'POST', data);
  assert.equal(response.status, 201);
  const { id, ownerRef, clientRef } = await response.json();
  return { id, ownerKey: ownerRef.split('.')[1], clientKey: clientRef.split('.')[1], base: `/api/requests/${id}` };
};

assert.equal((await send('/')).status, 200);
assert.equal((await send('/app.js')).status, 200);
assert.equal((await send('/api/requests', 'POST', { ...details, addCents: -1 })).status, 422);
assert.equal((await send('/api/requests', 'POST', { ...details, deliveryCents: -1 })).status, 422);
assert.equal((await send('/api/requests', 'POST', details, '', { Origin: 'https://other.invalid' })).status, 403);
const { base, ownerKey, clientKey } = await make({ ...details, deliveryCents: 17500 });
assert.equal((await send(`${base}/manage`, 'GET', undefined, clientKey)).status, 404);
assert.equal((await send(`${base}/review`, 'GET', undefined, ownerKey)).status, 404);
const open = await (await send(`${base}/review`, 'GET', undefined, clientKey)).json();
assert.equal(open.status, 'open');
assert.equal(open.addCents, 60000);
assert.equal(open.owner_hash, undefined);
assert.equal(open.deliveryCents, undefined);

const simultaneous = await Promise.all([
  send(`${base}/review`, 'POST', { name: 'Client', choice: 'swap' }, clientKey),
  send(`${base}/review`, 'POST', { name: 'Client', choice: 'add' }, clientKey)
]);
assert.deepEqual(simultaneous.map((result) => result.status).sort(), [200, 409]);
assert.equal((await simultaneous.find((result) => result.status === 200).json()).deliveryCents, undefined);
const decision = await (await send(`${base}/manage`, 'GET', undefined, ownerKey)).json();
assert.equal(decision.status, 'decided');
assert.equal(decision.respondent, 'Client');
assert.equal(decision.deliveryCents, 17500);
assert.ok(decision.decidedAt > 0);
assert.equal((await send(`${base}/manage`, 'POST', undefined, ownerKey)).status, 409);
assert.equal((await send(`${base}/manage`, 'DELETE', undefined, ownerKey)).status, 204);
assert.equal((await send(`${base}/review`, 'GET', undefined, clientKey)).status, 404);

const withoutSwap = await make({ ...details, swap: '' });
assert.equal((await (await send(`${withoutSwap.base}/manage`, 'GET', undefined, withoutSwap.ownerKey)).json()).deliveryCents, null);
assert.equal((await send(`${withoutSwap.base}/review`, 'POST', { name: 'Client', choice: 'swap' }, withoutSwap.clientKey)).status, 422);
assert.equal((await send(`${withoutSwap.base}/manage`, 'POST', undefined, withoutSwap.ownerKey)).status, 200);
assert.equal((await send(`${withoutSwap.base}/review`, 'POST', { name: 'Client', choice: 'keep' }, withoutSwap.clientKey)).status, 409);

const expired = await make();
await DB.prepare('UPDATE requests SET expires_at = ? WHERE id = ?').bind(0, expired.id).run();
assert.equal((await (await send(`${expired.base}/review`, 'GET', undefined, expired.clientKey)).json()).status, 'expired');
assert.equal((await send(`${expired.base}/review`, 'POST', { name: 'Client', choice: 'add' }, expired.clientKey)).status, 409);
const sameRequest = { ...details, ownerKey: 'a'.repeat(64) };
const [created, retried] = await Promise.all([make(sameRequest), make(sameRequest)]);
assert.deepEqual(created, retried);
assert.equal((await send(`${created.base}/manage`, 'DELETE', undefined, created.ownerKey)).status, 204);
const payer = '0x' + '1'.repeat(64);
const receiver = '0x' + '2'.repeat(64);
const paid = await make({ ...details, receiver });
assert.equal((await send(paid.base + '/manage', 'PATCH', { ...details, receiver, revision: 1, addCents: 25000 }, paid.ownerKey)).status, 200);
assert.equal((await send(paid.base + '/review', 'POST', { choice: 'add', name: 'Client', payer, revision: 1 }, paid.clientKey)).status, 409);
const accepted = await (await send(paid.base + '/review', 'POST', { choice: 'add', name: 'Client', payer, revision: 2 }, paid.clientKey)).json();
assert.equal(accepted.payment.state, 'awaiting');
assert.equal(new URL(accepted.payUrl).searchParams.get('amount'), '250000000');
assert.equal((await send(paid.base + '/review/payment', 'POST', { digest: 'invalid' }, paid.clientKey)).status, 422);
assert.equal((await send(paid.base + '/manage', 'PATCH', { ...details, receiver, revision: 2 }, paid.ownerKey)).status, 409);
DB.close();
console.log('Passed request, decision, access, expiry, and removal checks.');
