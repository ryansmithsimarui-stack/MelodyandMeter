// Jest setup file: establishes default webhook secret for all tests.
// Individual tests can override before requiring the server if needed.
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
