const db = require('./database');
const logger = require('./logger');

class CircuitBreaker {
  constructor() {
    this.status = 'healthy'; // 'healthy' | 'throttled' | 'cooldown'
    this.cooldownUntil = null;
    this.consecutiveErrors = 0;
    this.activeExecutions = 0;

    // Sliding window of timestamps for RPM/TPM calculation
    this.requestTimestamps = [];
    this.tokenRecords = []; // { ts, tokens }
    this.lastToolExecutionTime = 0;
  }

  getStatus() {
    const now = Date.now();
    if (this.status === 'cooldown' && this.cooldownUntil && now >= this.cooldownUntil) {
      this.status = 'healthy';
      this.cooldownUntil = null;
      this.consecutiveErrors = 0;
      logger.logBreaker('healthy', 'Periode cooldown selesai. Circuit Breaker kembali normal.');
    }

    this.cleanWindows(now);

    const rpm = this.requestTimestamps.length;
    const tpm = this.tokenRecords.reduce((acc, curr) => acc + curr.tokens, 0);

    return {
      status: this.status,
      activeExecutions: this.activeExecutions,
      consecutiveErrors: this.consecutiveErrors,
      cooldownRemainingSec: this.cooldownUntil ? Math.max(0, Math.ceil((this.cooldownUntil - now) / 1000)) : 0,
      currentRpm: rpm,
      currentTpm: tpm
    };
  }

  cleanWindows(now = Date.now()) {
    const oneMinuteAgo = now - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
    this.tokenRecords = this.tokenRecords.filter(rec => rec.ts > oneMinuteAgo);
  }

  /**
   * Check if a new task or tool call is permitted to execute
   */
  canExecute() {
    const now = Date.now();
    const settings = db.getSettings();

    // Check cooldown
    if (this.status === 'cooldown') {
      if (this.cooldownUntil && now < this.cooldownUntil) {
        const remaining = Math.ceil((this.cooldownUntil - now) / 1000);
        return {
          allowed: false,
          reason: `Circuit Breaker aktif (Cooldown). Tunggu ${remaining} detik agar akun Google aman dari ban.`,
          remainingSec: remaining
        };
      }
      // Cooldown expired
      this.status = 'healthy';
      this.cooldownUntil = null;
      this.consecutiveErrors = 0;
    }

    // Check concurrency
    const maxConcurrency = settings.concurrency_limit || 1;
    if (this.activeExecutions >= maxConcurrency) {
      return {
        allowed: false,
        reason: `Sedang memproses antrean lain (Concurrency limit: ${maxConcurrency}). Pesan masuk antrean.`,
        isQueued: true
      };
    }

    return { allowed: true };
  }

  acquireExecution() {
    this.activeExecutions += 1;
    this.requestTimestamps.push(Date.now());
  }

  releaseExecution() {
    this.activeExecutions = Math.max(0, this.activeExecutions - 1);
  }

  /**
   * Human Pacing Delay: enforce a natural pause between tool executions
   */
  async enforcePacingDelay() {
    const settings = db.getSettings();
    const pacingMs = settings.pacing_ms || 2000;
    const now = Date.now();
    const timeSinceLastTool = now - this.lastToolExecutionTime;

    if (timeSinceLastTool < pacingMs) {
      const waitTime = pacingMs - timeSinceLastTool;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    this.lastToolExecutionTime = Date.now();
  }

  /**
   * Record successful turn or request
   */
  recordSuccess(tokens = 0) {
    this.consecutiveErrors = 0;
    if (this.status === 'throttled') {
      this.status = 'healthy';
    }
    const now = Date.now();
    if (tokens > 0) {
      this.tokenRecords.push({ ts: now, tokens });
    }
    db.recordRequest(true, tokens, false);
  }

  /**
   * Handle error responses (detect 429, 403, quota exhaustion)
   */
  recordFailure(error, customCooldownSec = null) {
    this.consecutiveErrors += 1;
    const settings = db.getSettings();
    const defaultCooldown = customCooldownSec || settings.circuit_breaker_cooldown_sec || 300;
    const errMsg = String(error.message || error).toLowerCase();

    // Check if error is rate limit or auth violation
    const isRateLimit = errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('resource_exhausted');
    const isForbidden = errMsg.includes('403') || errMsg.includes('forbidden') || errMsg.includes('permission_denied');

    db.recordRequest(false, 0, isRateLimit || isForbidden);

    if (isRateLimit || isForbidden || this.consecutiveErrors >= 3) {
      this.status = 'cooldown';
      this.cooldownUntil = Date.now() + (defaultCooldown * 1000);
      const reason = isForbidden
        ? `Terdeteksi 403 Forbidden! Akun di-cooldown selama ${defaultCooldown} detik untuk mencegah ban permanen.`
        : (isRateLimit
            ? `Terdeteksi 429 Rate Limit! Melakukan cooling down selama ${defaultCooldown} detik.`
            : `Terdeteksi ${this.consecutiveErrors} error berturut-turut. Mengaktifkan perlindungan.`);

      logger.logBreaker('cooldown', reason, defaultCooldown);
      return { tripped: true, reason, cooldownSec: defaultCooldown };
    }

    return { tripped: false, reason: errMsg };
  }

  resetBreaker() {
    this.status = 'healthy';
    this.cooldownUntil = null;
    this.consecutiveErrors = 0;
    logger.logBreaker('healthy', 'Circuit Breaker direset secara manual oleh pengguna.');
  }
}

module.exports = new CircuitBreaker();
