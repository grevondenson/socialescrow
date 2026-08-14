const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const logger = require('../config/logger');
const mpesaService = require('../services/mpesa.service');

const queueName = 'mpesa-status-checks';
let mpesaQueue;
let worker;
let redisConnection;

const getRedisConnection = () => {
  if (!redisConnection && process.env.REDIS_URL) {
    redisConnection = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null, // BullMQ needs to be ableto retry
    });
  }
  return redisConnection;
};

const startMpesaWorker = async () => {
  const connection = getRedisConnection();
  if (!connection) {
    logger.warn('Redis not configured, M-Pesa worker will not start.');
    return;
  }

  mpesaQueue = new Queue(queueName, { connection });

  worker = new Worker(queueName, async (job) => {
    const { checkoutRequestId } = job.data;
    logger.info({ job: job.id, checkoutRequestId }, 'Polling M-Pesa status');
    await mpesaService.pollTransactionStatus(checkoutRequestId);
  }, { connection });

  worker.on('completed', (job) => {
    logger.info({ job: job.id }, `Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error({ job: job.id, err }, `Job ${job.id} failed`);
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'BullMQ worker error');
  });
};

const stopMpesaWorker = async () => {
  if (worker) {
    logger.info('Closing M-Pesa worker...');
    await worker.close();
    logger.info('M-Pesa worker closed.');
  }
  if (mpesaQueue) {
    await mpesaQueue.close();
  }
};

const enqueueStatusCheck = async (checkoutRequestId) => {
  if (!mpesaQueue) {
    logger.warn('M-Pesa queue not initialized, skipping status check enqueue.');
    return;
  }
  await mpesaQueue.add('poll-status', { checkoutRequestId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2 * 60 * 1000 }, // 2m, 4m, 8m
  });
  logger.info({ checkoutRequestId }, 'Enqueued M-Pesa status check job.');
};

module.exports = { startMpesaWorker, stopMpesaWorker, enqueueStatusCheck };