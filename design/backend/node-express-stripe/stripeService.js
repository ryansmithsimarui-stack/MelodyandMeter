// Minimal Stripe helper (example)
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = {
  createCustomer: async (email)=>{
    return await stripe.customers.create({ email });
  },
  createSetupIntent: async (customerId)=>{
    return await stripe.setupIntents.create({ customer: customerId });
  },
  attachPaymentMethod: async (paymentMethodId, customerId)=>{
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    return await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
  },
  createSubscription: async (customerId, priceId)=>{
    return await stripe.subscriptions.create({ customer: customerId, items: [{ price: priceId }], expand:['latest_invoice.payment_intent'] });
  }
};
