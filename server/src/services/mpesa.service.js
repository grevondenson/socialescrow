const mongoose = require('mongoose');
const User = require('../models/User.model');
const AuditLog = require('../models/AuditLog.model');
const Trade = require('../models/Trade.model');
const MpesaTransaction = require('../models/MpesaTransaction.model');
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

const _finalizeTransaction = async (transaction, callbackData, session = null) => {
  const opts = { session };
  const metadata = callbackData?.CallbackMetadata?.Item || [];
  const receiptItem = metadata.find((item) => item.Name === 'MpesaReceiptNumber');
  const phoneItem = metadata.find((item) => item.Name === 'PhoneNumber');

  const mpesaReceiptNumber = (receiptItem && receiptItem.Value) || transaction.mpesaReceiptNumber;
  const phoneNumber = (phoneItem && phoneItem.Value) || transaction.phoneNumber;

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

const verifyManualPayment = async (transactionId, isVerified, notes, adminId) => {
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

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    transaction.status = 'confirmed';
    transaction.manualPayment.status = 'verified';
    transaction.manualPayment.verifiedAt = new Date();
    transaction.manualPayment.notes = notes;
    transaction.callbackPayload = {
      manualVerification: {
        adminId,
        notes,
        verified: true,
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

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const confirmedTransaction = await _finalizeTransaction(transaction, callback, session);
    await session.commitTransaction();
    return confirmedTransaction;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

const pollTransactionStatus = async (checkoutRequestId) => {
  const transaction = await MpesaTransaction.findOne({ checkoutRequestId });
  if (!transaction) throw new Error('MpesaTransaction not found');
  if (transaction.status !== 'pending') return transaction;

  const accessToken = await getOAuthToken();
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
  transaction.lastPolledAt = new Date();
  transaction.retryCount += 1;
  transaction.callbackPayload = result;

  if (result.ResultCode === 0) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const confirmedTransaction = await _finalizeTransaction(transaction, result, session);
      await session.commitTransaction();
      return confirmedTransaction;
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }

  if (typeof result.ResultCode === 'number' && result.ResultCode !== 0) {
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

module.exports = {
  handleKYCWebhook,
  getOAuthToken,
  triggerSTKPush,
  submitManualPayment,
  verifyManualPayment,
  getPendingManualPayments,
  processSTKCallback,
  pollTransactionStatus,
};
