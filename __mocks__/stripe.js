// Jest manual mock for stripe library used in tests.
// Provides deterministic IDs and a controllable webhook constructEvent behavior.
module.exports = function mockStripe(secret){
  return {
    customers: {
      create: async ({ email }) => ({ id: 'cus_test_' + Math.random().toString(36).slice(2,10), email }),
      update: async () => ({})
    },
    setupIntents: {
      create: async ({ customer }) => ({ id: 'seti_test', customer, client_secret: 'seti_secret_' + customer })
    },
    paymentMethods: {
      attach: async () => ({})
    },
    subscriptions: {
      create: async (cfg) => ({ id: 'sub_test', ...cfg })
    },
    webhooks: {
      constructEvent: (body, sig, webhookSecret) => {
        switch(sig){
          case 'good':
            return {
              id: 'evt_test_invoice_paid',
              type: 'invoice.paid',
              data: { object: { id: 'in_test_123', number: 'INV-123', amount_paid: 5000, currency: 'usd', customer_email: 'webhook@example.com' } }
            };
          case 'invoice_failed':
            return {
              id: 'evt_test_invoice_failed',
              type: 'invoice.payment_failed',
              data: { object: { id: 'in_failed_999', number: 'INV-999', amount_due: 5000, currency: 'usd', customer_email: 'failed@example.com' } }
            };
          case 'sub_created':
            return {
              id: 'evt_test_sub_created',
              type: 'customer.subscription.created',
              data: { object: { id: 'sub_test_abc', status: 'active', items: [] } }
            };
          case 'sub_updated':
            return {
              id: 'evt_test_sub_updated',
              type: 'customer.subscription.updated',
              data: { object: { id: 'sub_test_abc', status: 'active', cancel_at_period_end: false } }
            };
          default:
            throw new Error('Invalid signature');
        }
      }
    }
  };
};
