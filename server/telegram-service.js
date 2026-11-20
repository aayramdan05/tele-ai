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
    const threadId = msg.message_thread_id || null;
    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
    const username = msg.from.username || msg.from.first_name || 'User';
    let text = msg.text.trim();

    // If bot is inside group / forum supergroup
    if (isGroup && this.botInfo && this.botInfo.username) {
      const mention = `@${this.botInfo.username}`;
      const isReplyToBot = msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.id === this.botInfo.id;
      const isCommand = text.startsWith('/');

      if (!text.includes(mention) && !isReplyToBot && !isCommand) {
        // Not addressed to the bot, ignore general group banter
        return;
      }
      text = text.replace(mention, '').trim();
    }

    const settings = db.getSettings();
    const allowedChatIds = (settings.allowed_chat_ids || []).map(String);

    // Whitelist check (allows chat ID or individual sender ID)
    if (allowedChatIds.length > 0 && !allowedChatIds.includes(chatId) && !allowedChatIds.includes(String(msg.from.id))) {
      logger.logFlow('info', `Pesan dari Chat/Grup Tidak Dikenal: ${chatId} (@${username})`, text);
      await this.sendMessage(chatId, `⛔ *Akses Ditolak*\nChat ID ini (\`${chatId}\`) belum terdaftar di whitelist.\nSilakan daftarkan Chat ID ini di Web Dashboard Settings.`, threadId);
      return;
    }

    if (allowedChatIds.length === 0) {
      // First time notification
      await this.sendMessage(chatId, `👋 *Halo ${username}!* Bot terhubung ke VPS 10.69.69.53.\n\n⚠️ *Perhatian:* Belum ada Chat ID yang didaftarkan di whitelist.\nChat ID Anda adalah: \`${chatId}\`${threadId ? `\nTopic ID: \`${threadId}\`` : ''}\n\nUntuk keamanan server, masukkan Chat ID ini di menu *Telegram Settings* pada Web Dashboard.`, threadId);
    }

    // Command handling (Hermes Agent & 9router shortcuts)
    if (text === '/start') {
      await this.sendMessage(chatId, `🤖 *Tele-AI Studio — Multi-Persona Autonomous Agent*\n\nEngine Aktif: *${settings.active_engine}*\nModel Default: \`${settings.active_model}\`\n\n📌 *Daftar Perintah Cepat:*\n• \`/status\` - Cek kondisi server, engine & antrean\n• \`/persona\` - Cek persona agen di topic ini\n• \`/setpersona [key]\` - Set persona per topic (clipper / devops / coder / router)\n• \`/topics\` - Daftar semua persona per topic\n• \`/model [nama]\` - Cek / ubah model AI on-the-fly\n• \`/engine [nama]\` - Ganti engine (agy / gemini_oauth / gemini_api)\n• \`/stats\` - Detail metrik kuota token & biaya\n• \`/reels [tema]\` - Buat FB Reels otomatis (16:9 / 9:16)\n• \`/reset\` - Reset status Circuit Breaker\n• \`/help\` - Panduan lengkap\n\nKirim perintah apa saja, AI Agent akan mengeksekusinya di VPS.`, threadId);
      return;
    }

    if (text === '/help') {
      await this.sendMessage(chatId, `📖 *Panduan Penggunaan Tele-AI (Hermes Swarm + 9router):*\n\n👥 *Mode Agen Berbeda per Topic Telegram:*\nAnda bisa membuat topic terpisah di grup Telegram dengan persona & skills yang berbeda:\n1. Buka topic video/media $\rightarrow$ ketik \`/setpersona clipper\` (spesialis Reels & Clipper).\n2. Buka topic server $\rightarrow$ ketik \`/setpersona devops\` (spesialis Linux sysadmin & PM2).\n3. Buka topic coding $\rightarrow$ ketik \`/setpersona coder\` (spesialis Fullstack developer).\n4. Buka topic kuota $\rightarrow$ ketik \`/setpersona router\` (spesialis 9router kuota).\n\nKetik \`/persona\` untuk cek persona aktif di topic Anda.\n\nSemua perintah berjalan dalam antrean serial FIFO (Concurrency = 1) dengan circuit breaker anti-403.`, threadId);
      return;
    }

    // Persona commands (Hermes Swarm per Topic)
    if (text === '/persona') {
      const allTemplates = db.getPersonaTemplates();
      const current = db.getTopicPersona(threadId);

      if (threadId && current) {
        await this.sendMessage(chatId, `🎭 *Persona Aktif di Topic #${threadId}:*\n• Nama: *${current.icon} ${current.name}*\n• Model: \`${current.model}\`\n• Deskripsi: _${current.description}_\n• Skills: \`${current.skills.join(', ')}\`\n\nUntuk mengganti persona di topic ini, ketik:\n\`/setpersona <clipper | devops | coder | router | general>\``, threadId);
      } else {
        let listText = `🎭 *Daftar Persona Agen Tersedia:*\n\n`;
        for (const [k, p] of Object.entries(allTemplates)) {
          listText += `• *${p.icon} ${p.name}* (\`${k}\`)\n  Model: \`${p.model}\` | _${p.description}_\n\n`;
        }
        listText += `💡 *Cara Pasang:* Buka topic di grup Telegram Anda, lalu ketik:\n\`/setpersona <nama_key>\`\nContoh: \`/setpersona clipper\``;
        await this.sendMessage(chatId, listText, threadId);
      }
      return;
    }

    if (text.startsWith('/setpersona')) {
      const parts = text.split(' ').filter(Boolean);
      if (parts.length === 1) {
        await this.sendMessage(chatId, `💡 *Format Penggunaan:* \`/setpersona <key>\`\n\nPilihan Persona:\n• \`/setpersona clipper\` - 🎬 Reels & Media Creator\n• \`/setpersona devops\` - 💻 DevOps & Linux Sysadmin\n• \`/setpersona coder\` - 🐍 Fullstack Software Engineer\n• \`/setpersona router\` - 📊 Quota & 9router Controller\n• \`/setpersona general\` - 🤖 Executive Assistant (Default)`, threadId);
        return;
      }

      if (!threadId) {
        await this.sendMessage(chatId, `⚠️ Perintah \`/setpersona\` dirancang khusus untuk Forum Topic di grup Telegram agar setiap topic punya agent sendiri.\nJika ingin mengubah model global, gunakan perintah \`/model <nama_model>\`.`, threadId);
        return;
      }

      const pKey = parts[1].trim().toLowerCase();
      const templates = db.getPersonaTemplates();
      if (!templates[pKey]) {
        await this.sendMessage(chatId, `❌ Persona \`${pKey}\` tidak dikenal. Pilihan: \`clipper\`, \`devops\`, \`coder\`, \`router\`, \`general\``, threadId);
        return;
      }

      const updated = db.setTopicPersona(threadId, pKey);
      logger.logInfo(`Topic Persona Diubah [#${threadId}]`, `${updated.icon} ${updated.name}`);
      await this.sendMessage(chatId, `✅ *Persona Topic #${threadId} Berhasil Diatur:*\n${updated.icon} *${updated.name}*\n• Model: \`${updated.model}\`\n• Skills: \`${updated.skills.join(', ')}\`\n• _${updated.description}_`, threadId);
      return;
    }

    if (text === '/topics') {
      const all = db.getTopicPersonas();
      const keys = Object.keys(all);
      if (keys.length === 0) {
        await this.sendMessage(chatId, `📋 *Belum ada Topic Persona yang dikonfigurasi.*\n\nBuka topic mana saja di grup Telegram Anda, lalu ketik:\n\`/setpersona clipper\` (atau \`devops\`, \`coder\`, \`router\`)`, threadId);
      } else {
        let msgTopics = `📋 *Daftar Agen per Topic Telegram (Hermes Swarm):*\n\n`;
        for (const tid of keys) {
          const item = all[tid];
          msgTopics += `• *Topic #${tid}*: ${item.icon} *${item.name}* (\`${item.key}\`)\n  Model: \`${item.model}\`\n`;
        }
        await this.sendMessage(chatId, msgTopics, threadId);
      }
      return;
    }

    if (text === '/status') {
      const stats = require('./quota-tracker').getStats();
      const qStatus = agentEngine.getQueueStatus();
      await this.sendMessage(chatId, `📊 *Status Sistem:*\n• Engine: \`${settings.active_engine}\`\n• Model: \`${settings.active_model}\`\n• Breaker: *${stats.breaker.status.toUpperCase()}* (${stats.breaker.consecutiveErrors} error)\n• Antrean: \`${qStatus.queueLength}\` antre (${qStatus.isProcessing ? 'Sedang Memproses' : 'Idle'})\n• Total Requests: \`${stats.metrics.total_requests}\`\n• Token Hari Ini: \`${stats.metrics.today_tokens.toLocaleString()}\``, threadId);
      return;
    }

    if (text === '/stats') {
      const stats = require('./quota-tracker').getStats();
      await this.sendMessage(chatId, `📈 *Metrik & Kuota (9router-style):*\n• Total Request: \`${stats.metrics.total_requests}\` (Sukses: ${stats.metrics.successful_requests}, Gagal: ${stats.metrics.failed_requests})\n• Token Hari Ini: \`${stats.metrics.today_tokens.toLocaleString()}\` token\n• Total Token: \`${stats.metrics.total_tokens_estimated.toLocaleString()}\` token\n• Estimasi Biaya: \`$${stats.metrics.estimated_cost_usd}\` (~Rp ${stats.metrics.estimated_cost_idr.toLocaleString()})\n• Current RPM: \`${stats.breaker.currentRpm}\` | TPM: \`${stats.breaker.currentTpm}\``, threadId);
      return;
    }

    if (text === '/queue') {
      const q = agentEngine.getQueueStatus();
      await this.sendMessage(chatId, `⏳ *Status Antrean:*\n• Panjang Antrean: \`${q.queueLength}\`\n• Status Worker: *${q.isProcessing ? '⚡ Sedang Memproses' : '💤 Siap Menerima'}*`, threadId);
      return;
    }

    if (text.startsWith('/model')) {
      const parts = text.split(' ').filter(Boolean);
      if (parts.length === 1) {
        await this.sendMessage(chatId, `🎯 *Model Aktif:* \`${settings.active_model}\`\n\nPilihan Model:\n• \`gemini-3.8-flash-low\` (⚡ Super Cepat)\n• \`gemini-3.8-flash-medium\` (⚖️ Seimbang)\n• \`gemini-3.8-flash-high\` (🧠 Deep Thinking)\n• \`claude-sonnet-4-6\`\n• \`claude-opus-4-6-thinking\`\n• \`gpt-oss-120b-medium\`\n\nUntuk mengganti ketik contoh:\n\`/model gemini-3.8-flash-low\``, threadId);
      } else {
        const newModel = parts[1].trim();
        db.updateSettings({ active_model: newModel });
        logger.logInfo('Model Diubah via Telegram', newModel);
        await this.sendMessage(chatId, `✅ *Model Berhasil Diubah ke:* \`${newModel}\``, threadId);
      }
      return;
    }

    if (text.startsWith('/engine')) {
      const parts = text.split(' ').filter(Boolean);
      if (parts.length === 1) {
        await this.sendMessage(chatId, `⚙️ *Engine Aktif:* \`${settings.active_engine}\`\n\nPilihan Engine:\n• \`agy\` - Antigravity CLI Resmi (Anti-403)\n• \`gemini_oauth\` - Google OAuth Multi-Account Pool\n• \`gemini_api\` - Gemini API Key\n\nUntuk mengganti ketik:\n\`/engine agy\``, threadId);
      } else {
        const newEngine = parts[1].trim().toLowerCase();
        if (['agy', 'gemini_oauth', 'gemini_api'].includes(newEngine)) {
          db.updateSettings({ active_engine: newEngine });
          logger.logInfo('Engine Diubah via Telegram', newEngine);
          await this.sendMessage(chatId, `✅ *Engine Berhasil Diubah ke:* \`${newEngine}\``, threadId);
        } else {
          await this.sendMessage(chatId, `❌ Engine tidak valid. Pilihan: \`agy\`, \`gemini_oauth\`, \`gemini_api\``, threadId);
        }
      }
      return;
    }

    if (text === '/reset') {
      const circuitBreaker = require('./circuit-breaker');
      circuitBreaker.resetBreaker();
      await this.sendMessage(chatId, `✅ *Circuit Breaker Berhasil Direset ke Healthy!*`, threadId);
      return;
    }

    let userPrompt = text;
    const isMedia = /video|reels|clip|download|render|mp4/i.test(text);

    if (text.startsWith('/reels')) {
      const topic = text.replace('/reels', '').trim() || 'podcast inspirasi viral';
      userPrompt = `Tolong buatkan video Reels rasio 16:9 dengan judul atas dan bawah bertema '${topic}'. Render videonya dan kirimkan hasilnya ke saya.`;
    }

    // Send initial processing ack
    if (isMedia) {
      await this.sendMessage(chatId, `🎬 *Memproses Pembuatan Video Reels...*\n⏳ _Sedang mencari, memotong highlight, dan merender video di VPS..._\n_Estimasi: ~30-60 detik. File video akan otomatis dikirim ke sini begitu siap._`, threadId);
    } else {
      await this.sendMessage(chatId, `⏳ *Sedang diproses...*\nAI Agent di VPS sedang mengeksekusi permintaan Anda.`, threadId);
    }

    // Send typing action periodically
    const typingInterval = setInterval(() => {
      this.sendChatAction(chatId, 'typing', threadId).catch(() => {});
    }, 4000);

    try {
      const taskResult = await agentEngine.submitTask({
        prompt: userPrompt,
        user: username,
        chatId: chatId,
        threadId: threadId,
        source: isGroup ? 'telegram_group' : 'telegram'
      });

      clearInterval(typingInterval);

      // Send final text reply
      const replyText = taskResult.text || '✅ Permintaan selesai dikerjakan.';
      await this.sendMessage(chatId, replyText, threadId);

    } catch (err) {
      clearInterval(typingInterval);
      await this.sendMessage(chatId, `❌ *Terjadi Kesalahan saat memproses permintaan:*\n\`${err.message}\``, threadId);
    }
  }

  async sendMessage(chatId, text, threadId = null) {
    try {
      const url = this.getApiUrl('sendMessage');
      const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      };
      if (threadId) payload.message_thread_id = threadId;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!data.ok) {
        // Fallback without markdown in case of formatting syntax errors
        const fallbackPayload = {
          chat_id: chatId,
          text: text
        };
        if (threadId) fallbackPayload.message_thread_id = threadId;

        const fallbackRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fallbackPayload)
        });
        return await fallbackRes.json();
      }
      return data;
    } catch (err) {
      console.error('[TELEGRAM] Error sending message:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async sendChatAction(chatId, action = 'typing', threadId = null) {
    try {
      const url = this.getApiUrl('sendChatAction');
      const payload = { chat_id: chatId, action };
      if (threadId) payload.message_thread_id = threadId;

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {}
  }

  async sendFile(chatId, filePath, caption = '', threadId = null) {
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
      await this.sendChatAction(chatId, 'upload_video', threadId);
    } else if (isPhoto) {
      method = 'sendPhoto';
      field = 'photo';
      await this.sendChatAction(chatId, 'upload_photo', threadId);
    } else {
      await this.sendChatAction(chatId, 'upload_document', threadId);
    }

    const url = this.getApiUrl(method);
    const fileBuffer = fs.readFileSync(fullPath);
    const fileName = path.basename(fullPath);

    const formData = new FormData();
    formData.append('chat_id', chatId);
    if (threadId) formData.append('message_thread_id', threadId);
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
