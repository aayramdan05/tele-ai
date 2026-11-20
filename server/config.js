require('dotenv').config();
const db = require('./database');

const config = {
  get(key) {
    const settings = db.getSettings();
    if (key in settings) {
      return settings[key];
    }
    return process.env[key.toUpperCase()] || null;
  },

  getAll() {
    const settings = db.getSettings();
    // Do not leak sensitive secrets in plaintext over public endpoints if needed, but for dashboard admin we allow viewing/editing
    return {
      ...settings,
      port: process.env.PORT || settings.web_port || 3000
    };
  },

  update(updates) {
    return db.updateSettings(updates);
  }
};

module.exports = config;
