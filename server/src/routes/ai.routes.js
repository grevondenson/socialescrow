const router = require('express').Router();
const { protect } = require('../middleware/auth.middleware');
const { callClaude } = require('../services/anthropic.service');

router.post('/', protect, async (req, res, next) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ message: 'prompt is required' });
    }

    const result = await callClaude({
      prompt,
      model: 'claude-haiku-4-5-20241022',
      max_tokens_to_sample: 1000,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;