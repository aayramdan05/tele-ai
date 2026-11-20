require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

// Built-in Persona & Skill Templates (Hermes & 9router Style)
const PERSONA_TEMPLATES = {
  general: {
    key: 'general',
    name: 'Executive Assistant (Hermes)',
    icon: '🤖',
    description: 'Asisten pribadi serba bisa: ramah, ringkas, responsif mengeksekusi tugas server & chatting',
    model: 'gemini-3.8-flash-low',
    skills: ['terminal', 'file_tools', 'memory'],
    instruction: `Anda adalah Executive Assistant pribadi (Hermes Agent) yang berjalan di VPS. Anda ramah, responsif, ringkas, dan sigap mengeksekusi apa pun yang diminta pengguna baik perintah terminal, cek server, atau tanya-jawab.`
  },
  clipper: {
    key: 'clipper',
    name: 'Reels & Media Creator',
    icon: '🎬',
    description: 'Spesialis video pendek (FB Reels/Shorts/TikTok): mencari highlight video, memotong klip, padding 16:9/9:16, judul catchy, dan kirim video otomatis',
    model: 'gemini-3.8-flash-low',
    skills: ['video_clipper', 'ffmpeg', 'yt-dlp', 'telegram_send_file'],
    instruction: `Anda adalah pakar video viral & Reels Creator Specialist (Hermes Media Agent). Keahlian utama Anda adalah memotong video podcast/konten viral, menambahkan bar judul atas-bawah rasio 16:9 atau 9:16, dan merender video berkualitas tinggi menggunakan scripts/clipper-helper.py. Anda selalu memastikan video hasil render tersimpan di data/output dan dikirimkan langsung ke Telegram.`
  },
  devops: {
    key: 'devops',
    name: 'DevOps & Linux Sysadmin',
    icon: '💻',
    description: 'Administrator VPS Debian/Linux: pemantauan CPU/RAM/Disk, PM2, Cron, Nginx/systemd, Docker, jaringan, dan keamanan server',
    model: 'gemini-3.8-flash-low',
    skills: ['terminal_execute', 'file_tools', 'sysinfo', 'pm2'],
    instruction: `Anda adalah Senior Linux Sysadmin & DevOps Engineer spesialis server Debian (Hermes DevOps Agent). Anda ahli mengecek kesehatan sistem (CPU, RAM, Disk, Load), mengelola process PM2, mengecek log, menyusun script bash automasi, firewall, dan memastikan server VPS berjalan optimal 24/7.`
  },
  coder: {
    key: 'coder',
    name: 'Fullstack Software Engineer',
    icon: '🐍',
    description: 'Arsitek kode & developer: Node.js, Python, PostgreSQL, REST API, automasi script, debugging error & refactoring',
    model: 'gemini-3.8-flash-medium',
    skills: ['file_tools', 'terminal_execute', 'code_review'],
    instruction: `Anda adalah Senior Fullstack Software Engineer & Code Architect. Anda ahli merancang dan menulis kode Node.js, Python, PostgreSQL, dan arsitektur backend. Berikan kode yang modular, efisien, bersih dari bug, dan siap produksi.`
  },
  router: {
    key: 'router',
    name: 'Quota & Routing Monitor (9router)',
    icon: '📊',
    description: 'Spesialis pemantauan kuota AI, token budgeting, routing model (Gemini/Claude), circuit breaker, dan analitik',
    model: 'gemini-3.8-flash-low',
    skills: ['quota_tracker', 'circuit_breaker', 'multi_account'],
    instruction: `Anda adalah AI Traffic Controller & Quota Guardian (9router Agent). Tugas utama Anda adalah mengawasi penggunaan token, RPM/TPM, biaya estimasi API, memastikan circuit breaker aman dari ban 403, dan membantu mengoptimalkan alur multi-akun Google.`
  }
};

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
  task_history: [],
  topic_personas: {}
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
          task_history: Array.isArray(parsed.task_history) ? parsed.task_history.slice(-100) : [],
          topic_personas: (parsed.topic_personas && typeof parsed.topic_personas === 'object') ? parsed.topic_personas : {}
        };
        if (!this.data.settings.telegram_bot_token && process.env.TELEGRAM_BOT_TOKEN) {
          this.data.settings.telegram_bot_token = process.env.TELEGRAM_BOT_TOKEN;
        }
      } else {
        if (process.env.TELEGRAM_BOT_TOKEN) {
          this.data.settings.telegram_bot_token = process.env.TELEGRAM_BOT_TOKEN;
        }
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
    return {
      ...this.data.settings,
      telegram_bot_token: this.data.settings.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || ''
    };
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

  // --- TOPIC PERSONAS & SKILLS (Hermes Swarm) ---
  getPersonaTemplates() {
    return PERSONA_TEMPLATES;
  }

  getTopicPersonas() {
    return { ...(this.data.topic_personas || {}) };
  }

  getTopicPersona(threadId) {
    if (!threadId) return null;
    const all = this.data.topic_personas || {};
    return all[String(threadId)] || null;
  }

  setTopicPersona(threadId, personaData, customName = null) {
    if (!threadId) return null;
    if (!this.data.topic_personas) this.data.topic_personas = {};

    let entry;
    if (typeof personaData === 'object' && personaData !== null) {
      entry = {
        threadId: String(threadId),
        key: personaData.key || `custom-${Date.now()}`,
        name: personaData.name || customName || 'Custom Specialist',
        icon: personaData.icon || '✨',
        description: personaData.description || personaData.name || 'Custom Persona AI',
        model: personaData.model || 'gemini-3.8-flash-low',
        skills: Array.isArray(personaData.skills) ? personaData.skills : ['general'],
        instruction: personaData.instruction || `Anda adalah ${personaData.name}. Jawablah sesuai kepribadian ini.`,
        updated_at: new Date().toISOString()
      };
    } else {
      const template = PERSONA_TEMPLATES[personaData] || PERSONA_TEMPLATES['general'];
      entry = {
        threadId: String(threadId),
        key: template.key,
        name: customName || template.name,
        icon: template.icon,
        description: template.description,
        model: template.model,
        skills: template.skills,
        instruction: template.instruction,
        updated_at: new Date().toISOString()
      };
    }

    this.data.topic_personas[String(threadId)] = entry;
    this.save();
    return entry;
  }

  deleteTopicPersona(threadId) {
    if (!threadId || !this.data.topic_personas) return false;
    delete this.data.topic_personas[String(threadId)];
    this.save();
    return true;
  }
}

module.exports = new Database();
