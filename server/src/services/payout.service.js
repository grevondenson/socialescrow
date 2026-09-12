const mongoose = require('mongoose');
const PayoutQueue = require('../models/PayoutQueue.model');
const Trade = require('../models/Trade.model');
const User = require('../models/User.model');
const AuditLog = require('../models/AuditLog.model');
const PlatformAccount = require('../models/PlatformAccount.model');
const walletService = require('./wallet.service');
const mpesaService = require('./mpesa.service');

/**
 * Resolved at call time rather than module load so `MPESA_ENV` can be set by tests and by a
 * config reload without re-requiring the module.
 */
const darajaBaseUrl = () => (process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke');

/**
 * Pull a named value out of the Daraja Result parameter bag.
 * Daraja sends a single object instead of an array when there is only one parameter.
 */
const _resultParam = (result, key) => {
  const params = result?.ResultParameters?.ResultParameter;
  const list = Array.isArray(params) ? params : (params ? [params] : []);
  const found = list.find((item) => item?.Key === key);
  return found ? found.Value : undefined;
};

/**
 * Locate the payout a Result/Timeout callback belongs to. `OriginatorConversationID` is ours
 * (unique index), so it is tried first; `ConversationID` is Daraja's and is the fallback.
 */
const _findPayoutFromCallback = async (result) => {
  if (result?.OriginatorConversationID) {
    const byOriginator = await PayoutQueue.findOne({
      originatorConversationId: result.OriginatorConversationID,
    });
    if (byOriginator) return byOriginator;
  }
  if (result?.ConversationID) {
    return PayoutQueue.findOne({ conversationId: result.ConversationID });
  }
  return null;
};

/** Marks a payout `failed` under a CAS and audits it. Returns null if the CAS was lost. */
const _failPayout = async (payout, lastError, payload) => {
  const failed = await PayoutQueue.findOneAndUpdate(
    { _id: payout._id, status: 'processing' },
    { $set: { status: 'failed', lastError: String(lastError).slice(0, 500), resultPayload: payload } },
    { new: true }
  );
  if (!failed) return null; // a concurrent callback already resolved this payout

  // `pendingPayout` is deliberately untouched: the seller is still owed the money and the
  // payout stays retryable. Nothing was debited, so reconciliation is unaffected.
  await AuditLog.create({
    action:   'payout_failed',
    user:     payout.seller,
    metadata: {
      tradeId:   payout.trade.toString(),
      payoutId:  payout._id.toString(),
      amountKes: payout.amountKes,
      lastError: failed.lastError,
    },
  });

  return failed;
};

/**
 * Fire the M-Pesa B2C disbursement for an approved payout.
 *
 * Order matters. Config and the seller's MSISDN are validated, and the circuit breaker is
 * checked, all **before** the status CAS — so a misconfiguration or a missing phone number
 * leaves the payout sitting at `approved`, fixable and retryable, rather than stranded in
 * `processing` with no Daraja request in flight.
 *
 * The CAS itself (`approved` → `processing`) is the double-send guard, mirroring the
 * pending→confirmed CAS in `mpesa.service._finalizeTransaction`. Two concurrent approvals
 * race for one document; the loser gets nothing back and never reaches Daraja.
 *
 * This function **never** sets `sent`. A B2C `ResponseCode: '0'` means Daraja accepted the
 * request for processing, not that the seller has been paid — only `processB2CResult` proves
 * that. The request payload contains `SecurityCredential` and is never logged.
 *
 * @param {string | mongoose.Types.ObjectId} payoutId
 * @returns {Promise<import('../models/PayoutQueue.model')>} The payout, now `processing`,
 *   carrying the Daraja correlation ids.
 */
const sendB2C = async (payoutId) => {
  const {
    MPESA_B2C_SHORTCODE,
    MPESA_INITIATOR_NAME,
    MPESA_SECURITY_CREDENTIAL,
    MPESA_B2C_RESULT_URL,
    MPESA_B2C_TIMEOUT_URL,
  } = process.env;

  if (!MPESA_B2C_SHORTCODE || !MPESA_INITIATOR_NAME || !MPESA_SECURITY_CREDENTIAL) {
    throw new Error('M-Pesa B2C credentials are not configured');
  }
  if (!MPESA_B2C_RESULT_URL || !MPESA_B2C_TIMEOUT_URL) {
    throw new Error('M-Pesa B2C callback URLs are not configured');
  }

  const existing = await PayoutQueue.findById(payoutId);
  if (!existing) {
    const err = new Error('Payout not found');
    err.statusCode = 404;
    throw err;
  }

  // Last gate before money leaves the platform. The approve endpoint checks the breaker too,
  // but a queued job can fire after it trips — and this is the only check that still holds
  // at that point. Thrown before the CAS, so the payout remains `approved` and retries once
  // the breaker clears.
  const platformAccount = await PlatformAccount.findOne({});
  if (platformAccount && platformAccount.payoutsEnabled === false) {
    const err = new Error('Seller payouts are temporarily disabled while platform integrity issues are investigated');
    err.statusCode = 503;
    throw err;
  }

  const seller = await User.findById(existing.seller).select('phone').lean();
  const msisdn = mpesaService.normalizePhone(seller?.phone || '');
  if (!msisdn || msisdn.length !== 12) {
    const err = new Error('Seller has no valid M-Pesa phone number on file');
    err.statusCode = 400;
    throw err;
  }

  const payout = await PayoutQueue.findOneAndUpdate(
    { _id: payoutId, status: 'approved' },
    { $set: { status: 'processing' }, $inc: { attempts: 1 } },
    { new: true }
  );

  if (!payout) {
    const err = new Error('Payout is not approved, or is already being processed');
    err.statusCode = 409;
    throw err;
  }

  let result;
  try {
    const accessToken = await mpesaService.getOAuthToken();

    const response = await fetch(`${darajaBaseUrl()}/mpesa/b2c/v1/paymentrequest`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        InitiatorName:      MPESA_INITIATOR_NAME,
        SecurityCredential: MPESA_SECURITY_CREDENTIAL,
        CommandID:          'BusinessPayment',
        Amount:             payout.amountKes,
        PartyA:             MPESA_B2C_SHORTCODE,
        PartyB:             msisdn,
        Remarks:            `SocialEscrow payout for trade ${payout.trade}`,
        QueueTimeOutURL:    MPESA_B2C_TIMEOUT_URL,
        ResultURL:          MPESA_B2C_RESULT_URL,
        Occasion:           `trade-${payout.trade}`,
      }),
    });

    result = await response.json();
    if (!response.ok || result.ResponseCode !== '0') {
      throw new Error(result.errorMessage || result.ResponseDescription || JSON.stringify(result));
    }
  } catch (err) {
    // Daraja never accepted the request, so no disbursement can be in flight. Drop back to
    // `failed` rather than leaving the payout stranded in `processing` — no Result callback
    // is ever coming to move it.
    await _failPayout(payout, `B2C request rejected: ${err.message}`, undefined);
    throw err;
  }

  return PayoutQueue.findByIdAndUpdate(
    payout._id,
    {
      $set: {
        originatorConversationId: result.OriginatorConversationID,
        conversationId:           result.ConversationID,
      },
    },
    { new: true }
  );
};

