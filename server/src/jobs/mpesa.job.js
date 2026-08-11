const { Worker, Queue } = require('bullmq');
const IORedis = require('ioredis');
const mpesaService = require('../services/mpesa.service');

const queueName = 'mpesa-status-check';
let statusQueue = null;
let worker = null;
let redisConnection = null;
const redisUrl = process.env.REDIS_URL?.trim();

const getRedisConnection = () => {
  if (!redisUrl) return null;
  if (redisConnection) return redisConnection;

  redisConnection = new IORedis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 10000,
    maxRetriesPerRequest: null,
  });

  redisConnection.on('error', (err) => {
    console.error('BullMQ Redis connection error:', err);
  });

  return redisConnection;
};

const getStatusQueue = () => {
  const connection = getRedisConnection();
  if (!connection) {
    throw new Error('Redis is not configured. Set REDIS_URL to enable the M-Pesa status queue.');
  }

  if (!statusQueue) {
    statusQueue = new Queue(queueName, { connection });
  }
  return statusQueue;
};

const startMpesaWorker = async () => {
  if (!redisUrl) {
    console.warn('Skipping M-Pesa BullMQ worker startup because REDIS_URL is not configured.');
    return null;
  }

  if (worker) return worker;

  worker = new Worker(queueName, async (job) => {
    const { checkoutRequestId, attempt } = job.data;
    const transaction = await mpesaService.pollTransactionStatus(checkoutRequestId);

    if (transaction.status === 'pending' && attempt < 3) {
      return { status: 'pending' };
    }

    return { status: transaction.status };
  }, { connection: getRedisConnection() });

  worker.on('completed', async (job) => {
    const { checkoutRequestId, attempt } = job.data;
    const state = job.returnvalue;
    if (state.status === 'pending' && attempt < 3) {
      const nextDelay = [120000, 240000, 480000][attempt] || 480000;
      await getStatusQueue().add('check-status', { checkoutRequestId, attempt: attempt + 1 }, { delay: nextDelay, removeOnComplete: true, removeOnFail: true });
    }
  });

  worker.on('failed', (job, err) => {
    console.error('Mpesa status worker failed:', job.id, err);
  });

  return worker;
};

const enqueueStatusCheck = async (checkoutRequestId) => {
  if (!redisUrl) {
    console.warn('Cannot enqueue M-Pesa status check because REDIS_URL is not configured.');
    return null;
  }

  await getStatusQueue().add('check-status', { checkoutRequestId, attempt: 0 }, {
    removeOnComplete: true,
    removeOnFail: true,
  });
};

module.exports = {
  enqueueStatusCheck,
  startMpesaWorker,
};
