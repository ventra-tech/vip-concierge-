require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const config = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
  },
  instagram: {
    pageAccessToken: process.env.INSTAGRAM_PAGE_ACCESS_TOKEN,
    verifyToken:     process.env.INSTAGRAM_VERIFY_TOKEN,
    graphApiVersion: process.env.IG_GRAPH_API_VERSION || 'v21.0',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },
};

function validateConfig() {
  const required = [
    ['ANTHROPIC_API_KEY',              config.anthropic.apiKey],
    ['INSTAGRAM_PAGE_ACCESS_TOKEN',    config.instagram.pageAccessToken],
    ['INSTAGRAM_VERIFY_TOKEN',         config.instagram.verifyToken],
  ];
  const missing = required.filter(([, val]) => !val || val.startsWith('your_'));
  if (missing.length > 0) {
    const keys = missing.map(([key]) => key).join(', ');
    console.warn(`[config] Warning: Missing env vars: ${keys}`);
  }
}

validateConfig();

module.exports = config;
