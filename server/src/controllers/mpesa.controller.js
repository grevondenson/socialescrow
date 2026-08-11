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
    res.status(201).json(transaction);
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
    const { status, notes } = req.body;
    const transactionId = req.params.id;
    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ message: "status must be 'verified' or 'rejected'" });
    }

    const transaction = await mpesaService.verifyManualPayment(transactionId, status === 'verified', notes, req.user.id);
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
    res.json({ status: 'received' });
  } catch (error) {
    console.error('STK Push webhook error:', error);
    res.status(500).json({ message: 'Webhook processing failed' });
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
