require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },
  manyChat: {
    apiKey: process.env.MANYCHAT_API_KEY,
    pageId: process.env.MANYCHAT_PAGE_ID,
    apiBase: 'https://api.manychat.com',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },
};

function validateConfig() {
  const required = [
    ['OPENAI_API_KEY', config.openai.apiKey],
    ['MANYCHAT_API_KEY', config.manyChat.apiKey],
    ['MANYCHAT_PAGE_ID', config.manyChat.pageId],
  ];
  const missing = required.filter(([, val]) => !val || val.startsWith('your_'));
  if (missing.length > 0) {
    const keys = missing.map(([key]) => key).join(', ');
    console.warn(`[config] Warning: Missing env vars: ${keys}`);
  }
}

validateConfig();

module.exports = config;
