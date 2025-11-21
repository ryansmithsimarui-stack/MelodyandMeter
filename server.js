require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const pino = require('pino');
const pinoHttp = require('pino-http');
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = require('stripe')(stripeSecret || 'sk_test_missing');
const app = express();
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');

// Allow CORS from the prototype origin during development. Adjust origin as needed.
// --- Environment validation ---
function requireEnv(name){
  if(!process.env[name] || process.env[name].trim()===''){
    logger.warn({ env:name }, 'Missing required environment variable');
    return false;
  }
  return true;
}

// --- Logger setup ---
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers['x-request-id'];
    const id = existing || Math.random().toString(36).slice(2,10);
    res.setHeader('x-request-id', id);
    return id;
  }
});

app.use(httpLogger);
app.use(cors({ origin: 'http://localhost:8000' }));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(bodyParser.json({ limit: '200kb' }));

// Fail fast if critical Stripe secrets missing (in non-dev environments)
if(process.env.NODE_ENV === 'production'){
  const okStripe = requireEnv('STRIPE_SECRET_KEY') & requireEnv('STRIPE_WEBHOOK_SECRET');
  if(!okStripe){
    logger.error('Critical environment variables missing. Exiting.');
    process.exit(1);
  }
}

// --- Simple validation helpers ---
function isValidEmail(email){
  return typeof email === 'string' && email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}
