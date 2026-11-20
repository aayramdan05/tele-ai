const fs = require('fs');
const path = require('path');
const db = require('./database');
const logger = require('./logger');
const agentEngine = require('./agent-engine');
const telegramTool = require('./tools/telegram-tool');

class TelegramService {
  constructor() {
    this.isPolling = false;
    this.pollingAbort = null;
    this.lastUpdateId = 0;
    this.botInfo = null;

    // Inject self into telegramTool
    telegramTool.setTelegramService(this);
  }

  getApiUrl(method) {
    const token = db.getSettings().telegram_bot_token;
    if (!token) throw new Error('Telegram Bot Token belum diatur.');
    return `https://api.telegram.org/bot${token}/${method}`;
  }

  async testConnection(token = null) {
    const testToken = token || db.getSettings().telegram_bot_token;
    if (!testToken) {
      return { success: false, error: 'Token belum diisi.' };
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${testToken}/getMe`);
      const data = await res.json();
      if (data.ok) {
        this.botInfo = data.result;
        return { success: true, bot: data.result };
      } else {
        return { success: false, error: data.description || 'Token tidak valid' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  start() {
    const token = db.getSettings().telegram_bot_token;
    if (!token) {
      console.log('[TELEGRAM] Bot Token belum diset, bot tidak dijalankan.');
      return;
    }

    if (this.isPolling) return;
    this.isPolling = true;
    console.log('[TELEGRAM] Memulai polling Telegram bot...');
    logger.logInfo('Telegram Bot Aktif', 'Memulai koneksi polling ke Telegram API.');
    this.pollLoop();
  }

  stop() {
    this.isPolling = false;
    if (this.pollingAbort) {
      this.pollingAbort.abort();
      this.pollingAbort = null;
    }
    console.log('[TELEGRAM] Bot Telegram dihentikan.');
    logger.logInfo('Telegram Bot Dihentikan', 'Polling Telegram berhenti.');
  }

  async pollLoop() {
    while (this.isPolling) {
      try {
        const token = db.getSettings().telegram_bot_token;
        if (!token) {
          this.isPolling = false;
          break;
        }

        const url = `${this.getApiUrl('getUpdates')}?offset=${this.lastUpdateId + 1}&timeout=20`;
        const res = await fetch(url);
        if (!res.ok) {
          await new Promise(r => setTimeout(r, 4000));
          continue;
        }

        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
            // Process update asynchronously so long-running tasks don't block polling loop
            this.handleUpdate(update).catch(err => {
              console.error('[TELEGRAM] Error handling update:', err.message);
            });
          }
        }
      } catch (err) {
        // Sleep on error to avoid tight loop
        await new Promise(r => setTimeout(r, 4000));
      }
    }
  }

  async handleUpdate(update) {
    if (!update.message || !update.message.text) return;

    const msg = update.message;
    const chatId = String(msg.chat.id);
    const username = msg.from.username || msg.from.first_name || 'User';
    const text = msg.text.trim();

    const settings = db.getSettings();
    const allowedChatIds = (settings.allowed_chat_ids || []).map(String);

    // Whitelist check
    if (allowedChatIds.length > 0 && !allowedChatIds.includes(chatId)) {
      logger.logFlow('info', `Pesan dari Chat ID Tidak Dikenal: ${chatId} (@${username})`, text);
      await this.sendMessage(chatId, `⛔ *Akses Ditolak*\nChat ID Anda (\`${chatId}\`) belum terdaftar di whitelist.\nSilakan daftarkan Chat ID ini di Web Dashboard Settings.`);
      return;
    }

    if (allowedChatIds.length === 0) {
      // First time notification
      await this.sendMessage(chatId, `👋 *Halo ${username}!* Bot terhubung ke VPS 10.69.69.53.\n\n⚠️ *Perhatian:* Belum ada Chat ID yang didaftarkan di whitelist.\nChat ID Anda adalah: \`${chatId}\`\n\nUntuk keamanan server, masukkan Chat ID ini di menu *Telegram Settings* pada Web Dashboard.`);
    }

    // Command handling (Hermes Agent & 9router shortcuts)
    if (text === '/start') {
      await this.sendMessage(chatId, `🤖 *Tele-AI Studio — Autonomous VPS Agent*\n\nEngine Aktif: *${settings.active_engine}*\nModel: \`${settings.active_model}\`\n\n📌 *Daftar Perintah Cepat:*\n• \`/status\` - Cek kondisi server, engine & antrean\n• \`/stats\` - Detail metrik kuota token & biaya\n• \`/queue\` - Cek status antrean saat ini\n• \`/model [nama]\` - Cek / ubah model AI on-the-fly\n• \`/engine [nama]\` - Ganti engine (agy / gemini_oauth / gemini_api)\n• \`/reels [tema]\` - Buat FB Reels otomatis (16:9 / 9:16)\n• \`/reset\` - Reset status Circuit Breaker\n• \`/help\` - Panduan lengkap\n\nKirim perintah apa saja, AI Agent akan mengeksekusinya di VPS.`);
      return;
    }

    if (text === '/help') {
      await this.sendMessage(chatId, `📖 *Panduan Penggunaan Tele-AI (Hermes + 9router):*\n\nAnda dapat mengirimkan perintah bebas layaknya asisten pribadi:\n• _"Carikan video podcast bisnis, potong 1 menit, beri judul atas 'RAHASIA SUKSES' dan bawah 'Tonton sampai habis', render 16:9 dan kirim ke sini"_\n• _"Cek disk space dan memory server VPS"_\n• _"Buatkan script cronjob backup di data/backup.sh"_\n• _"List file di direktori data/output"_\n\nSemua perintah berjalan dalam antrean serial FIFO (Concurrency = 1) dengan circuit breaker anti-403.`);
      return;
    }

    if (text === '/status') {
      const stats = require('./quota-tracker').getStats();
      const qStatus = agentEngine.getQueueStatus();
      await this.sendMessage(chatId, `📊 *Status Sistem:*\n• Engine: \`${settings.active_engine}\`\n• Model: \`${settings.active_model}\`\n• Breaker: *${stats.breaker.status.toUpperCase()}* (${stats.breaker.consecutiveErrors} error)\n• Antrean: \`${qStatus.queueLength}\` antre (${qStatus.isProcessing ? 'Sedang Memproses' : 'Idle'})\n• Total Requests: \`${stats.metrics.total_requests}\`\n• Token Hari Ini: \`${stats.metrics.today_tokens.toLocaleString()}\``);
      return;
    }

    if (text === '/stats') {
      const stats = require('./quota-tracker').getStats();
      await this.sendMessage(chatId, `📈 *Metrik & Kuota (9router-style):*\n• Total Request: \`${stats.metrics.total_requests}\` (Sukses: ${stats.metrics.successful_requests}, Gagal: ${stats.metrics.failed_requests})\n• Token Hari Ini: \`${stats.metrics.today_tokens.toLocaleString()}\` token\n• Total Token: \`${stats.metrics.total_tokens_estimated.toLocaleString()}\` token\n• Estimasi Biaya: \`$${stats.metrics.estimated_cost_usd}\` (~Rp ${stats.metrics.estimated_cost_idr.toLocaleString()})\n• Current RPM: \`${stats.breaker.currentRpm}\` | TPM: \`${stats.breaker.currentTpm}\``);
      return;
    }

    if (text === '/queue') {
      const q = agentEngine.getQueueStatus();
      await this.sendMessage(chatId, `⏳ *Status Antrean:*\n• Panjang Antrean: \`${q.queueLength}\`\n• Status Worker: *${q.isProcessing ? '⚡ Sedang Memproses' : '💤 Siap Menerima'}*`);
      return;
    }

    if (text.startsWith('/model')) {
      const parts = text.split(' ').filter(Boolean);
      if (parts.length === 1) {
        await this.sendMessage(chatId, `🎯 *Model Aktif:* \`${settings.active_model}\`\n\nPilihan Model:\n• \`gemini-3.8-flash-high\`\n• \`gemini-3.8-flash-medium\`\n• \`gemini-3.8-flash-low\`\n• \`claude-sonnet-4-6\`\n• \`claude-opus-4-6-thinking\`\n• \`gpt-oss-120b-medium\`\n\nUntuk mengganti ketik contoh:\n\`/model gemini-3.8-flash-high\``);
      } else {
        const newModel = parts[1].trim();
        db.updateSettings({ active_model: newModel });
        logger.logInfo('Model Diubah via Telegram', newModel);
        await this.sendMessage(chatId, `✅ *Model Berhasil Diubah ke:* \`${newModel}\``);
      }
      return;
    }

    if (text.startsWith('/engine')) {
      const parts = text.split(' ').filter(Boolean);
      if (parts.length === 1) {
        await this.sendMessage(chatId, `⚙️ *Engine Aktif:* \`${settings.active_engine}\`\n\nPilihan Engine:\n• \`agy\` - Antigravity CLI Resmi (Anti-403)\n• \`gemini_oauth\` - Google OAuth Multi-Account Pool\n• \`gemini_api\` - Gemini API Key\n\nUntuk mengganti ketik:\n\`/engine agy\``);
      } else {
        const newEngine = parts[1].trim().toLowerCase();
        if (['agy', 'gemini_oauth', 'gemini_api'].includes(newEngine)) {
          db.updateSettings({ active_engine: newEngine });
          logger.logInfo('Engine Diubah via Telegram', newEngine);
          await this.sendMessage(chatId, `✅ *Engine Berhasil Diubah ke:* \`${newEngine}\``);
        } else {
          await this.sendMessage(chatId, `❌ Engine tidak valid. Pilihan: \`agy\`, \`gemini_oauth\`, \`gemini_api\``);
        }
      }
      return;
    }

    if (text === '/reset') {
      const circuitBreaker = require('./circuit-breaker');
      circuitBreaker.resetBreaker();
      await this.sendMessage(chatId, `✅ *Circuit Breaker Berhasil Direset ke Healthy!*`);
      return;
    }

    let userPrompt = text;
    if (text.startsWith('/reels')) {
      const topic = text.replace('/reels', '').trim() || 'podcast inspirasi viral';
      userPrompt = `Tolong buatkan video Reels rasio 16:9 dengan judul atas dan bawah bertema '${topic}'. Render videonya dan kirimkan hasilnya ke saya.`;
    }

    // Send initial processing ack
    await this.sendMessage(chatId, `⏳ *Sedang diproses...*\nAI Agent di VPS sedang mengeksekusi permintaan Anda.`);

    // Send typing action periodically
    const typingInterval = setInterval(() => {
      this.sendChatAction(chatId, 'typing').catch(() => {});
    }, 4000);

    try {
      const taskResult = await agentEngine.submitTask({
        prompt: userPrompt,
        user: username,
        chatId: chatId,
        source: 'telegram'
      });

      clearInterval(typingInterval);

      // Send final text reply
      const replyText = taskResult.text || '✅ Permintaan selesai dikerjakan.';
      await this.sendMessage(chatId, replyText);

    } catch (err) {
      clearInterval(typingInterval);
      await this.sendMessage(chatId, `❌ *Terjadi Kesalahan saat memproses permintaan:*\n\`${err.message}\``);
    }
  }

