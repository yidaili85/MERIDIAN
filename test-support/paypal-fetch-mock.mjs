const nativeFetch = globalThis.fetch;
let checkout = null;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {'Content-Type': 'application/json'},
});

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname !== 'api-m.sandbox.paypal.com') return nativeFetch(input, options);

  if (url.pathname === '/v1/oauth2/token') {
    const expected = 'Basic ' + Buffer.from('db-client:db-secret').toString('base64');
    return options.headers?.Authorization === expected
      ? json({access_token: 'mock-token'})
      : json({error: 'invalid_client'}, 401);
  }

  if (url.pathname === '/v2/checkout/orders' && options.method === 'POST') {
    checkout = JSON.parse(options.body);
    return json({
      id: 'PP-TEST',
      status: 'CREATED',
      links: [{rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PP-TEST'}],
    });
  }

  if (url.pathname === '/v1/notifications/verify-webhook-signature') {
    const delay = Number(process.env.PAYPAL_MOCK_VERIFY_DELAY_MS || 0);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return json({verification_status: 'SUCCESS'});
  }

  if (url.pathname === '/v2/checkout/orders/PP-TEST') {
    const delay = Number(process.env.PAYPAL_MOCK_CAPTURE_DELAY_MS || 0);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return json({
      id: 'PP-TEST',
      status: 'COMPLETED',
      purchase_units: checkout.purchase_units.map((unit) => ({
        ...unit,
        payments: {captures: [{id: 'CAP-TEST', status: 'COMPLETED', amount: unit.amount}]},
      })),
    });
  }

  return json({error: 'unexpected mock request', path: url.pathname}, 404);
};
