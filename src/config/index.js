const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const config = {
  server: {
    port: parseInt(process.env.PORT || '9655', 10),
    host: process.env.HOST || '0.0.0.0',
  },
  auth: {
    path: process.env.DEEPSEEK_AUTH_PATH || './deepseek-auth.json',
    dir: process.env.DEEPSEEK_AUTH_DIR || null,
    cooldownMs: parseInt(process.env.DEEPSEEK_ACCOUNT_COOLDOWN_MS || '600000', 10),
  },
  startup: {
    nonInteractive: process.env.NON_INTERACTIVE === '1' || process.env.NON_INTERACTIVE === 'true',
    skipAccountMenu: process.env.SKIP_ACCOUNT_MENU === '1' || process.env.SKIP_ACCOUNT_MENU === 'true',
  },
  chrome: {
    path: process.env.CHROME_PATH || '',
    port: process.env.DEEPSEEK_CHROME_PORT || '',
    profile: process.env.DEEPSEEK_CHROME_PROFILE || '',
    keepProfile: process.env.DEEPSEEK_KEEP_CHROME_PROFILE === '1' || process.env.DEEPSEEK_KEEP_CHROME_PROFILE === 'true',
    reuse: process.env.DEEPSEEK_REUSE_CHROME === '1' || process.env.DEEPSEEK_REUSE_CHROME === 'true',
  },
  misc: {
    token: process.env.DEEPSEEK_TOKEN || '',
    doctorOffline: process.env.DOCTOR_OFFLINE === '1' || process.env.DOCTOR_OFFLINE === 'true',
  },
};

module.exports = config;