/**
 * Settle a B2C Result callback — the only place a payout becomes `sent` and the only place
 * `pendingPayout` drains.
 *
 * Daraja retries until it gets a 200, so every branch is idempotent: a payout that is no
 * longer `processing` is returned untouched, the processing→sent flip is a CAS inside the
 * transaction, and a duplicate `transactionReceipt` (E11000) is swallowed. Callers should ACK
 * 200 in all of those cases so Daraja stops retrying.
 *
 * @param {object} payload - The raw `{ Result: {...} }` body from Daraja.
 * @returns {Promise<import('../models/PayoutQueue.model')>}
 */
const processB2CResult = async (payload) => {
  const result = payload?.Result;
  if (!result) throw new Error('Invalid B2C result payload');

  const payout = await _findPayoutFromCallback(result);
  if (!payout) throw new Error('PayoutQueue row not found for this B2C result');

  // Already `sent`, `failed` or `cancelled` — a replay, or a race we lost. Nothing to do.
  if (payout.status !== 'processing') return payout;

  if (Number(result.ResultCode) !== 0) {
    const failed = await _failPayout(
      payout,
      `${result.ResultCode}: ${result.ResultDesc || 'B2C disbursement failed'}`,
      payload
    );
    return failed || PayoutQueue.findById(payout._id);
  }

  const receipt = _resultParam(result, 'TransactionReceipt') || result.TransactionID;
  if (!receipt) throw new Error('B2C result reported success but carried no transaction receipt');

  const session = await mongoose.startSession();
  try {
    let settled = null;

    await session.withTransaction(async () => {
      // CAS inside the transaction: only the caller that wins processing → sent goes on to
      // debit the wallet, so a replayed callback cannot double-debit even if it slips past
      // the status check above.
      settled = await PayoutQueue.findOneAndUpdate(
        { _id: payout._id, status: 'processing' },
        {
          $set: {
            status:             'sent',
            transactionReceipt: receipt,
            resultPayload:      payload,
            sentAt:             new Date(),
          },
        },
        { new: true, session }
      );
      if (!settled) return; // lost the race; commit an empty transaction and return below

      // The money has left M-Pesa — drain pendingPayout and write the WITHDRAWAL ledger entry.
      await walletService.debitPendingPayout(payout.seller, payout.amountKes, payout.trade, session);

      await Trade.findByIdAndUpdate(payout.trade, { $set: { payoutRef: receipt } }, { session });

      await AuditLog.create(
        [{
          action:   'payout_sent',
          user:     payout.seller,
          metadata: {
            tradeId:            payout.trade.toString(),
            payoutId:           payout._id.toString(),
            amountKes:          payout.amountKes,
            transactionReceipt: receipt,
          },
        }],
        { session }
      );
    });

    return settled || PayoutQueue.findById(payout._id);
  } catch (err) {
    // A duplicate receipt means this disbursement was already settled. Not an error — the
    // callback has done its job, and re-throwing would only make Daraja retry forever.
    if (err.code === 11000) return PayoutQueue.findById(payout._id);
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * Handle a B2C QueueTimeOutURL callback: Daraja never took the request off its queue, so no
 * disbursement was attempted. Marked `failed` so an admin can re-approve.
 *
 * Caveat worth knowing before building the retry path: a timeout is weaker evidence than a
 * non-zero Result code. Re-approval should be gated on a Transaction Status query (the
 * reconcile job in Step 5), not done blind — the unique `trade` index stops a second
 * PayoutQueue row, but nothing stops the same row being sent twice.
 *
 * @param {object} payload
 * @returns {Promise<import('../models/PayoutQueue.model')>}
 */
const processB2CTimeout = async (payload) => {
  const result = payload?.Result || payload;

  const payout = await _findPayoutFromCallback(result);
  if (!payout) throw new Error('PayoutQueue row not found for this B2C timeout');
  if (payout.status !== 'processing') return payout;

  const failed = await _failPayout(payout, 'B2C request timed out in the Daraja queue', payload);
  return failed || PayoutQueue.findById(payout._id);
};

// Exported as a single object so internal cross-calls resolve through the same reference the
// tests spy on — the seam `mpesa.service.js` uses for the same reason.
const payoutService = {
  sendB2C,
  processB2CResult,
  processB2CTimeout,
};

module.exports = payoutService;
