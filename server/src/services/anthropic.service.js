const getBaseUrl = () => {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  if (!baseUrl) {
    throw new Error('ANTHROPIC_BASE_URL is not set');
  }
  return baseUrl.replace(/\/+$/, '');
};

const getAuthHeaders = () => {
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!authToken && !apiKey) {
    throw new Error('ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY must be set');
  }

  const headers = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  return headers;
};

const callClaude = async (payload, path = '/v1/messages') => {
  const url = `${getBaseUrl()}${path}`;
  
  // Transform payload to Messages API format
  const messagesPayload = {
    model: payload.model || 'claude-haiku-4-5-20241022',
    max_tokens: payload.max_tokens_to_sample || 1000,
    messages: [
      {
        role: 'user',
        content: payload.prompt
      }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(messagesPayload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Claude request failed: ${response.status} ${text}`);
  }

  const data = JSON.parse(text);
  
  // Extract text from Messages API response format
  return {
    completion: data.content?.[0]?.text || '',
    stop_reason: data.stop_reason,
  };
};

module.exports = { callClaude };