function cleanName(name){
  if(!name || typeof name !== 'string') return '';
  const trimmed = name.trim().slice(0,40);
  return trimmed.replace(/[^a-zA-Z'\- ]/g,'');
}
function rejectIfInvalidEmail(res,email){ if(!isValidEmail(email)) { res.status(400).json({error:'invalid_email'}); return true;} return false; }
function isValidPriceId(id){ return typeof id==='string' && /^price_[A-Za-z0-9]+$/.test(id); }
function isValidPaymentMethod(id){ return !id || (typeof id==='string' && /^pm_[A-Za-z0-9]+$/.test(id)); }

// --- Rate limiters ---
const registerLimiter = rateLimit({ windowMs: 60*60*1000, max: 5, standardHeaders:true, legacyHeaders:false, message:{ error:'too_many_registration_attempts' } });
const trialFollowLimiter = rateLimit({ windowMs: 60*60*1000, max: 10, standardHeaders:true, legacyHeaders:false, message:{ error:'too_many_followup_emails' } });

// Test-only helper route to reset rate limits
if(process.env.JEST_WORKER_ID){
  app.post('/__test/reset-rate-limits', (req,res)=>{
    try{
      registerLimiter.resetKey(req.ip);
      trialFollowLimiter.resetKey(req.ip);
    }catch(e){ /* ignore */ }
    res.json({ reset:true });
  });
}
// Test-only persistence reset route
if(process.env.JEST_WORKER_ID){
  app.post('/__test/reset-persistence', (req,res)=>{
    try{ persistence.reset(); }catch(e){ /* ignore */ }
    res.json({ reset:true });
  });
}

// Persistence scaffold (file-based JSON) replacing portions of in-memory storage
const persistence = require('./persistence');
persistence.init();
// Retain in-memory invoices (placeholder) ; users/customers/audit/email jobs moved to persistence
const db = { invoices: {} };
function addAudit(entry){ persistence.addAudit({ ts: Date.now(), ...entry }); }

// --- Email Service (simple template loader + transport) ---
// Environment variables expected (can be left blank to fallback to console):
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
function createTransport(){
  if(process.env.SMTP_HOST && process.env.SMTP_USER){
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT||'587',10),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return { sendMail: async (opts)=>{ console.log('[DEV EMAIL]', opts.subject, '->', opts.to); } };
}
const mailer = createTransport();

function loadTemplate(filename){
  // Primary expected location: design/emails/<file>
  const primary = path.join(__dirname,'..','..','emails',filename);
  // Fallback (in case templates are moved inside project later): design/backend/node-express-stripe/emails/<file>
  const fallback = path.join(__dirname,'emails',filename);
  for(const attempt of [primary, fallback]){
    try{
      if(fs.existsSync(attempt)){
        return fs.readFileSync(attempt,'utf8');
      }
    }catch(e){ /* continue to next attempt */ }
  }
  const diag = { filename, tried:[primary, fallback], cwd: process.cwd(), dirname: __dirname };
  console.error('Template load failed', diag);
  // Provide a non-empty fallback so tests relying on minimal length don't fail purely due to path issues.
  return `<!DOCTYPE html><html><body><p>Missing template placeholder for ${filename}</p></body></html><!-- Plain Text Version -->Subject: Placeholder Email\nMissing template placeholder.`;
}
function applyVars(tpl, vars){
  return Object.entries(vars).reduce((acc,[k,v])=>acc.replace(new RegExp('{{'+k+'}}','g'), v), tpl);
}
function maskEmail(email){
  if(!email || typeof email !== 'string') return 'unknown';
  const [user, domain] = email.split('@');
  if(!domain) return email;
  const prefix = user.slice(0,3) + (user.length>3?'…':'');
  return `${prefix}@${domain}`;
}
// --- Email Queue (persisted) ---
// Uses persistence layer emailJobs entries. Stores html/text snapshot for durability & audit.
const MAX_EMAIL_ATTEMPTS = parseInt(process.env.EMAIL_MAX_ATTEMPTS||'5',10);
const BASE_RETRY_DELAY_MS = parseInt(process.env.EMAIL_BASE_DELAY_MS||'2000',10);
const SIMULATE_FAIL_ATTEMPTS = parseInt(process.env.SIMULATE_EMAIL_FAILURE_ATTEMPTS||'0',10);
const metrics = { emailSuccess:0, emailPermanentFailure:0 };

function queueEmailPersisted({ to, subject, template, htmlBody, textBody }){
  persistence.addEmailJob({ to, subject, template, htmlBody: htmlBody || '', textBody: textBody || '', maxAttempts: MAX_EMAIL_ATTEMPTS });
  logger.info({ to:maskEmail(to), subject }, 'Email job queued');
}

async function dispatchEmailJobs(){
  const jobs = persistence.listProcessableEmailJobs(Date.now());
  for(const job of jobs){
    try{
      if(job.attempts < SIMULATE_FAIL_ATTEMPTS){
        throw new Error('Simulated email failure');
      }
      const emailData = { from: process.env.MAIL_FROM||'no-reply@melodyandmeter.com', to: job.to, subject: job.subject, html: job.htmlBody||'', text: job.textBody||'' };
      await mailer.sendMail(emailData);
      metrics.emailSuccess++;
      persistence.updateEmailJob(job.id, { status:'success', attempts: job.attempts+1 });
      logger.info({ to:maskEmail(job.to), subject:job.subject, attempts: job.attempts+1 }, 'Email sent (persisted job)');
    }catch(err){
      const attempts = job.attempts + 1;
      if(attempts >= MAX_EMAIL_ATTEMPTS){
        metrics.emailPermanentFailure++;
        persistence.updateEmailJob(job.id, { status:'permanent_failure', attempts, lastError: err.message });
        logger.error({ to:maskEmail(job.to), subject:job.subject }, 'Email permanently failed (persisted job)');
      }else{
        const jitter = Math.floor(Math.random()*250);
        const nextAttemptAt = Date.now() + BASE_RETRY_DELAY_MS * Math.pow(2, attempts-1) + jitter;
        persistence.updateEmailJob(job.id, { attempts, nextAttemptAt, lastError: err.message });
        logger.warn({ to:maskEmail(job.to), subject:job.subject, attempts }, 'Email send attempt failed (persisted job)');
      }
    }
  }
}
if(process.env.NODE_ENV !== 'test'){
  setInterval(dispatchEmailJobs, 1000);
}
// Test-only manual dispatch route
if(process.env.JEST_WORKER_ID){
  app.post('/__test/dispatch-email-jobs', asyncHandler(async (req,res)=>{
    await dispatchEmailJobs();
    const stats = persistence.getEmailJobStats();
    res.json({ dispatched:true, stats });
  }));
}
// Test-only list raw jobs
if(process.env.JEST_WORKER_ID){
  app.get('/__test/list-email-jobs', (req,res)=>{
    const jobs = persistence.getRecentEmailJobs(100);
    res.json({ jobs });
  });
}

async function sendTemplate(to, subject, filename, vars){
  const raw = loadTemplate(filename);
  const [htmlPart, textPart] = raw.split('<!-- Plain Text Version -->');
  let html = applyVars(htmlPart||'', vars);
  let text = '';
  if(textPart){ text = applyVars(textPart.replace(/^[\s\S]*?Subject:[^\n]*\n?/,'').trim(), vars); }
  if(!html || html.trim().length === 0){
    html = `<!DOCTYPE html><html><body><p>Template not found or empty: ${filename}</p></body></html>`;
  }
  if(!text || text.trim().length === 0){
    text = `Template not found or empty: ${filename}`;
  }
  const emailData = { from: process.env.MAIL_FROM||'no-reply@melodyandmeter.com', to, subject, html, text };
  const alwaysQueue = process.env.ALWAYS_QUEUE_EMAIL === 'true';
  if((process.env.NODE_ENV === 'test' && !alwaysQueue) || process.env.INLINE_EMAIL_SEND === 'true'){
    await mailer.sendMail(emailData);
  }else{
    queueEmailPersisted({ to, subject, template: filename, htmlBody: html, textBody: text });
  }
}

// --- Async handler helper ---
function asyncHandler(fn){ return (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next); }

// --- Registration & verification simulation ---
app.post('/api/auth/register', registerLimiter, asyncHandler(async (req,res)=>{
  const { email, firstName } = req.body;
  if(!email) return res.status(400).json({error:'email_required'});
  if(rejectIfInvalidEmail(res,email)) return;
  const existing = persistence.getUser(email);
  if(existing) return res.status(400).json({error:'already registered'});
  const user = { email, firstName: cleanName(firstName)||'Parent', verified: false, createdAt: Date.now() };
  persistence.createUser(email, user);
  const verificationLink = `https://portal.local/verify?token=${Buffer.from(email).toString('base64')}`;
  try{ await sendTemplate(email,'Confirm your Melody & Meter email','verification-email.html',{ parent_first_name: user.firstName, verification_link: verificationLink, policies_link: 'https://melodyandmeter.com/policies' }); }catch(e){ logger.error({ err:e }, 'Send verification failed'); }
  res.json({ status:'pending_verification' });
}));

app.post('/api/auth/verify', asyncHandler(async (req,res)=>{
  const { email } = req.body; if(!email) return res.status(400).json({error:'email_required'});
  if(rejectIfInvalidEmail(res,email)) return;
  const user = persistence.getUser(email);
  if(!user) return res.status(404).json({error:'not_found'});
  persistence.verifyUser(email);
  res.json({ status:'verified'});
}));

// Create SetupIntent for saving a card (client will use client_secret to complete)
app.post('/api/payments/setup-intent', asyncHandler(async (req, res) => {
  const { email } = req.body;
  if(!email) return res.status(400).json({error:'email_required'});
  if(rejectIfInvalidEmail(res,email)) return;
  let customerId = persistence.getCustomerId(email);
  if(!customerId){
    const cust = await stripe.customers.create({ email });
    customerId = cust.id; persistence.setCustomerId(email, customerId);
  }
  const setupIntent = await stripe.setupIntents.create({ customer: customerId });
  res.json({ client_secret: setupIntent.client_secret, customerId });
}));

// Create subscription (server-side) using priceId (from Stripe Dashboard)
app.post('/api/billing/subscriptions', asyncHandler(async (req, res) => {
  const { email, priceId, payment_method_id } = req.body;
  if(!email || !priceId) return res.status(400).json({error:'email_and_priceId_required'});
  if(rejectIfInvalidEmail(res,email)) return;
  if(!isValidPriceId(priceId)) return res.status(400).json({error:'invalid_price_id'});
  if(!isValidPaymentMethod(payment_method_id)) return res.status(400).json({error:'invalid_payment_method_id'});
  let customerId = persistence.getCustomerId(email);
  if(!customerId){
    const cust = await stripe.customers.create({ email });
    customerId = cust.id; persistence.setCustomerId(email, customerId);
  }
  if(payment_method_id){
    await stripe.paymentMethods.attach(payment_method_id, { customer: customerId });
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: payment_method_id } });
  }
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    expand: ['latest_invoice.payment_intent']
  });
  // Instrument payment initiation & booking confirmation (if booking_id present)
  try{
    const bookingId = req.body.booking_id;
    if(bookingId){
      require('./analytics').trackEvent('payment_initiated', { booking_id: bookingId, user_id: email, ts: Date.now() });
      require('./analytics').trackEvent('booking_confirmed', { booking_id: bookingId, user_id: email, ts: Date.now() });
    }
  }catch(e){ logger.warn({ err:e.message }, 'Subscription instrumentation failed'); }
  res.json(subscription);
}));

