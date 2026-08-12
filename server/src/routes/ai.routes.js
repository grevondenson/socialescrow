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
      model: 'claude-3.5-mini',
      max_tokens_to_sample: 1000,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;