  async sendMessage(chatId, text) {
    try {
      const url = this.getApiUrl('sendMessage');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'Markdown'
        })
      });
      const data = await res.json();
      if (!data.ok) {
        // Fallback without markdown in case of formatting syntax errors
        const fallbackRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: text
          })
        });
        return await fallbackRes.json();
      }
      return data;
    } catch (err) {
      console.error('[TELEGRAM] Error sending message:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async sendChatAction(chatId, action = 'typing') {
    try {
      const url = this.getApiUrl('sendChatAction');
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action })
      });
    } catch (e) {}
  }

  async sendFile(chatId, filePath, caption = '') {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File tidak ditemukan: ${filePath}`);
    }

    const ext = path.extname(fullPath).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.mkv', '.webm'].includes(ext);
    const isPhoto = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);

    let method = 'sendDocument';
    let field = 'document';

    if (isVideo) {
      method = 'sendVideo';
      field = 'video';
      await this.sendChatAction(chatId, 'upload_video');
    } else if (isPhoto) {
      method = 'sendPhoto';
      field = 'photo';
      await this.sendChatAction(chatId, 'upload_photo');
    } else {
      await this.sendChatAction(chatId, 'upload_document');
    }

    const url = this.getApiUrl(method);
    const fileBuffer = fs.readFileSync(fullPath);
    const fileName = path.basename(fullPath);

    const formData = new FormData();
    formData.append('chat_id', chatId);
    if (caption) formData.append('caption', caption);
    formData.append(field, new Blob([fileBuffer]), fileName);

    const res = await fetch(url, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!data.ok) {
      throw new Error(`Telegram upload failed: ${data.description || 'Unknown error'}`);
    }
    return data;
  }
}

module.exports = new TelegramService();
