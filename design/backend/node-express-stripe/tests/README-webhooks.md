# Webhook Signature Testing

This backend validates Stripe webhook events using an HMAC SHA-256 signature header of the form:

```
stripe-signature: t=UNIX_TIMESTAMP,v1=HEX_DIGEST
```

Where:
- `UNIX_TIMESTAMP` is `Math.floor(Date.now()/1000)` at signing time.
- `HEX_DIGEST` is `sha256(timestamp + '.' + rawPayload)` using the shared secret `STRIPE_WEBHOOK_SECRET`.

## Helper
`tests/helpers/stripeTestSignature.js` exports `generateStripeSignature(payload, timestamp?)` which returns the correct header value for a given JSON string payload.

Example usage in a test:
```js
const { generateStripeSignature } = require('./helpers/stripeTestSignature');
const event = { id:'evt_1', type:'invoice.paid', data:{ object:{ id:'in_1', amount_paid:2500, currency:'usd', customer_email:'x@example.com' } } };
const payload = JSON.stringify(event);
const sig = generateStripeSignature(payload);
await request(app).post('/api/webhooks/stripe').set('stripe-signature', sig).send(payload);
```

## Global Setup
Jest loads `tests/setup/env.js` before all tests (configured in `package.json` via `setupFiles`). This file ensures `process.env.STRIPE_WEBHOOK_SECRET` is set to a deterministic test value (`whsec_test_secret`) unless you override it earlier in a specific test file **before** requiring `server.js`.

## Invalid Signature Cases
To test failure, generate a valid signature then alter one character of the digest:
```js
const badSig = sig.replace(/.$/, sig.slice(-1)==='a' ? 'b' : 'a');
```
This preserves header structure while invalidating the HMAC so the server returns `400`.

## Replay Protection
Replay detection uses the event `id`. Multiple deliveries of the same signed payload are flagged with `{ replay_ignored: true }` unless the replay window has expired. Provide stable `event.id` values in tests where replay behavior is asserted.

## Removal of Synthetic Tokens
Legacy tokens (`good`, `sub_created`, etc.) have been removed. All tests now use real signatures ensuring closer parity with production behavior.

## Tips
- Always send the raw JSON string as the request body **without prior JSON parsing in the test** so the HMAC matches server computation.
- Avoid mutating `payload` after computing the signature; any change invalidates the digest.
- Use explicit `customer_email` in invoice events for email assertion tests.