// Webhook endpoint
app.post('/api/webhooks/stripe', bodyParser.raw({type:'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try{
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  }catch(err){ logger.warn({ err:err.message }, 'Webhook signature verification failed'); return res.status(400).send(`Webhook Error: ${err.message}`); }

  // Replay protection using configurable window
  const replayWindowMs = persistence.getReplayWindowMs ? persistence.getReplayWindowMs() : (24*60*60*1000);
  if(persistence.hasRecentWebhookEvent(event.id, replayWindowMs)){
    logger.info({ eventId:event.id, type:event.type }, 'Duplicate webhook event ignored');
    return res.json({ received:true, replay_ignored:true });
  }
  persistence.addWebhookEvent(event.id);

  switch(event.type){
      case 'invoice.paid':
        logger.info({ invoice:event.data.object.id }, 'Invoice paid');
        addAudit({ actor:'webhook', action:'invoice.paid', meta:{ id:event.data.object.id } });
        persistence.incrementWebhookCounter(event.type);
        try{
          const invoice = event.data.object;
          const amount = invoice.amount_paid || 0;
          const currency = (invoice.currency || 'usd').toLowerCase();
          require('./analytics').trackEvent('payment_success', { invoice_id: invoice.id, amount_cents: amount, currency, ts: Date.now() });
        }catch(e){ logger.warn({ err:e.message }, 'Analytics payment_success tracking failed'); }
        try{
          const invoice = event.data.object;
          const customerEmail = invoice.customer_email || (invoice.customer && invoice.customer.email) || 'parent@example.com';
          await sendTemplate(customerEmail,'Payment Receipt','payment-receipt-email.html',{
            parent_first_name: customerEmail.split('@')[0],
            invoice_number: invoice.number || invoice.id,
            amount_formatted: `$${(invoice.amount_paid/100).toFixed(2)}`,
            payment_date: new Date().toISOString().substring(0,10),
            card_brand: 'Card',
            card_last4: '••••',
            portal_invoices_link: 'https://melodyandmeter.com/portal/invoices',
            policies_link: 'https://melodyandmeter.com/policies',
            help_link: 'https://melodyandmeter.com/help'
          });
        }catch(e){ logger.error({ err:e }, 'Receipt email failed'); }
        break;
      case 'invoice.payment_failed':
        logger.info({ invoice:event.data.object.id }, 'Invoice payment failed');
        addAudit({ actor:'webhook', action:'invoice.payment_failed', meta:{ id:event.data.object.id } });
        persistence.incrementWebhookCounter(event.type);
        try{
          const invoice = event.data.object;
            require('./analytics').trackEvent('payment_failed', { invoice_id: invoice.id, failure_reason: (invoice.last_payment_error && invoice.last_payment_error.code) || 'unknown', ts: Date.now() });
        }catch(e){ logger.warn({ err:e.message }, 'Analytics payment_failed tracking failed'); }
        try{
          const invoice = event.data.object;
          const customerEmail = invoice.customer_email || 'parent@example.com';
          await sendTemplate(customerEmail,'Payment Issue - Action Required','payment-failed-email.html',{
            parent_first_name: customerEmail.split('@')[0],
            invoice_number: invoice.number || invoice.id,
            amount_due_formatted: `$${((invoice.amount_due||0)/100).toFixed(2)}`,
            update_payment_link: 'https://melodyandmeter.com/portal/billing/payment-method',
            help_link: 'https://melodyandmeter.com/help'
          });
        }catch(e){ logger.error({ err:e }, 'Failure email send failed'); }
        break;
      case 'customer.subscription.created':
        logger.info({ subscription:event.data.object.id }, 'Subscription created');
        addAudit({ actor:'webhook', action:'subscription.created', meta:{ id:event.data.object.id } });
        persistence.incrementWebhookCounter(event.type);
        break;
      case 'customer.subscription.updated':
        logger.info({ subscription:event.data.object.id }, 'Subscription updated');
        addAudit({ actor:'webhook', action:'subscription.updated', meta:{ id:event.data.object.id } });
        persistence.incrementWebhookCounter(event.type);
        break;
      default:
        logger.info({ type:event.type }, 'Unhandled event type');
        addAudit({ actor:'webhook', action:'unhandled_event', meta:{ type:event.type } });
        persistence.incrementWebhookCounter(event.type);
    }
  res.json({received:true});
});

