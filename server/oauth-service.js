const { execSync } = require('child_process');
const db = require('./database');
const logger = require('./logger');

// Built-in public desktop client credentials (used standardly by CLI tools so users never need their own GCP project)
const DEFAULT_CLIENT_ID = '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com';
const DEFAULT_CLIENT_SECRET = 'd-FL95Q19q7MQmFpd7hHD0Ty';

class OAuthService {
  constructor() {
    this.cachedAgyStatus = null;
    this.lastAgyCheck = 0;
    this.currentAccountIndex = 0;
  }

  getClientCredentials() {
    const settings = db.getSettings();
    return {
      clientId: settings.google_client_id || DEFAULT_CLIENT_ID,
      clientSecret: settings.google_client_secret || DEFAULT_CLIENT_SECRET
    };
  }

  /**
   * Check if agy (Antigravity CLI) is installed and authenticated
   */
  checkAgyAuth(force = false) {
    const now = Date.now();
    if (!force && this.cachedAgyStatus && (now - this.lastAgyCheck < 60000)) {
      return this.cachedAgyStatus;
    }

    try {
      let cmd = 'agy';
      if (process.platform === 'win32') {
        const path = require('path');
        const fs = require('fs');
        const candidates = [
          path.join(process.env.LOCALAPPDATA || 'C:\\Users\\AAY\\AppData\\Local', 'agy', 'bin', 'agy.exe'),
          path.join(process.env.USERPROFILE || 'C:\\Users\\AAY', '.gemini', 'antigravity', 'bin', 'agy.exe'),
          'C:\\Users\\AAY\\AppData\\Local\\agy\\bin\\agy.exe'
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            cmd = `"${c}"`;
            break;
          }
        }
      }

      const output = execSync(`${cmd} models`, { encoding: 'utf8', timeout: 8000 });
      const hasModels = output.includes('gemini') || output.includes('claude');

      this.cachedAgyStatus = {
        available: true,
        authenticated: hasModels,
        command: cmd,
        details: hasModels ? 'Antigravity CLI (agy) aktif dan terautentikasi' : 'agy terinstall tapi belum login',
        models: output.split('\n').filter(l => l.trim().length > 0).slice(0, 8)
      };
    } catch (err) {
      this.cachedAgyStatus = {
        available: false,
        authenticated: false,
        command: 'agy',
        details: `agy CLI tidak ditemukan: ${err.message}`,
        models: []
      };
    }

