const cron = require('node-cron');
const db = require('./database');
const logger = require('./logger');
const agentEngine = require('./agent-engine');

class CronService {
  constructor() {
    this.activeTasks = new Map();
  }

  init() {
    this.refresh();
  }

  refresh() {
    // Stop all running cron jobs
    for (const [id, task] of this.activeTasks) {
      task.stop();
    }
    this.activeTasks.clear();

    const jobs = db.getCronJobs();
    let scheduledCount = 0;

    for (const job of jobs) {
      if (job.enabled && job.schedule && cron.validate(job.schedule)) {
        try {
          const task = cron.schedule(job.schedule, () => {
            this.executeJob(job.id);
          });
          this.activeTasks.set(job.id, task);
          scheduledCount += 1;
        } catch (err) {
          console.error(`[CRON] Gagal menjadwalkan job ${job.name}:`, err.message);
        }
      }
    }

    console.log(`[CRON] Terjadwal ${scheduledCount} tugas otomatis aktif.`);
  }

  async executeJob(jobId) {
    const jobs = db.getCronJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    logger.logInfo(`Eksekusi Cronjob Otomatis: ${job.name}`, job.prompt);
    db.saveCronJob({ id: jobId, last_run: new Date().toISOString(), status: 'running' });

    try {
      const settings = db.getSettings();
      const adminChatId = (settings.allowed_chat_ids && settings.allowed_chat_ids[0]) || null;

      await agentEngine.submitTask({
        prompt: `[OTOMATISASI CRON - ${job.name}]\n${job.prompt}`,
        user: 'CronScheduler',
        chatId: adminChatId,
        source: 'cron'
      });

      db.saveCronJob({ id: jobId, status: 'idle' });
      logger.logInfo(`Cronjob Sukses: ${job.name}`, 'Tugas selesai dieksekusi.');
    } catch (err) {
      db.saveCronJob({ id: jobId, status: `error: ${err.message}` });
      logger.logError(`Cronjob Gagal: ${job.name}`, err);
    }
  }

  runJobNow(jobId) {
    return this.executeJob(jobId);
  }
}

module.exports = new CronService();
