// Public Sui Testnet configuration. Test assets have no monetary value.
const testnet = Object.freeze({
  package: '0x7e069abe383e80d32f2aec17b3793da82aabc8c2edf84abbf68dd7b719e71497',
  registry: '0x4960b8dc38cc80df9a548bd72ce09d157e4f5e32c570973cb54c9a634bcaa0d8',
  asset: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC'
});

function address(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value) || /^0x0+$/i.test(value)) {
    throw new HttpError(422, 'Enter a full Sui wallet address starting with 0x.');
  }
  return value.toLowerCase();
}

async function checkout(record, details, payer, acceptedAt) {
  const terms = {
    format: 'AgreeMargin/1', network: 'sui:testnet', request: record.id,
    revision: details.revision ?? 1, studio: details.studio, project: details.project,
    title: details.title, originalScope: details.baseline ?? '', addedScope: details.details,
    extraDays: details.addDays, asset: testnet.asset, amount: String(details.addCents * 10000),
    receiver: details.receiver, payer, acceptedAt, salt: random(32)
  };
  const canonical = JSON.stringify(terms);
  const commitment = await hash(canonical);
  const nonce = commitment.slice(0, 36);
  return { canonical, commitment, nonce, registry: testnet.registry, payer, state: 'awaiting' };
}

function checkoutUrl(details) {
  const args = new URLSearchParams({
    receiver: details.receiver, amount: String(details.addCents * 10000), coinType: testnet.asset,
    nonce: details.payment.nonce, registry: testnet.registry, label: 'AgreeMargin · Sui Testnet'
  });
  return 'https://my.slush.app/pay?' + args;
}

async function verifyPayment(digest, record, details) {
  if (typeof digest !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(digest)) {
    throw new HttpError(422, 'Paste the full transaction digest from your wallet.');
  }
  const query = `query Receipt($digest: String!) {
    transaction(digest: $digest) { digest sender { address } effects {
      status timestamp checkpoint { sequenceNumber }
      events(first: 50) { nodes { contents { type { repr } json } } }
    } }
  }`;
  let result;
  try {
    const res = await fetch('https://graphql.testnet.sui.io/graphql', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { digest } }), signal: AbortSignal.timeout(9000)
    });
    if (!res.ok) throw new Error();
    result = await res.json();
    if (result.errors?.length || !result.data) throw new Error();
  } catch {
    throw new HttpError(503, 'Sui Testnet is unavailable. Keep your digest and verify again.');
  }
  const tx = result.data.transaction;
  if (!tx?.effects?.checkpoint) throw new HttpError(422, 'Transaction has not been found in a testnet checkpoint yet. Check the network and retry.');
  const effects = tx.effects;
  const time = Date.parse(effects.timestamp);
  const eventType = testnet.package + '::payment_kit::PaymentReceipt';
  const matched = effects.events?.nodes?.some(({ contents }) => {
    const event = contents?.json;
    if (contents?.type?.repr !== eventType || !event) return false;
    return event.nonce === details.payment.nonce &&
      event.receiver === details.receiver && event.payment_amount === String(details.addCents * 10000) &&
      String(event.coin_type).replace(/^0x/, '') === testnet.asset.slice(2) &&
      event.payment_type?.['@variant'] === 'Registry' && event.payment_type.pos0 === testnet.registry;
  });
  if (tx.digest !== digest || effects.status !== 'SUCCESS' || tx.sender?.address !== details.payment.payer ||
      !Number.isFinite(time) || time < record.decided_at - 60000 || !matched) {
    throw new HttpError(422, 'This transaction does not match the approved revision, wallets, asset, and fee.');
  }
  return { ...details.payment, state: 'verified', digest, chainTime: time, checkpoint: String(effects.checkpoint.sequenceNumber) };
}
