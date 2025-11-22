// Redis/BullMQ queue spike for email jobs.
// Graceful fallback to no-op stubs if bullmq or Redis unavailable.
// Activation: set USE_REDIS_QUEUE=true and REDIS_URL=redis://host:port

let bullmqAvailable = false;
let Queue, Worker, QueueEvents;
try {
  ({ Queue, Worker, QueueEvents } = require('bullmq'));
  bullmqAvailable = true;
} catch (e) {
  bullmqAvailable = false;
}

const state = {
  enabled: false,
  queues: {},
  workers: {},
  events: {},
  lastMetrics: null
};

function initEmailQueue(logger) {
  if (!bullmqAvailable) {
    logger && logger.warn('BullMQ not available; queue disabled');
    return false;
  }
  if (process.env.USE_REDIS_QUEUE !== 'true') {
    logger && logger.info('USE_REDIS_QUEUE not true; skipping Redis queue init');
    return false;
  }
  const connectionUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const connection = { connection: { url: connectionUrl } };
  const emailQueue = new Queue('email-jobs', connection);
  const dlqQueue = new Queue('email-jobs-dlq', connection);
  const emailEvents = new QueueEvents('email-jobs', connection);
  state.queues.email = emailQueue;
  state.queues.dlq = dlqQueue;
  state.events.email = emailEvents;
  state.enabled = true;
  if (logger) logger.info({ connectionUrl }, 'Email BullMQ queues initialized');
  // Worker to process jobs
  state.workers.email = new Worker('email-jobs', async job => {
    const { to, subject, htmlBody, textBody, attempts, maxAttempts } = job.data;
    // Simulate underlying send via persistence dispatch logic for consistency
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({ jsonTransport: true });
    await transport.sendMail({ from: process.env.MAIL_FROM||'no-reply@melodyandmeter.com', to, subject, html: htmlBody, text: textBody });
    return { delivered: true, attempts: attempts }; // result stored in job.returnvalue
  }, connection);
  state.workers.email.on('failed', async (job, err) => {
    if (!state.queues.dlq) return;
    // Move to DLQ if attempts exceeded
    const maxAttempts = job.data.maxAttempts || 5;
    if (job.attemptsMade >= maxAttempts) {
      await state.queues.dlq.add('email-job-dlq', { ...job.data, failureReason: err.message, movedToDlqAt: Date.now() });
    }
  });
  return true;
}

async function enqueueEmailJobPersisted(jobRecord, logger) {
  if (!state.enabled || !state.queues.email) return false;
  try {
    await state.queues.email.add('email-job', {
      id: jobRecord.id,
      to: jobRecord.to,
      subject: jobRecord.subject,
      htmlBody: jobRecord.htmlBody,
      textBody: jobRecord.textBody,
      attempts: jobRecord.attempts,
      maxAttempts: jobRecord.maxAttempts || 5
    }, { attempts: jobRecord.maxAttempts || 5, backoff: { type: 'exponential', delay: 2000 } });
    if (logger) logger.info({ id: jobRecord.id }, 'Enqueued email job into Redis');
    return true;
  } catch (e) {
    if (logger) logger.error({ err: e.message }, 'Failed to enqueue email job');
    return false;
  }
}

async function collectQueueMetrics() {
  if (!state.enabled || !state.queues.email) {
    return { enabled: false, bullmqAvailable, email: null, dlq: null };
  }
  const emailCounts = await state.queues.email.getJobCounts();
  const dlqCounts = await state.queues.dlq.getJobCounts();
  const metrics = {
    enabled: true,
    bullmqAvailable,
    email: emailCounts,
    dlq: dlqCounts,
    timestamp: Date.now()
  };
  state.lastMetrics = metrics;
  return metrics;
}

module.exports = {
  initEmailQueue,
  enqueueEmailJobPersisted,
  collectQueueMetrics,
  isEnabled: () => state.enabled,
  getLastMetrics: () => state.lastMetrics,
  listDlqJobs: async (limit) => {
    if(!state.enabled || !state.queues.dlq) return { enabled:false, jobs:[] };
    const l = typeof limit==='number' && limit>0 ? limit : 50;
    const waiting = await state.queues.dlq.getJobs(['waiting']);
    const failed = await state.queues.dlq.getJobs(['failed']);
    const all = [...waiting, ...failed].slice(0,l);
    const jobs = all.map(j=>({
      id: j.id,
      originalId: j.data.id,
      to: j.data.to,
      subject: j.data.subject,
      attemptsMade: j.attemptsMade,
      maxAttempts: j.data.maxAttempts,
      failureReason: j.data.failureReason || null,
      movedToDlqAt: j.data.movedToDlqAt || null
    }));
    return { enabled:true, jobs };
  },
  requeueDlqJob: async (originalId, logger) => {
    if(!state.enabled || !state.queues.dlq || !state.queues.email) return { requeued:false, reason:'queue_disabled' };
    const dlqJobs = await state.queues.dlq.getJobs(['waiting','failed']);
    const target = dlqJobs.find(j=> j.data && j.data.id === originalId);
    if(!target) return { requeued:false, reason:'not_found' };
    try{
      await state.queues.email.add('email-job', {
        id: target.data.id,
        to: target.data.to,
        subject: target.data.subject,
        htmlBody: target.data.htmlBody,
        textBody: target.data.textBody,
        attempts: target.data.attempts || 0,
        maxAttempts: target.data.maxAttempts || 5,
        requeuedFromDlqAt: Date.now()
      }, { attempts: (target.data.maxAttempts||5), backoff:{ type:'exponential', delay:2000 } });
      await target.remove();
      if(logger) logger.info({ id: originalId }, 'Requeued DLQ email job');
      return { requeued:true };
    }catch(e){ if(logger) logger.error({ id: originalId, err:e.message }, 'Requeue DLQ failed'); return { requeued:false, reason:'error', error:e.message }; }
  },
  purgeDlq: async (logger) => {
    if(!state.enabled || !state.queues.dlq) return { purged:false, reason:'queue_disabled' };
    const jobs = await state.queues.dlq.getJobs(['waiting','failed','delayed']);
    let removed = 0;
    for(const j of jobs){ try{ await j.remove(); removed++; }catch(e){ /* ignore */ } }
    if(logger) logger.warn({ removed }, 'Purged DLQ jobs');
    return { purged:true, removed };
  }
};
