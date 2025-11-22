const crypto = require('crypto');

const DEFAULT_SECRET = 'whsec_test_secret';

function getSecret(){
  if(!process.env.STRIPE_WEBHOOK_SECRET){
    process.env.STRIPE_WEBHOOK_SECRET = DEFAULT_SECRET;
  }
  return process.env.STRIPE_WEBHOOK_SECRET;
}

function generateStripeSignature(payload, timestamp=Math.floor(Date.now()/1000), secretOverride){
  const secret = secretOverride || getSecret();
  const signedPayload = `${timestamp}.${payload}`;
  const hmac = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${hmac}`;
}

module.exports = { generateStripeSignature };