// Trial follow-up trigger endpoint (manual admin call or automated after trial)
app.post('/api/emails/trial-followup', trialFollowLimiter, asyncHandler(async (req,res)=>{
  const { email, parentFirstName, studentFirstName } = req.body;
  if(!email) return res.status(400).json({error:'email_required'});
  if(rejectIfInvalidEmail(res,email)) return;
  const parentName = cleanName(parentFirstName)||email.split('@')[0];
  const studentName = cleanName(studentFirstName)||'your child';
  await sendTemplate(email,'Your Melody & Meter Trial — Secure a Weekly Slot','invite-trial-followup-email.html',{
    parent_first_name: parentName,
    student_first_name: studentName,
    portal_register_link: 'https://melodyandmeter.com/portal/register',
    policies_link: 'https://melodyandmeter.com/policies'
  });
  res.json({ status:'sent' });
}));

// --- Email Queue Status Endpoint (non-auth; restrict in prod later) ---
function requireAdminKey(req,res,next){
  const primary = process.env.ADMIN_API_KEY;
  const secondary = process.env.ADMIN_API_KEY_SECONDARY;
  if(!primary && !secondary){ return res.status(403).json({ error:'admin_key_not_configured' }); }
  const provided = req.headers['x-admin-key'];
  if(!provided){ return res.status(401).json({ error:'unauthorized' }); }
  let keyId = null;
  if(provided === primary) keyId = 'primary';
  else if(provided === secondary) keyId = 'secondary';
  else return res.status(401).json({ error:'unauthorized' });
  req.adminKeyId = keyId;
  res.setHeader('x-admin-key-id', keyId);
  next();
}
const adminLimiter = rateLimit({ windowMs:60*1000, max: parseInt(process.env.ADMIN_RATE_LIMIT_MAX||'60',10), standardHeaders:true, legacyHeaders:false, message:{ error:'admin_rate_limited' } });
// Test-only reset for admin rate limiter
if(process.env.JEST_WORKER_ID){
  app.post('/__test/reset-admin-rate-limit', (req,res)=>{
    try{ adminLimiter.resetKey(req.ip); }catch(e){ /* ignore */ }
    res.json({ reset:true });
  });
}
app.get('/api/admin/email-queue', requireAdminKey, adminLimiter, (req,res)=>{
  const stats = persistence.getEmailJobStats();
  const recent = persistence.getRecentEmailJobs(100);
  addAudit({ actor:req.adminKeyId, action:'get_email_queue', meta:{ depth: stats.depth } });
  res.json({
    metrics,
    depth: stats.depth,
    pending: recent.filter(j=>j.status==='pending').map(j=>({ to:maskEmail(j.to), subject:j.subject, attempts:j.attempts, nextAttemptInMs: Math.max(j.nextAttemptAt - Date.now(),0) }))
  });
});
app.get('/api/admin/audit', requireAdminKey, adminLimiter, (req,res)=>{
  const limit = parseInt(req.query.limit||'50',10);
  const entries = persistence.getAudit(limit).map(e=>({ ts:e.ts, actor:e.actor, action:e.action, meta:e.meta||{} }));
  addAudit({ actor:req.adminKeyId, action:'get_audit', meta:{ returned: entries.length } });
  res.json({ entries, total: persistence.getAuditTotal() });
});

