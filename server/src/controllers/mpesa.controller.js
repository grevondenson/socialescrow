const mpesaService = require('../services/mpesa.service');
const payoutService = require('../services/payout.service');
const logger = require('../config/logger');
const { emitToTrade } = require('../sockets/trade.socket');
const { enqueueStatusCheck } = require('../jobs/mpesa.job');

exports.triggerStkPush = async (req, res, next) => {
  try {
    const { tradeId, phoneNumber } = req.body;
    if (!tradeId || !phoneNumber) {
      return res.status(400).json({ message: 'tradeId and phoneNumber are required' });
    }

    const transaction = await mpesaService.triggerSTKPush(phoneNumber, tradeId, req.user.id);
    await enqueueStatusCheck(transaction.checkoutRequestId);
    // Do NOT return checkoutRequestId / merchantRequestId: exposing them let a
    // buyer forge a callback for their own trade. The client polls trade status.
    res.status(201).json({
      status: 'pending',
      transactionId: transaction._id,
      tradeId: transaction.trade,
      amountKes: transaction.amountKes,
      message: 'STK Push initiated. Check your phone to authorize the payment.',
    });
  } catch (error) {
    next(error);
  }
};

exports.submitManualPayment = async (req, res, next) => {
  try {
    const { tradeId, referenceCode, phoneNumber } = req.body;
    if (!tradeId || !referenceCode) {
      return res.status(400).json({ message: 'tradeId and referenceCode are required' });
    }

    const transaction = await mpesaService.submitManualPayment(tradeId, referenceCode, req.user.id, phoneNumber);
    res.status(201).json(transaction);
  } catch (error) {
    next(error);
  }
};

exports.verifyManualPayment = async (req, res, next) => {
  try {
    const { status, notes, amountKes } = req.body;
    const transactionId = req.params.id;
    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ message: "status must be 'verified' or 'rejected'" });
    }
    if (status === 'verified' && (amountKes === undefined || amountKes === null || amountKes === '')) {
      return res.status(400).json({ message: 'amountKes (received amount) is required to verify a manual payment' });
    }

    const transaction = await mpesaService.verifyManualPayment(
      transactionId,
      status === 'verified',
      notes,
      req.user.id,
      amountKes,
    );
    res.json(transaction);
  } catch (error) {
    next(error);
  }
};

exports.getPendingManualPayments = async (req, res, next) => {
  try {
    const payments = await mpesaService.getPendingManualPayments();
    res.json(payments);
  } catch (error) {
    next(error);
  }
};

exports.stkPushWebhook = async (req, res, next) => {
  try {
    await mpesaService.processSTKCallback(req.body);
    return res.status(200).json({ status: 'received' });
  } catch (error) {
    // Unknown / duplicate / malformed callbacks are ACKed with 200 so Daraja
    // stops retrying a forged or stale request forever. Nothing was settled.
    const benign = ['MpesaTransaction not found', 'Invalid STK callback payload'];
    if (benign.includes(error.message)) {
      console.warn('STK Push webhook ignored:', error.message);
      return res.status(200).json({ status: 'ignored' });
    }
    // Reserve 500 for genuine transient failures (DB down, Daraja query outage).
    console.error('STK Push webhook error:', error);
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
};

exports.kycWebhook = async (req, res, next) => {
  try {
    await mpesaService.handleKYCWebhook(req, res);
  } catch (error) {
    console.error('KYC webhook error:', error);
    res.status(500).json({ message: 'KYC webhook processing failed' });
  }
};

// ── B2C payout callbacks (Phase 7) ───────────────────────────
/**
 * Payloads Daraja will keep re-sending until it gets a 200, and that no retry can fix:
 * an unmatched correlation id (stale or forged), a malformed envelope, or a "success" with
 * no receipt in it. Nothing was settled in any of those cases.
 */
const BENIGN_B2C = [
  'Invalid B2C result payload',
  'PayoutQueue row not found for this B2C result',
  'PayoutQueue row not found for this B2C timeout',
  'B2C result reported success but carried no transaction receipt',
];

/**
 * Tell the trade room how the disbursement went.
 *
 * Duplicate emits are accepted. `processB2CResult` returns the row untouched on a replay, so
 * the controller cannot tell whether *this* call caused the transition without changing the
 * service's return shape. A repeat only happens when Daraja lost our first 200, and both
 * events are idempotent for the client.
 */
const _emitPayoutOutcome = (payout) => {
  if (!payout || !['sent', 'failed'].includes(payout.status)) return;

  // `lastError` is deliberately NOT sent. It holds Daraja's own words ("The initiator
  // information is invalid.") — operator diagnostics that mean nothing to a seller and that
  // nobody in the trade room can act on. It stays on the PayoutQueue row for admins.
  emitToTrade(payout.trade.toString(), payout.status === 'sent' ? 'payout_sent' : 'payout_failed', {
    tradeId:   payout.trade.toString(),
    payoutId:  payout._id.toString(),
    status:    payout.status,
    amountKes: payout.amountKes,
    ...(payout.status === 'sent' && { transactionReceipt: payout.transactionReceipt }),
  });
};

/**
 * @desc    Daraja B2C result callback — the only thing that settles a payout.
 * @route   POST /api/mpesa/webhook/b2c-result
 * @access  Public (IP allowlist only; Daraja callbacks are unsigned)
 */
exports.b2cResultWebhook = async (req, res, next) => {
  try {
    const payout = await payoutService.processB2CResult(req.body);
    _emitPayoutOutcome(payout);
    return res.status(200).json({ status: 'received' });
  } catch (error) {
    if (BENIGN_B2C.includes(error.message)) {
      logger.warn({ err: error }, 'B2C result webhook ignored');
      return res.status(200).json({ status: 'ignored' });
    }
    // Reserve 500 for genuine transient failures (DB down mid-transaction) — those are the
    // only ones a Daraja retry can still settle.
    logger.error({ err: error }, 'B2C result webhook error');
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
};

/**
 * @desc    Daraja B2C timeout callback — the request never left their queue.
 * @route   POST /api/mpesa/webhook/b2c-timeout
 * @access  Public (IP allowlist only; Daraja callbacks are unsigned)
 */
exports.b2cTimeoutWebhook = async (req, res, next) => {
  try {
    const payout = await payoutService.processB2CTimeout(req.body);
    _emitPayoutOutcome(payout);
    return res.status(200).json({ status: 'received' });
  } catch (error) {
    if (BENIGN_B2C.includes(error.message)) {
      logger.warn({ err: error }, 'B2C timeout webhook ignored');
      return res.status(200).json({ status: 'ignored' });
    }
    logger.error({ err: error }, 'B2C timeout webhook error');
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
};
