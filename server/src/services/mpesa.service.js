const mongoose = require('mongoose');
const User = require('../models/User.model');
const AuditLog = require('../models/AuditLog.model');
const Trade = require('../models/Trade.model');
const MpesaTransaction = require('../models/MpesaTransaction.model');
const FraudFlag = require('../models/FraudFlag.model');
const walletService = require('./wallet.service');
const escrowService = require('./escrow.service');

const MPESA_BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

const {
  MPESA_SHORTCODE,
  MPESA_PASSKEY,
  MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET,
  MPESA_CALLBACK_URL,
} = process.env;

let cachedToken = null;
let cachedTokenExpiresAt = 0;

const normalizePhone = (phone) => {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('07') && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.startsWith('7') && digits.length === 9) return `254${digits}`;
  if (digits.startsWith('+254') && digits.length === 13) return digits.slice(1);
  return digits;
};

const getOAuthToken = async () => {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  if (!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET) {
    throw new Error('M-Pesa credentials are not configured');
  }

  const basicAuth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
  const response = await fetch(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basicAuth}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`M-Pesa token request failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  const expiresIn = Number(data.expires_in) || 3600;
  cachedTokenExpiresAt = Date.now() + Math.max(30000, (expiresIn - 60) * 1000);
  return cachedToken;
};

const buildStkPassword = () => {
  if (!MPESA_SHORTCODE || !MPESA_PASSKEY) {
    throw new Error('M-Pesa shortcode and passkey are not configured');
  }

  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');
  return { password, timestamp };
};

const triggerSTKPush = async (phoneNumber, tradeId, userId) => {
  const normalizedPhone = normalizePhone(phoneNumber);
  if (!normalizedPhone) throw new Error('A valid phone number is required for STK Push');

  const trade = await Trade.findById(tradeId);
  if (!trade) throw new Error('Trade not found');
  if (trade.status !== 'payment_window') throw new Error('Trade must be in payment window to initiate payment');
  if (trade.buyer.toString() !== userId.toString()) throw new Error('Not authorized to initiate payment for this trade');
  if (!MPESA_CALLBACK_URL) throw new Error('M-Pesa callback URL is not configured');

  const amountKes = trade.amountKes;
  const accessToken = await getOAuthToken();
  const { password, timestamp } = buildStkPassword();

  const payload = {
    BusinessShortCode: MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amountKes,
    PartyA: normalizedPhone,
    PartyB: MPESA_SHORTCODE,
    PhoneNumber: normalizedPhone,
    CallBackURL: MPESA_CALLBACK_URL,
    AccountReference: `SocialEscrow-${tradeId}`,
    TransactionDesc: `Escrow payment for trade ${tradeId}`,
  };

  const response = await fetch(`${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();
  if (!response.ok || result.ResponseCode !== '0') {
    const errorMessage = result.errorMessage || result.ResponseDescription || JSON.stringify(result);
    throw new Error(`M-Pesa STK Push failed: ${errorMessage}`);
  }

  const transaction = await MpesaTransaction.create({
    trade: trade._id,
    user: trade.buyer,
    checkoutRequestId: result.CheckoutRequestID,
    merchantRequestId: result.MerchantRequestID,
    amountKes: trade.amountKes,
    phoneNumber: normalizedPhone,
  });

  return transaction;
};

const _settleConfirmedPayment = async (transaction, session = null) => {
  const trade = await Trade.findById(transaction.trade).session(session);
  if (!trade) throw new Error('Trade not found');
  if (trade.status !== 'payment_window') {
    return transaction;
  }

  await walletService.credit(
    trade.buyer,
    trade.amountKes,
    'DEPOSIT',
    { tradeId: trade._id, note: transaction.manualPayment?.status === 'verified' ? 'Manual payment verified deposit' : 'M-Pesa STK Push deposit' },
    session
  );

  await escrowService.lock(trade._id.toString(), session);

  await Trade.findByIdAndUpdate(
    trade._id,
    {
      $set: {
        status: 'paid',
        mpesaRef: transaction.mpesaReceiptNumber || transaction.manualPayment?.referenceCode,
      }
    },
    { new: true, session }
  );

  return transaction;
};

const _flagPaymentFraud = async (transaction, note, session = null) => {
  console.warn(`M-Pesa fraud guard: ${note} (txn ${transaction._id})`);
  const doc = {
    user: transaction.user,
    trade: transaction.trade,
    flagType: 'WEBHOOK_MISMATCH',
    riskScore: 90,
    riskLevel: 'high',
    note,
  };
  // Inside a Mongo transaction, create() must use the array form so it joins the session.
  if (session) {
    await FraudFlag.create([doc], { session });
  } else {
    await FraudFlag.create(doc);
  }
};

const _finalizeTransaction = async (transaction, callbackData, session = null) => {
  const opts = { session };
  const metadata = callbackData?.CallbackMetadata?.Item || [];
  const receiptItem = metadata.find((item) => item.Name === 'MpesaReceiptNumber');
  const phoneItem = metadata.find((item) => item.Name === 'PhoneNumber');
  const amountItem = metadata.find((item) => item.Name === 'Amount');

  const mpesaReceiptNumber = (receiptItem && receiptItem.Value) || transaction.mpesaReceiptNumber;
  const phoneNumber = (phoneItem && phoneItem.Value) || transaction.phoneNumber;

  // Amount validation — only when the callback body carries an Amount.
  // The STK Query response has no Amount item, so the poller path skips this
  // (that path is fully server-initiated against our own checkoutRequestId, so
  // the paid amount is implicitly the requested trade amount).
  if (amountItem && amountItem.Value !== undefined && amountItem.Value !== null) {
    const trade = await Trade.findById(transaction.trade).session(session);
    if (!trade) throw new Error('Trade not found');

    if (Number(amountItem.Value) !== Number(trade.amountKes)) {
      // Do NOT throw: mark failed + flag and let the caller COMMIT, so the
      // failed status and FraudFlag persist rather than being rolled back.
      const failed = await MpesaTransaction.findOneAndUpdate(
        { _id: transaction._id, status: 'pending' },
        { status: 'failed', callbackPayload: callbackData, lastPolledAt: new Date() },
        { new: true, ...opts }
      ).session(session);

      await _flagPaymentFraud(
        transaction,
        `Callback amount ${amountItem.Value} != trade amount ${trade.amountKes}; possible forged/altered callback`,
        session,
      );
      return failed || transaction;
    }
  }

  // Confirm CAS. The unique index on mpesaReceiptNumber is the hard replay
  // backstop: a second callback carrying an already-used receipt raises E11000
  // here, which the callers interpret as "already processed" (no double credit).
  const updatedTransaction = await MpesaTransaction.findOneAndUpdate(
    { _id: transaction._id, status: 'pending' },
    {
      status: 'confirmed',
      mpesaReceiptNumber,
      phoneNumber,
      callbackPayload: callbackData,
      lastPolledAt: new Date(),
    },
    { new: true, ...opts }
  ).session(session);

  if (!updatedTransaction) {
    // Lost the pending→confirmed CAS race to a concurrent caller; already handled.
    return transaction;
  }

  await _settleConfirmedPayment(updatedTransaction, session);
  return updatedTransaction;
};

const submitManualPayment = async (tradeId, referenceCode, userId, phoneNumber = '') => {
  const trade = await Trade.findById(tradeId);
  if (!trade) throw new Error('Trade not found');
  if (trade.status !== 'payment_window') throw new Error('Trade must be in payment window to submit a manual payment');
  if (trade.buyer.toString() !== userId.toString()) throw new Error('Not authorized to submit manual payment for this trade');

  const existingConfirmed = await MpesaTransaction.findOne({ trade: tradeId, status: 'confirmed' });
  if (existingConfirmed) throw new Error('A payment has already been confirmed for this trade');

  const existingPending = await MpesaTransaction.findOne({ trade: tradeId, status: 'pending', 'manualPayment.status': { $in: ['submitted','pending'] } });
  if (existingPending) throw new Error('A manual payment request is already pending for this trade');

  const transaction = await MpesaTransaction.create({
    trade: trade._id,
    user: trade.buyer,
    amountKes: trade.amountKes,
    phoneNumber,
    manualPayment: {
      referenceCode,
      status: 'submitted',
      submittedAt: new Date(),
    },
  });

  return transaction;
};

const getPendingManualPayments = async () => {
  return MpesaTransaction.find({
    'manualPayment.status': 'submitted',
    status: 'pending',
  })
    .populate('trade', 'listing buyer seller amountKes status')
    .populate('user', 'name email');
};

const verifyManualPayment = async (transactionId, isVerified, notes, adminId, amountKes) => {
  const transaction = await MpesaTransaction.findById(transactionId);
  if (!transaction) throw new Error('MpesaTransaction not found');
  if (!transaction.manualPayment || transaction.manualPayment.status !== 'submitted') {
    throw new Error('Manual payment is not pending verification');
  }
  if (transaction.status !== 'pending') {
    throw new Error('Transaction is not in a pending state');
  }

  if (!isVerified) {
    transaction.status = 'failed';
    transaction.manualPayment.status = 'rejected';
    transaction.manualPayment.notes = notes;
    transaction.callbackPayload = {
      manualVerification: {
        adminId,
        notes,
        verified: false,
        verifiedAt: new Date(),
      }
    };
    await transaction.save();
    return transaction;
  }

  // Verifying: the admin must supply the amount they actually received, and it
  // must equal the trade amount. Manual payments carry no amount otherwise, so
  // this is the only amount check on the manual path.
  const trade = await Trade.findById(transaction.trade);
  if (!trade) throw new Error('Trade not found');

  const observedAmount = Number(amountKes);
  if (!Number.isFinite(observedAmount) || observedAmount <= 0) {
    const err = new Error('A valid received amount (amountKes) is required to verify a manual payment');
    err.statusCode = 400;
    throw err;
  }

  if (observedAmount !== Number(trade.amountKes)) {
    transaction.status = 'failed';
    transaction.manualPayment.status = 'rejected';
    transaction.manualPayment.amountKes = observedAmount;
    transaction.manualPayment.notes = notes;
    transaction.callbackPayload = {
      manualVerification: {
        adminId,
        notes,
        verified: false,
        amountKes: observedAmount,
        reason: 'amount_mismatch',
        verifiedAt: new Date(),
      }
    };
    await transaction.save();
    await _flagPaymentFraud(
      transaction,
      `Manual payment amount ${observedAmount} != trade amount ${trade.amountKes}`,
    );
    const err = new Error(`Received amount ${observedAmount} does not match trade amount ${trade.amountKes}`);
    err.statusCode = 400;
    throw err;
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    transaction.status = 'confirmed';
    transaction.manualPayment.status = 'verified';
    transaction.manualPayment.verifiedAt = new Date();
    transaction.manualPayment.amountKes = observedAmount;
    transaction.manualPayment.notes = notes;
    transaction.callbackPayload = {
      manualVerification: {
        adminId,
        notes,
        verified: true,
        amountKes: observedAmount,
        verifiedAt: new Date(),
      }
    };
    transaction.lastPolledAt = new Date();

    await transaction.save({ session });
    await _settleConfirmedPayment(transaction, session);

    await session.commitTransaction();
    return transaction;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

const _getTransactionFromCallback = async (payload) => {
  const callback = payload?.Body?.stkCallback;
  const checkoutRequestId = callback?.CheckoutRequestID;
  const merchantRequestId = callback?.MerchantRequestID;

  if (!checkoutRequestId && !merchantRequestId) {
    throw new Error('Invalid STK callback payload');
  }

  return MpesaTransaction.findOne({
    $or: [
      { checkoutRequestId },
      { merchantRequestId },
    ],
  });
};

const processSTKCallback = async (payload) => {
  const callback = payload?.Body?.stkCallback;
  if (!callback) throw new Error('Invalid STK callback payload');

  const transaction = await _getTransactionFromCallback(payload);
  if (!transaction) throw new Error('MpesaTransaction not found');
  if (transaction.status !== 'pending') return transaction;

  const resultCode = callback.ResultCode;
  if (resultCode !== 0) {
    transaction.status = 'failed';
    transaction.callbackPayload = payload;
    transaction.lastPolledAt = new Date();
    await transaction.save();
    return transaction;
  }

  // Anti-forgery gate: Daraja callbacks are unsigned, so before settling we
  // independently ask Daraja (STK Query) whether THIS checkoutRequestId really
  // succeeded. A fabricated callback cannot make the query return success.
  // Gate-only: the query carries no amount/receipt — those come from the callback body.
  const requireConfirm = String(process.env.MPESA_REQUIRE_QUERY_CONFIRM ?? 'true') !== 'false';
  if (requireConfirm) {
    if (!transaction.checkoutRequestId) {
      await _flagPaymentFraud(transaction, 'STK callback for a transaction with no checkoutRequestId to confirm');
      return transaction;
    }
    const { resultCode: queryResultCode } = await mpesaService.queryStkStatus(transaction.checkoutRequestId);
    if (Number(queryResultCode) !== 0) {
      await _flagPaymentFraud(transaction, `STK Query did not confirm success (ResultCode ${queryResultCode}); possible forged callback`);
      return transaction; // leave pending, do not settle
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const confirmedTransaction = await _finalizeTransaction(transaction, callback, session);
    await session.commitTransaction();
    return confirmedTransaction;
  } catch (err) {
    await session.abortTransaction();
    // A duplicate receipt (or escrow) key means this payment was already
    // settled — treat as processed, don't double-credit, don't error.
    if (err.code === 11000) return transaction;
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * Pure Daraja STK-Query. Confirms whether a checkoutRequestId succeeded; performs
 * NO settlement. The query response carries only a ResultCode (no amount/receipt).
 * @returns {Promise<{ resultCode: number|string|undefined, raw: object }>}
 */
const queryStkStatus = async (checkoutRequestId) => {
  const accessToken = await mpesaService.getOAuthToken();
  const { password, timestamp } = buildStkPassword();
  const payload = {
    BusinessShortCode: MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };

  const response = await fetch(`${MPESA_BASE_URL}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();
  return { resultCode: result.ResultCode, raw: result };
};

const pollTransactionStatus = async (checkoutRequestId) => {
  const transaction = await MpesaTransaction.findOne({ checkoutRequestId });
  if (!transaction) throw new Error('MpesaTransaction not found');
  if (transaction.status !== 'pending') return transaction;

  const { resultCode, raw } = await mpesaService.queryStkStatus(checkoutRequestId);
  transaction.lastPolledAt = new Date();
  transaction.retryCount += 1;
  transaction.callbackPayload = raw;

  if (resultCode === 0) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const confirmedTransaction = await _finalizeTransaction(transaction, raw, session);
      await session.commitTransaction();
      return confirmedTransaction;
    } catch (err) {
      await session.abortTransaction();
      if (err.code === 11000) return transaction;
      throw err;
    } finally {
      session.endSession();
    }
  }

  if (typeof resultCode === 'number' && resultCode !== 0) {
    transaction.status = 'failed';
    await transaction.save();
    return transaction;
  }

  await transaction.save();
  return transaction;
};

const normalizeName = (name = '') => {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim();
};

const nameSimilarity = (a, b) => {
  const normalize = (value) => normalizeName(value).split(/\s+/).filter(Boolean);
  const tokensA = normalize(a);
  const tokensB = normalize(b);
  if (!tokensA.length || !tokensB.length) return 0;

  const matchCount = tokensA.filter((token) => tokensB.includes(token)).length;
  return matchCount / Math.max(tokensA.length, tokensB.length);
};

const handleKYCWebhook = async (req, res) => {
  try {
    const { MSISDN, FirstName, LastName, kycStatus, kycData } = req.body;

    if (!MSISDN || !kycStatus) {
      return res.status(400).json({ message: 'MSISDN and kycStatus required' });
    }

    const user = await User.findOne({ kycPhone: MSISDN });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const remoteName = `${FirstName || ''} ${LastName || ''}`.trim();
    const localName = user.kycName || user.fullName || '';
    const nameScore = nameSimilarity(localName, remoteName);

    if (kycStatus === 'verified') {
      user.kycVerified = true;
      user.kycVerifiedAt = new Date();
      user.kycVerificationMeta = {
        remoteName,
        nameScore,
        rawKycData: kycData,
      };

      if (nameScore < 0.5) {
        user.kycVerified = false;
        user.kycReviewRequired = true;
        await user.save();

        await AuditLog.create({
          action: 'kyc_name_mismatch',
          userId: user._id,
          metadata: {
            MSISDN,
            remoteName,
            localName,
            nameScore,
            reason: 'Name similarity below threshold',
            kycData,
          },
        });

        return res.status(200).json({
          message: 'KYC verified, but name mismatch requires manual review',
          reviewRequired: true,
          nameScore,
        });
      }

      await user.save();

      await AuditLog.create({
        action: 'kyc_verified',
        userId: user._id,
        metadata: { MSISDN, remoteName, localName, nameScore, kycData },
      });

      res.json({
        message: 'KYC verified successfully',
        kycData,
        nameScore,
      });
    } else if (kycStatus === 'rejected') {
      user.kycVerified = false;
      user.kycReviewRequired = true;
      user.kycVerificationMeta = {
        remoteName,
        nameScore,
        rawKycData: kycData,
      };
      await user.save();

      await AuditLog.create({
        action: 'kyc_mismatch',
        userId: user._id,
        metadata: { MSISDN, remoteName, localName, nameScore, reason: kycData?.reason, kycData },
      });

      res.status(400).json({
        message: 'KYC verification failed',
        reason: kycData?.reason,
        reviewRequired: true,
        nameScore,
      });
    } else {
      res.json({
        message: 'KYC status pending',
        status: kycStatus,
        nameScore,
      });
    }
  } catch (err) {
    console.error('KYC webhook error:', err);
    res.status(500).json({ message: 'KYC webhook processing failed' });
  }
};

// Exported as a single object so internal cross-calls (processSTKCallback →
// queryStkStatus, queryStkStatus → getOAuthToken) go through the same reference
// the tests spy on. Referencing `mpesaService` inside the functions is safe:
// they only run after this module has finished loading.
const mpesaService = {
  handleKYCWebhook,
  getOAuthToken,
  triggerSTKPush,
  submitManualPayment,
  verifyManualPayment,
  getPendingManualPayments,
  processSTKCallback,
  pollTransactionStatus,
  queryStkStatus,
};

module.exports = mpesaService;