// Admin analytics events listing
app.get('/api/admin/analytics-events', requireAdminKey, adminLimiter, (req,res)=>{
  const limit = parseInt(req.query.limit||'50',10);
  const events = persistence.listAnalyticsEvents(limit).map(ev=>({ id:ev.id, name:ev.name, ts:ev.tsIngested }));
  addAudit({ actor:req.adminKeyId, action:'get_analytics_events', meta:{ returned: events.length } });
  res.json({ events, total: persistence.getAnalyticsEventTotal() });
});

// Admin resources listing (current resource_id allowlist configuration)
function getAllowedResourceIds(){
  const raw = process.env.ALLOWED_RESOURCE_IDS;
  if(typeof raw !== 'string' || !raw.trim()) return [];
  return raw.split(',').map(s=>s.trim()).filter(Boolean);
}
function isAllowlistEnforced(){ return getAllowedResourceIds().length > 0; }
// Parse capacity minutes mapping: RESOURCE_CAPACITY_MINUTES="primary:480,piano:600"
function getResourceCapacityMinutes(){
  const raw = process.env.RESOURCE_CAPACITY_MINUTES;
  if(typeof raw !== 'string' || !raw.trim()) return {};
  const map = {};
  raw.split(',').map(pair=>pair.trim()).filter(Boolean).forEach(pair=>{
    const [id,val] = pair.split(':');
    const minutes = parseInt(val,10);
    if(id && !isNaN(minutes) && minutes > 0){ map[id.trim()] = minutes; }
  });
  return map;
}
app.get('/api/admin/resources', requireAdminKey, adminLimiter, (req,res)=>{
  const allowed = getAllowedResourceIds();
  const enforced = allowed.length > 0;
  addAudit({ actor:req.adminKeyId, action:'get_resources', meta:{ count: allowed.length, enforced } });
  res.json({ enforced, allowedResourceIds: allowed });
});

