const { Queue, Worker, UnrecoverableError } = require('bullmq');
const Redis = require('ioredis');
const logger = require('../config/logger');
const payoutService = require('../services/payout.service');
const PayoutQueue = require('../models/PayoutQueue.model');

const queueName = 'payout-disbursements';
let payoutQueue;
let worker;
let redisConnection;

const getRedisConnection = () => {
  if (!redisConnection && process.env.REDIS_URL) {
    redisConnection = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null, // BullMQ needs to be able to retry
    });
  }
  return redisConnection;
};

/**
 * Hand an approved payout to the B2C worker.
 *
 * Deliberately NOT deduplicated by `jobId`. BullMQ keeps completed jobs, so a re-queued
 * payout (reject → requeue → approve) would collide with the retained job for its first
 * approval and be silently dropped — a worse failure than a duplicate job, which
 * `sendB2C`'s `approved` → `processing` CAS already makes harmless: the second attempt
 * gets a 409 and never reaches Daraja.
 *
 * @param {string|import('mongoose').Types.ObjectId} payoutId
 */
const enqueuePayout = async (payoutId) => {
  if (!payoutQueue) {
    logger.warn({ payoutId: String(payoutId) }, 'Payout queue not initialized, skipping B2C dispatch enqueue.');
    return;
  }
  await payoutQueue.add('send-b2c', { payoutId: String(payoutId) }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60 * 1000 }, // 1m, 2m, 4m
  });
  logger.info({ payoutId: String(payoutId) }, 'Enqueued B2C payout dispatch.');
};

/**
 * Enqueue every payout still sitting at `approved`. Runs once when the worker starts.
 *
 * This is the only thing that heals an enqueue lost to a Redis blip, and it is also how
 * `AUTO_PAYOUT=true` payouts — approved by escrow, never by an admin request — get a
 * dispatch path at all. Caveat until a repeatable sweep lands: a payout approved while the
 * worker is down waits for the next worker start.
 */
const enqueueApprovedBacklog = async () => {
  const stranded = await PayoutQueue.find({ status: 'approved' }).select('_id').lean();
  if (stranded.length === 0) return;

  for (const payout of stranded) {
    await enqueuePayout(payout._id);
  }
  logger.info({ count: stranded.length }, 'Re-enqueued approved payouts left from a previous run.');
};

const startPayoutWorker = async () => {
  const connection = getRedisConnection();
  if (!connection) {
    logger.warn('Redis not configured, payout worker will not start.');
    return;
  }

  payoutQueue = new Queue(queueName, { connection });

  worker = new Worker(queueName, async (job) => {
    const { payoutId } = job.data;
    logger.info({ job: job.id, payoutId }, 'Dispatching B2C payout');

    try {
      const payout = await payoutService.sendB2C(payoutId);
      return { payoutId, status: payout.status };
    } catch (err) {
      // A 4xx answer will not change on a retry: the payout is gone (404), no longer
      // `approved` (409), or the seller has no usable MSISDN (400). Retrying only re-logs the
      // same failure three times. 503 is excluded on purpose — the circuit breaker may clear
      // before the next attempt — as are config errors, which carry no statusCode and are
      // worth retrying in case the deploy that fixes them lands first.
      if (err.statusCode >= 400 && err.statusCode < 500) {
        throw new UnrecoverableError(`${err.statusCode} ${err.message}`);
      }
      throw err;
    }
  }, { connection });

  worker.on('completed', (job) => {
    logger.info({ job: job.id }, `Payout job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error({ job: job?.id, err }, `Payout job ${job?.id} failed`);
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'BullMQ payout worker error');
  });

  await enqueueApprovedBacklog();
};

const stopPayoutWorker = async () => {
  if (worker) {
    logger.info('Closing payout worker...');
    await worker.close();
    logger.info('Payout worker closed.');
  }
  if (payoutQueue) {
    await payoutQueue.close();
  }
};

module.exports = { startPayoutWorker, stopPayoutWorker, enqueuePayout };