    this.lastAgyCheck = now;
    return this.cachedAgyStatus;
  }

  /**
   * Generate Google OAuth 2.0 Authorization URL
   * No manual Client ID required: uses built-in default if not set!
   */
  getGoogleAuthUrl(redirectUri) {
    const { clientId } = this.getClientCredentials();
    const settings = db.getSettings();

    // Default built-in desktop client uses cloud-platform which is recognized by Google without invalid_scope error
    let scopeStr = 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email openid';
    if (settings.google_client_id && settings.google_client_id.trim()) {
      scopeStr = 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email openid';
    }

    const scope = encodeURIComponent(scopeStr);
    const redirect = encodeURIComponent(redirectUri);

    // prompt=select_account allows easily logging in to Account 1, then Account 2, then Account 3!
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirect}&response_type=code&scope=${scope}&access_type=offline&prompt=select_account%20consent`;
  }

  /**
   * Exchange OAuth Code for Tokens and add/update in Multi-Account Pool
   */
  async handleGoogleCallback(code, redirectUri) {
    const { clientId, clientSecret } = this.getClientCredentials();
    const tokenUrl = 'https://oauth2.googleapis.com/token';

    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gagal menukar token Google: ${response.status} - ${errText}`);
    }

    const tokenData = await response.json();
    const expiryDate = Date.now() + (tokenData.expires_in * 1000);

    // Get user info email
    let userEmail = `user-${Date.now()}@google.com`;
    try {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (userRes.ok) {
        const userInfo = await userRes.json();
        userEmail = userInfo.email || userEmail;
      }
    } catch (e) {}

    // Add or Update in Multi-Account Pool
    const settings = db.getSettings();
    const accounts = Array.isArray(settings.google_accounts) ? [...settings.google_accounts] : [];

    const existingIndex = accounts.findIndex(a => a.email.toLowerCase() === userEmail.toLowerCase());
    const accountEntry = {
      id: existingIndex >= 0 ? accounts[existingIndex].id : `acc-${Date.now()}`,
      email: userEmail,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || (existingIndex >= 0 ? accounts[existingIndex].refresh_token : null),
      expiry_date: expiryDate,
      status: 'healthy',
      cooldown_until: 0,
      tokens_today: existingIndex >= 0 ? (accounts[existingIndex].tokens_today || 0) : 0,
      added_at: existingIndex >= 0 ? accounts[existingIndex].added_at : new Date().toISOString()
    };

    if (existingIndex >= 0) {
      accounts[existingIndex] = accountEntry;
    } else {
      accounts.push(accountEntry);
    }

    db.updateSettings({
      google_accounts: accounts,
      google_tokens: accountEntry // also set legacy field for compatibility
    });

    logger.logInfo('Akun Google Berhasil Dihubungkan ke Pool', `${userEmail} (Total Akun: ${accounts.length})`);
    return accountEntry;
  }

  /**
   * Get Next Available Healthy Token from Multi-Account Pool (Load-Balanced / Failover)
   */
  async getNextAvailableAccountToken() {
    const settings = db.getSettings();
    const accounts = Array.isArray(settings.google_accounts) ? settings.google_accounts : [];

    if (accounts.length === 0) {
      // Check legacy single account fallback
      if (settings.google_tokens && settings.google_tokens.refresh_token) {
        return {
          email: settings.google_tokens.email || 'Legacy Account',
          token: await this.refreshAccountToken(settings.google_tokens)
        };
      }
      throw new Error('Belum ada akun Google terhubung di Pool. Silakan klik "Tambah Akun Google" di Web UI.');
    }

    const now = Date.now();
    // Filter healthy accounts (not in cooldown)
    const availableAccounts = accounts.filter(a => !a.cooldown_until || a.cooldown_until <= now);

    if (availableAccounts.length === 0) {
      // Find the one with nearest cooldown expiry
      const sorted = [...accounts].sort((a, b) => (a.cooldown_until || 0) - (b.cooldown_until || 0));
      const nearest = sorted[0];
      const waitSec = Math.ceil(((nearest.cooldown_until || now) - now) / 1000);
      throw new Error(`Semua ${accounts.length} akun Google sedang dalam masa cooldown. Silakan tunggu ${waitSec} detik.`);
    }

    // Round-robin selection
    this.currentAccountIndex = (this.currentAccountIndex + 1) % availableAccounts.length;
    const selectedAccount = availableAccounts[this.currentAccountIndex];

    const token = await this.refreshAccountToken(selectedAccount);
    return {
      email: selectedAccount.email,
      token,
      accountIndex: this.currentAccountIndex + 1,
      totalAccounts: accounts.length
    };
  }

  /**
   * Refresh a specific account's token if expired
   */
  async refreshAccountToken(account) {
    if (account.access_token && account.expiry_date && (account.expiry_date - Date.now() > 60000)) {
      return account.access_token;
    }

    const { clientId, clientSecret } = this.getClientCredentials();
    const tokenUrl = 'https://oauth2.googleapis.com/token';

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refresh_token,
      grant_type: 'refresh_token'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gagal refresh token akun ${account.email}: ${errText}`);
    }

    const refreshed = await response.json();
    account.access_token = refreshed.access_token;
    account.expiry_date = Date.now() + (refreshed.expires_in * 1000);

    // Save updated account back to DB
    const settings = db.getSettings();
    const accounts = (settings.google_accounts || []).map(a => a.email === account.email ? account : a);
    db.updateSettings({ google_accounts: accounts });

    return account.access_token;
  }

  /**
   * Put an account in temporary cooldown (e.g. if it hits 429) so other accounts take over
   */
  cooldownAccount(email, cooldownSec = 300) {
    const settings = db.getSettings();
    const accounts = (settings.google_accounts || []).map(a => {
      if (a.email.toLowerCase() === email.toLowerCase()) {
        return {
          ...a,
          status: 'cooldown',
          cooldown_until: Date.now() + (cooldownSec * 1000)
        };
      }
      return a;
    });
    db.updateSettings({ google_accounts: accounts });
    logger.logInfo(`Akun ${email} Masuk Cooldown`, `Beralih ke akun lain di pool (${cooldownSec}s)`);
  }

  /**
   * Delete account from pool
   */
  removeAccount(email) {
    const settings = db.getSettings();
    const accounts = (settings.google_accounts || []).filter(a => a.email.toLowerCase() !== email.toLowerCase());
    db.updateSettings({ google_accounts: accounts });
    logger.logInfo(`Akun Dihapus dari Pool`, email);
    return accounts;
  }

  /**
   * Overall Auth Status Summary
   */
  getAuthStatus() {
    const settings = db.getSettings();
    const agyStatus = this.checkAgyAuth();
    const accounts = Array.isArray(settings.google_accounts) ? settings.google_accounts : [];
    const hasApiKey = Boolean(settings.gemini_api_key && settings.gemini_api_key.trim().length > 0);

    const now = Date.now();
    const formattedAccounts = accounts.map(a => ({
      id: a.id,
      email: a.email,
      status: (!a.cooldown_until || a.cooldown_until <= now) ? 'healthy' : 'cooldown',
      cooldownRemainingSec: Math.max(0, Math.ceil(((a.cooldown_until || 0) - now) / 1000)),
      tokensToday: a.tokens_today || 0,
      addedAt: a.added_at
    }));

    return {
      active_engine: settings.active_engine,
      active_model: settings.active_model,
      agy: agyStatus,
      google_accounts_pool: {
        total_accounts: accounts.length,
        accounts: formattedAccounts,
        has_custom_credentials: Boolean(settings.google_client_id)
      },
      gemini_api: {
        configured: hasApiKey
      }
    };
  }
}

module.exports = new OAuthService();
