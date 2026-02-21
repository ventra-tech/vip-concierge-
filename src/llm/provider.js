/**
 * llm/provider.js
 * Thin wrapper around OpenAI API.
 * All LLM calls go through here — easy to swap models or providers later.
 */

const config = require('../config');

/**
 * Call the LLM with a messages array.
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages
 * @param {object} [options]
 * @param {number} [options.maxTokens=300]
 * @param {number} [options.temperature=0.7]
 * @returns {Promise<string>} The assistant's reply text
 */
async function callLLM(messages, options = {}) {
  const { maxTokens = 300, temperature = 0.7 } = options;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.openai.model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

module.exports = { callLLM };
