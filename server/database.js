const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

// Default initial state
const DEFAULT_DATA = {
  settings: {
    telegram_bot_token: '',
    allowed_chat_ids: [],
    active_engine: 'agy', // 'agy' | 'gemini_oauth' | 'gemini_api'
    active_model: 'gemini-3.8-flash-high',
    gemini_api_key: '',
    google_client_id: '',
    google_client_secret: '',
    google_tokens: null, // Legacy single account
    google_accounts: [], // Multi-account pool: [ { id, email, access_token, refresh_token, expiry_date, status, tokens_today } ]
    concurrency_limit: 1,
    pacing_ms: 2000,
    max_turns_per_prompt: 15,
    circuit_breaker_cooldown_sec: 300,
    web_port: 3000,
    admin_password: 'admin'
  },
  metrics: {
    total_requests: 0,
    successful_requests: 0,
    failed_requests: 0,
    breaker_trips: 0,
    total_tokens_estimated: 0,
    today_tokens: 0,
    today_date: new Date().toISOString().slice(0, 10),
    rpm_history: [],
    tpm_history: [],
    hourly_distribution: Array(24).fill(0)
  },
  flow_logs: [],
  cron_jobs: [
    {
      id: 'cron-default-clipper',
      name: 'FB Reels Auto Clipper (Contoh)',
      schedule: '0 */4 * * *', // Setiap 4 jam
      prompt: 'Jalankan scripts/clipper-helper.py untuk mencari 1 video podcast terbaru, jadikan Reels 16:9 dengan judul atas-bawah dan subtitle, lalu kirim ke Telegram.',
      enabled: false,
      last_run: null,
      status: 'idle'
    }
  ],
  task_history: []
};

class Database {
  constructor() {
    this.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    this.isDirty = false;
    this.saveTimeout = null;
    this.load();
  }

  load() {
    try {
      const dataDir = path.dirname(DB_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        // Deep merge with defaults to ensure all keys exist
        this.data = {
          settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) },
          metrics: { ...DEFAULT_DATA.metrics, ...(parsed.metrics || {}) },
          flow_logs: Array.isArray(parsed.flow_logs) ? parsed.flow_logs.slice(-300) : [],
          cron_jobs: Array.isArray(parsed.cron_jobs) ? parsed.cron_jobs : DEFAULT_DATA.cron_jobs,
          task_history: Array.isArray(parsed.task_history) ? parsed.task_history.slice(-100) : []
        };
      } else {
        this.saveSync();
      }
    } catch (err) {
      console.error('[DB] Error loading database, using default state:', err.message);
      this.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
  }

  save() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveSync();
    }, 500);
  }

  saveSync() {
    try {
      const dataDir = path.dirname(DB_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const tmpFile = `${DB_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmpFile, DB_FILE);
      this.isDirty = false;
    } catch (err) {
      console.error('[DB] Failed to save database to disk:', err.message);
    }
  }

  getSettings() {
    return { ...this.data.settings };
  }

  updateSettings(updates) {
    this.data.settings = { ...this.data.settings, ...updates };
    this.save();
    return this.getSettings();
  }

  getMetrics() {
    // Reset daily tokens if date changed
    const today = new Date().toISOString().slice(0, 10);
    if (this.data.metrics.today_date !== today) {
      this.data.metrics.today_date = today;
      this.data.metrics.today_tokens = 0;
      this.save();
    }
    return { ...this.data.metrics };
  }

  recordRequest(success, tokens = 0, isBreakerTrip = false) {
    const today = new Date().toISOString().slice(0, 10);
    if (this.data.metrics.today_date !== today) {
      this.data.metrics.today_date = today;
      this.data.metrics.today_tokens = 0;
    }

    this.data.metrics.total_requests += 1;
    if (success) {
      this.data.metrics.successful_requests += 1;
    } else {
      this.data.metrics.failed_requests += 1;
    }
    if (isBreakerTrip) {
      this.data.metrics.breaker_trips += 1;
    }

    this.data.metrics.total_tokens_estimated += tokens;
    this.data.metrics.today_tokens += tokens;

    const hour = new Date().getHours();
    this.data.metrics.hourly_distribution[hour] = (this.data.metrics.hourly_distribution[hour] || 0) + 1;

    this.save();
  }

  addFlowLog(logEntry) {
    const entry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...logEntry
    };
    this.data.flow_logs.push(entry);
    // Keep max 300 logs in memory/disk
    if (this.data.flow_logs.length > 300) {
      this.data.flow_logs = this.data.flow_logs.slice(-300);
    }
    this.save();
    return entry;
  }

  getFlowLogs(limit = 100) {
    return this.data.flow_logs.slice(-limit);
  }

  clearFlowLogs() {
    this.data.flow_logs = [];
    this.save();
  }

  getCronJobs() {
    return [...this.data.cron_jobs];
  }

  saveCronJob(job) {
    const existingIndex = this.data.cron_jobs.findIndex(j => j.id === job.id);
    if (existingIndex >= 0) {
      this.data.cron_jobs[existingIndex] = { ...this.data.cron_jobs[existingIndex], ...job };
    } else {
      this.data.cron_jobs.push({
        id: job.id || `cron-${Date.now()}`,
        name: job.name || 'Untitled Cron',
        schedule: job.schedule || '0 * * * *',
        prompt: job.prompt || '',
        enabled: Boolean(job.enabled),
        last_run: null,
        status: 'idle',
        ...job
      });
    }
    this.save();
    return this.getCronJobs();
  }

  deleteCronJob(id) {
    this.data.cron_jobs = this.data.cron_jobs.filter(j => j.id !== id);
    this.save();
    return this.getCronJobs();
  }

  addTaskHistory(task) {
    const entry = {
      id: `task-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...task
    };
    this.data.task_history.unshift(entry);
    if (this.data.task_history.length > 100) {
      this.data.task_history = this.data.task_history.slice(0, 100);
    }
    this.save();
    return entry;
  }

  getTaskHistory() {
    return [...this.data.task_history];
  }
}

module.exports = new Database();
