const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const MEMORY_FILE = path.join(__dirname, '..', 'data', 'shared_memory.json');

const DEFAULT_MEMORY = {
  facts: [
    "Format video default adalah FB Reels rasio 16:9 dengan bar judul kuning tebal di atas dan teks putih di bawah.",
    "File output video disimpan di direktori data/output/.",
    "Pencarian video menggunakan yt-dlp secara lokal tanpa menyentuh Google API.",
    "Subtitle di-render langsung menggunakan FFmpeg dan Whisper."
  ],
  workspace_state: {
    last_processed_video: null,
    last_clip_title: null,
    active_pipeline: null
  },
  account_activity: []
};

class SharedMemory {
  constructor() {
    this.memory = JSON.parse(JSON.stringify(DEFAULT_MEMORY));
    this.load();
  }

  load() {
    try {
      const dir = path.dirname(MEMORY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      if (fs.existsSync(MEMORY_FILE)) {
        const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        this.memory = {
          facts: Array.isArray(parsed.facts) ? parsed.facts : DEFAULT_MEMORY.facts,
          workspace_state: { ...DEFAULT_MEMORY.workspace_state, ...(parsed.workspace_state || {}) },
          account_activity: Array.isArray(parsed.account_activity) ? parsed.account_activity.slice(-50) : []
        };
      } else {
        this.save();
      }
    } catch (e) {
      console.error('[SharedMemory] Error loading memory:', e.message);
    }
  }

  save() {
    try {
      const dir = path.dirname(MEMORY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.memory, null, 2), 'utf8');
    } catch (e) {
      console.error('[SharedMemory] Error saving memory:', e.message);
    }
  }

  getAll() {
    return { ...this.memory };
  }

  addFact(fact) {
    if (!fact || this.memory.facts.includes(fact)) return;
    this.memory.facts.push(fact);
    logger.logInfo('Shared Memory Baru Ditambahkan', fact);
    this.save();
  }

  updateWorkspace(updates, accountEmail = 'System') {
    this.memory.workspace_state = { ...this.memory.workspace_state, ...updates };
    this.recordActivity(accountEmail, 'Update Workspace State', updates);
    this.save();
  }

  recordActivity(accountEmail, action, details) {
    this.memory.account_activity.push({
      timestamp: new Date().toISOString(),
      account: accountEmail,
      action,
      details: typeof details === 'object' ? JSON.stringify(details) : String(details)
    });
    if (this.memory.account_activity.length > 50) {
      this.memory.account_activity = this.memory.account_activity.slice(-50);
    }
    this.save();
  }

  /**
   * Format shared memory as system prompt context for LLMs
   */
  getSystemContext() {
    const factsList = this.memory.facts.map(f => `- ${f}`).join('\n');
    const stateStr = JSON.stringify(this.memory.workspace_state, null, 2);
    const recentActivities = this.memory.account_activity.slice(-5).map(a => `[${a.account}] ${a.action}: ${a.details}`).join('\n');

    return `
[SHARED MEMORY & MULTI-ACCOUNT STATE]
Semua akun AI di server ini berbagi memori dan status bersama:
Fakta & Preferensi Sistem:
${factsList}

Status Workspace Terkini:
${stateStr}

Aktivitas Akun Terakhir:
${recentActivities || '(Belum ada aktivitas)'}
---------------------------------------------`;
  }
}

module.exports = new SharedMemory();