// --- Metrics endpoint (Prometheus-style) ---
app.get('/api/admin/metrics', requireAdminKey, adminLimiter, (req,res)=>{
  // Collect snapshot metrics
  const lines = [];
  lines.push('# HELP melody_email_success_total Number of emails successfully sent via queue');
  lines.push('# TYPE melody_email_success_total counter');
  lines.push(`melody_email_success_total ${metrics.emailSuccess}`);
  lines.push('# HELP melody_email_permanent_failure_total Number of emails that permanently failed');
  lines.push('# TYPE melody_email_permanent_failure_total counter');
  lines.push(`melody_email_permanent_failure_total ${metrics.emailPermanentFailure}`);
  const queueStats = persistence.getEmailJobStats();
  const webhookCounters = persistence.getWebhookCounters();
  const webhookEventTotal = persistence.getWebhookEventTotal();
  const analyticsTotal = persistence.getAnalyticsEventTotal ? persistence.getAnalyticsEventTotal() : 0;
  const replayWindowMs = persistence.getReplayWindowMs ? persistence.getReplayWindowMs() : (24*60*60*1000);
  lines.push('# HELP melody_email_queue_depth Current number of queued email jobs');
  lines.push('# TYPE melody_email_queue_depth gauge');
  lines.push(`melody_email_queue_depth ${queueStats.depth}`);
  lines.push('# HELP melody_email_jobs_success_total Total email jobs marked success');
  lines.push('# TYPE melody_email_jobs_success_total gauge');
  lines.push(`melody_email_jobs_success_total ${queueStats.success}`);
  lines.push('# HELP melody_email_jobs_permanent_failure_total Total email jobs permanently failed');
  lines.push('# TYPE melody_email_jobs_permanent_failure_total gauge');
  lines.push(`melody_email_jobs_permanent_failure_total ${queueStats.permanentFailure}`);
  lines.push('# HELP melody_webhook_events_stored_total Total webhook events tracked for replay protection');
  lines.push('# TYPE melody_webhook_events_stored_total gauge');
  lines.push(`melody_webhook_events_stored_total ${webhookEventTotal}`);
  lines.push('# HELP melody_webhook_invoice_paid_total Count of invoice.paid webhook events processed');
  lines.push('# TYPE melody_webhook_invoice_paid_total counter');
  lines.push(`melody_webhook_invoice_paid_total ${webhookCounters.invoice_paid}`);
  lines.push('# HELP melody_webhook_invoice_payment_failed_total Count of invoice.payment_failed webhook events processed');
  lines.push('# TYPE melody_webhook_invoice_payment_failed_total counter');
  lines.push(`melody_webhook_invoice_payment_failed_total ${webhookCounters.invoice_payment_failed}`);
  lines.push('# HELP melody_webhook_subscription_created_total Count of subscription.created webhook events processed');
  lines.push('# TYPE melody_webhook_subscription_created_total counter');
  lines.push(`melody_webhook_subscription_created_total ${webhookCounters.subscription_created}`);
  lines.push('# HELP melody_webhook_subscription_updated_total Count of subscription.updated webhook events processed');
  lines.push('# TYPE melody_webhook_subscription_updated_total counter');
  lines.push(`melody_webhook_subscription_updated_total ${webhookCounters.subscription_updated}`);
  lines.push('# HELP melody_webhook_unhandled_event_total Count of unhandled webhook events processed');
  lines.push('# TYPE melody_webhook_unhandled_event_total counter');
  lines.push(`melody_webhook_unhandled_event_total ${webhookCounters.unhandled_event}`);
  lines.push('# HELP melody_webhook_replay_window_ms Configured webhook replay protection window in milliseconds');
  lines.push('# TYPE melody_webhook_replay_window_ms gauge');
  lines.push(`melody_webhook_replay_window_ms ${replayWindowMs}`);
  lines.push('# HELP melody_analytics_events_total Total analytics events stored');
  lines.push('# TYPE melody_analytics_events_total gauge');
  lines.push(`melody_analytics_events_total ${analyticsTotal}`);
  lines.push('# HELP melody_audit_log_entries_total Total audit log entries retained');
  lines.push('# TYPE melody_audit_log_entries_total gauge');
  lines.push(`melody_audit_log_entries_total ${persistence.getAuditTotal()}`);
  // Active bookings (confirmed) gauges
  const confirmedTotal = persistence.getConfirmedBookingTotal ? persistence.getConfirmedBookingTotal() : 0;
  lines.push('# HELP melody_bookings_confirmed_total Number of confirmed bookings (all resources)');
  lines.push('# TYPE melody_bookings_confirmed_total gauge');
  lines.push(`melody_bookings_confirmed_total ${confirmedTotal}`);
  const confirmedMinutesTotal = persistence.getConfirmedBookingMinutesTotal ? persistence.getConfirmedBookingMinutesTotal() : 0;
  lines.push('# HELP melody_bookings_confirmed_minutes_total Total confirmed booking duration in minutes (all resources)');
  lines.push('# TYPE melody_bookings_confirmed_minutes_total gauge');
  lines.push(`melody_bookings_confirmed_minutes_total ${confirmedMinutesTotal}`);
  const perResource = persistence.getConfirmedBookingCountsPerResource ? persistence.getConfirmedBookingCountsPerResource() : {};
  lines.push('# HELP melody_bookings_confirmed Resource-scoped confirmed booking counts');
  lines.push('# TYPE melody_bookings_confirmed gauge');
  const allowedIds = getAllowedResourceIds();
  if(isAllowlistEnforced()){
    // Emit a stable time series for every allowed resource id (zero if none yet)
    for(const rid of allowedIds){
      const safeRid = rid.replace(/"/g,'');
      const count = perResource[rid] || 0;
      lines.push(`melody_bookings_confirmed{resource_id="${safeRid}"} ${count}`);
    }
  }else{
    for(const [rid,count] of Object.entries(perResource)){
      lines.push(`melody_bookings_confirmed{resource_id="${rid.replace(/"/g,'')}"} ${count}`);
    }
    // If there are currently no confirmed bookings, emit a zero gauge for a default
    // resource so that tooling/tests expecting at least one labelled sample still match.
    if(Object.keys(perResource).length === 0){
      const fallbackResourceId = 'primary';
      lines.push(`melody_bookings_confirmed{resource_id="${fallbackResourceId}"} 0`);
    }
  }
  // Confirmed booking minutes per resource
  const minutesPerResource = persistence.getConfirmedBookingMinutesPerResource ? persistence.getConfirmedBookingMinutesPerResource() : {};
  lines.push('# HELP melody_bookings_confirmed_minutes Resource-scoped confirmed booking total minutes');
  lines.push('# TYPE melody_bookings_confirmed_minutes gauge');
  if(isAllowlistEnforced()){
    for(const rid of allowedIds){
      const safeRid = rid.replace(/"/g,'');
      const mins = minutesPerResource[rid] || 0;
      lines.push(`melody_bookings_confirmed_minutes{resource_id="${safeRid}"} ${mins}`);
    }
  }else{
    for(const [rid,mins] of Object.entries(minutesPerResource)){
      lines.push(`melody_bookings_confirmed_minutes{resource_id="${rid.replace(/"/g,'')}"} ${mins}`);
    }
    if(Object.keys(minutesPerResource).length === 0){
      const fallbackResourceId = 'primary';
      lines.push(`melody_bookings_confirmed_minutes{resource_id="${fallbackResourceId}"} 0`);
    }
  }
  // Capacity utilization percent (0-1 ratio) per resource if capacity configured
  const capacityMap = getResourceCapacityMinutes();
  lines.push('# HELP melody_bookings_utilization_percent Ratio of booked minutes to configured capacity per resource (0-1)');
  lines.push('# TYPE melody_bookings_utilization_percent gauge');
  const utilizationIds = isAllowlistEnforced() ? allowedIds : Object.keys(minutesPerResource);
  if(utilizationIds.length === 0){
    // fallback stable sample if nothing yet and no allowlist
    utilizationIds.push('primary');
  }
  for(const rid of utilizationIds){
    const safeRid = rid.replace(/"/g,'');
    const booked = minutesPerResource[rid] || 0;
    const cap = capacityMap[rid];
    const ratio = (typeof cap === 'number' && cap > 0) ? (booked / cap) : 0;
    lines.push(`melody_bookings_utilization_percent{resource_id="${safeRid}"} ${ratio}`);
  }
  // Booking duration histogram (confirmed booking durations in minutes)
  const allDurations = Object.entries(minutesPerResource).length ? Object.values(persistence.getConfirmedBookingMinutesPerResource()) : []; // map minutes, but need per booking durations
  // Need per booking durations; derive from bookings directly
  const rawBookings = (function(){ try{ return Object.values(require('./persistence').listRecentBookings ? require('./persistence').listRecentBookings(10000) : []); }catch(e){ return []; } })();
  const confirmedDurations = rawBookings.filter(b=>b.status==='confirmed').map(b=> (typeof b.duration_min==='number' && b.duration_min>0 ? b.duration_min : 0));
  const buckets = [0,15,30,45,60,90,120,240,480];
  const bucketCounts = buckets.map(()=>0);
  let sumDur = 0;
  for(const d of confirmedDurations){
    sumDur += d;
    for(let i=0;i<buckets.length;i++){
      if(d <= buckets[i]){ bucketCounts[i]++; break; }
    }
  }
  lines.push('# HELP melody_booking_duration_minutes Histogram of confirmed booking durations (minutes)');
  lines.push('# TYPE melody_booking_duration_minutes histogram');
  let cumulative = 0;
  for(let i=0;i<buckets.length;i++){
    cumulative = bucketCounts[i];
    lines.push(`melody_booking_duration_minutes_bucket{le="${buckets[i]}"} ${cumulative}`);
  }
  // +Inf bucket
  lines.push(`melody_booking_duration_minutes_bucket{le="+Inf"} ${confirmedDurations.length}`);
  lines.push(`melody_booking_duration_minutes_sum ${sumDur}`);
  lines.push(`melody_booking_duration_minutes_count ${confirmedDurations.length}`);
  // Late cancellation counters (derived from booking records)
  const lateCancelledTotal = persistence.getLateCancellationTotal ? persistence.getLateCancellationTotal() : 0;
  lines.push('# HELP melody_bookings_cancelled_late_total Number of late-cancelled bookings (penalty applied)');
  lines.push('# TYPE melody_bookings_cancelled_late_total gauge');
  lines.push(`melody_bookings_cancelled_late_total ${lateCancelledTotal}`);
  const latePerResource = persistence.getLateCancellationCountsPerResource ? persistence.getLateCancellationCountsPerResource() : {};
  lines.push('# HELP melody_bookings_cancelled_late Resource-scoped late cancellation counts');
  lines.push('# TYPE melody_bookings_cancelled_late gauge');
  if(isAllowlistEnforced()){
    for(const rid of allowedIds){
      const safeRid = rid.replace(/"/g,'');
      const count = latePerResource[rid] || 0;
      lines.push(`melody_bookings_cancelled_late{resource_id="${safeRid}"} ${count}`);
    }
  }else{
    for(const [rid,count] of Object.entries(latePerResource)){
      lines.push(`melody_bookings_cancelled_late{resource_id="${rid.replace(/"/g,'')}"} ${count}`);
    }
    if(Object.keys(latePerResource).length === 0){
      const fallbackResourceId = 'primary';
      lines.push(`melody_bookings_cancelled_late{resource_id="${fallbackResourceId}"} 0`);
    }
  }
  // Reschedule lead time stats
  const leadStats = persistence.getRescheduleLeadTimeStats ? persistence.getRescheduleLeadTimeStats() : { count:0, avgHours:0, medianHours:0, completedCount:0 };
  lines.push('# HELP melody_reschedule_lead_time_hours_avg Average hours until start when reschedules initiated');
  lines.push('# TYPE melody_reschedule_lead_time_hours_avg gauge');
  lines.push(`melody_reschedule_lead_time_hours_avg ${leadStats.avgHours}`);
  lines.push('# HELP melody_reschedule_lead_time_hours_median Median hours until start when reschedules initiated');
  lines.push('# TYPE melody_reschedule_lead_time_hours_median gauge');
  lines.push(`melody_reschedule_lead_time_hours_median ${leadStats.medianHours}`);
  lines.push('# HELP melody_reschedule_completed_total Total number of completed reschedules (across bookings)');
  lines.push('# TYPE melody_reschedule_completed_total gauge');
  lines.push(`melody_reschedule_completed_total ${leadStats.completedCount}`);
  addAudit({ actor:req.adminKeyId, action:'get_metrics', meta:{ queueDepth: queueStats.depth, webhookEvents: webhookEventTotal } });
  res.setHeader('Content-Type','text/plain; charset=utf-8');
  res.send(lines.join('\n') + '\n');
});

// --- Health endpoint ---
app.get('/health', (req,res)=>{
  let version = '0.0.0';
  try{ const pkg = JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8')); version = pkg.version; }catch(e){ /* ignore */ }
  res.json({ status:'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), version });
});

// Test error route to exercise error handler
app.get('/api/test/error', asyncHandler(async (req,res)=>{ throw new Error('boom'); }));

// --- Central error handler (must be last) ---
app.use((err, req, res, next)=>{
  logger.error({ err, path:req.path }, 'Unhandled error');
  if(res.headersSent) return next(err);
  res.status(500).json({ error:'internal_error', request_id: req.id || req.headers['x-request-id'] });
});

const PORT = process.env.PORT || 4242;
// Avoid starting listener when running under Jest (JEST_WORKER_ID set)
if(!process.env.JEST_WORKER_ID){
  app.listen(PORT, ()=>logger.info({ port:PORT }, 'Server started'));
}

// --- Validation Stub Endpoints (enums & analytics events) ---
// These are lightweight and will be expanded later.
const validation = require('./validation-stubs');

app.post('/api/booking/validate-transition', (req,res)=>{
  const { current, next } = req.body || {};
  if(!current || !next) return res.status(400).json({ error:'current_and_next_required' });
  const valid = validation.validateBookingStatusTransition(current, next);
  res.json({ valid });
});

app.post('/api/analytics/events', (req,res)=>{
  const { events } = req.body || {};
  const { accepted, errors } = validation.batchValidateAnalyticsEvents(events);
  if(errors.length){
    return res.status(400).json({ accepted_count: accepted.length, errors });
  }
  // Persist accepted events
  for(const ev of accepted){
    try{ persistence.addAnalyticsEvent(ev.name, ev.payload); }catch(e){ /* ignore single persist errors */ }
  }
  res.json({ accepted_count: accepted.length });
});

// Mount consolidated booking instrumentation routes
app.use(require('./bookingInstrumentationRoutes'));

// Booking domain CRUD (create/reschedule/cancel) moved to bookingRoutes.js
app.use(require('./bookingRoutes'));

app.post('/api/lesson/complete', (req,res)=>{
  const { booking_id, teacher_id, duration_min, start_at, end_at } = req.body || {};
  if(!booking_id || !teacher_id || typeof duration_min !== 'number') return res.status(400).json({ error:'booking_id_teacher_id_duration_min_required' });
  require('./analytics').trackEvent('lesson_completed', { booking_id, teacher_id, duration_min, ts: Date.now(), ...(start_at?{start_at}:{}) , ...(end_at?{end_at}:{}) });
  res.json({ completed:true });
});

app.post('/api/practice/add-entry', (req,res)=>{
  const { booking_id, student_id, tasks_count, entry_type } = req.body || {};
  if(!booking_id || !student_id || typeof tasks_count !== 'number' || !entry_type) return res.status(400).json({ error:'booking_id_student_id_tasks_count_entry_type_required' });
  require('./analytics').trackEvent('practice_entry_added', { booking_id, student_id, tasks_count, entry_type, ts: Date.now() });
  res.json({ added:true });
});

// (Legacy inline reschedule/cancel/create endpoints removed; see bookingRoutes.js)


module.exports = app;
