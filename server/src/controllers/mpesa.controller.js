const mpesaService = require('../services/mpesa.service');
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
