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

const callClaude = async (payload, path = '/v1/complete') => {
  const url = `${getBaseUrl()}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Claude request failed: ${response.status} ${text}`);
  }

  return JSON.parse(text);
};

module.exports = { callClaude };