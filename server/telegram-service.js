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

  getToken() {
    return process.env.TELEGRAM_BOT_TOKEN || db.getSettings().telegram_bot_token || '';
  }

  getApiUrl(method) {
    const token = this.getToken();
    if (!token) throw new Error('Telegram Bot Token belum diatur.');
    return `https://api.telegram.org/bot${token}/${method}`;
  }

  async testConnection(token = null) {
    const testToken = token || this.getToken();
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
    const token = this.getToken();
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
        const token = this.getToken();
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
    if (!update.message) return;

    const msg = update.message;
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    const hasDocument = !!msg.document;
    let text = (msg.text || msg.caption || '').trim();

    if (!text && !hasPhoto && !hasDocument) return;

    const chatId = String(msg.chat.id);
    const threadId = msg.message_thread_id || null;
    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
    const username = msg.from.username || msg.from.first_name || 'User';

    // If bot is inside group / forum supergroup
    if (isGroup) {
      const mention = (this.botInfo && this.botInfo.username) ? `@${this.botInfo.username}` : null;
      const isMentioned = mention ? text.includes(mention) : false;
      const isReplyToBot = msg.reply_to_message && msg.reply_to_message.from && this.botInfo && msg.reply_to_message.from.id === this.botInfo.id;
      const isCommand = text.startsWith('/');

      // In the main group / General chat (no threadId), require @mention, reply, or slash command
      // BUT inside a forum topic (threadId !== null), each topic is a dedicated agent room:
      // respond directly to ALL messages without requiring @mention!
      if (!threadId) {
        if (!isMentioned && !isReplyToBot && !isCommand && !hasPhoto && !hasDocument) {
          return;
        }
      }

      if (mention && isMentioned) {
        text = text.replace(new RegExp(mention, 'gi'), '').trim();
      }
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
      await this.sendMessage(chatId, `🤖 *Tele-AI Studio — Multi-Persona Autonomous Agent*\n\nEngine Aktif: *${settings.active_engine}*\nModel Default: \`${settings.active_model}\`\n\n📌 *Daftar Perintah Cepat:*\n• \`/status\` - Cek kondisi server, engine & antrean\n• \`/persona\` - Cek persona agen di topic ini\n• \`/setpersona [key]\` - Set persona per topic (clipper / devops / coder / router)\n• \`/topics\` - Daftar semua persona per topic\n• \`/skills\` - Cek & pasang skills AI agen\n• \`/installskill [nama]\` - Install skill kustom secara instan\n• \`/model [nama]\` - Cek / ubah model AI on-the-fly\n• \`/engine [nama]\` - Ganti engine (agy / gemini_oauth / gemini_api)\n• \`/stats\` - Detail metrik kuota token & biaya\n• \`/reels [tema]\` - Buat FB Reels otomatis (16:9 / 9:16)\n• \`/reset\` - Reset status Circuit Breaker\n• \`/help\` - Panduan lengkap\n\nKirim perintah apa saja, AI Agent akan mengeksekusinya di VPS.`, threadId);
      return;
    }

    if (text === '/help') {
      await this.sendMessage(chatId, `📖 *Panduan Penggunaan Tele-AI (Hermes Swarm + 9router):*\n\n👥 *Mode Agen Berbeda per Topic Telegram:*\nSetiap forum topic di grup Telegram adalah ruang kerja tersendiri (tidak perlu @mention bot di dalam topic):\n1. Buka topic video/media $\rightarrow$ ketik \`/setpersona clipper\`\n2. Buka topic server $\rightarrow$ ketik \`/setpersona devops\`\n3. Buka topic coding $\rightarrow$ ketik \`/setpersona coder\`\n4. Buka topic kuota $\rightarrow$ ketik \`/setpersona router\`\n\n🛠️ *Otomatisasi Instalasi Skill:*\nAnda bisa meminta bot menginstall skill baru hanya dengan mengetik perintah di chat, misalnya:\n_“Tolong install skill web scraper”_\n_“Tambahkan skill crypto price tracker”_\nAtau ketik \`/skills\` untuk melihat daftar skill terpasang.`, threadId);
      return;
    }

    if (text === '/skills') {
      const installed = db.getInstalledSkills();
      const currentPersona = threadId ? db.getTopicPersona(threadId) : null;
      const activeSkills = (currentPersona && Array.isArray(currentPersona.skills)) ? currentPersona.skills : ['general'];

      let skillMsg = `🛠️ *Skills System (Hermes Customizations)*\n\n`;
      if (threadId && currentPersona) {
        skillMsg += `🎭 *Skill Aktif di Topic #${threadId} (${currentPersona.name}):*\n`;
        skillMsg += `• \`${activeSkills.join('`, `')}\`\n\n`;
      }

      skillMsg += `📦 *Daftar Skill Terinstall di VPS:*\n`;
      if (installed.length === 0) {
        skillMsg += `_Belum ada skill kustom di direktori .agents/skills._\n`;
      } else {
        for (const s of installed) {
          skillMsg += `• *${s.name}*: _${s.description}_\n`;
        }
      }

      skillMsg += `\n💡 *Cara Install Skill Baru:*\nCukup perintahkan bot secara natural:\n_“Tolong install skill web scraper”_\n_“Tambahkan skill crypto price tracker ke topic ini”_\nAtau ketik: \`/installskill <nama> [deskripsi]\``;

      await this.sendMessage(chatId, skillMsg, threadId);
      return;
    }

    if (text.startsWith('/installskill')) {
      const parts = text.split(' ').filter(Boolean);
      if (parts.length < 2) {
        await this.sendMessage(chatId, `💡 *Format:* \`/installskill <nama_skill> [deskripsi]\`\nContoh: \`/installskill weather Cek ramalan cuaca via wttr.in\``, threadId);
        return;
      }
      const skillName = parts[1].toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      const skillDesc = parts.slice(2).join(' ') || `Skill ${skillName} untuk otomasi server`;

      const skillDir = path.join(__dirname, '..', '.agents', 'skills', skillName);
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }
      if (!fs.existsSync(skillFile)) {
        const skillContent = `---\nname: ${skillName}\ndescription: ${skillDesc}\n---\n\n# Skill ${skillName}\n${skillDesc}\n`;
        fs.writeFileSync(skillFile, skillContent, 'utf8');
      }

      if (threadId) {
        db.addTopicSkill(threadId, skillName);
      }
      logger.logInfo(`Skill Manual Diinstall via Telegram`, `${skillName}: ${skillDesc}`);
      await this.sendMessage(chatId, `✅ *Skill '${skillName}' Berhasil Diinstall!*\n• Deskripsi: _${skillDesc}_\n• Lokasi: \`.agents/skills/${skillName}/SKILL.md\`${threadId ? `\n• Status: Aktif di Topic #${threadId}` : ''}`, threadId);
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
      const mq = stats.model_quotas || {};
      const gQ = mq.gemini ? `\n• Quota Gemini (5h / Wk): \`${mq.gemini.five_hour.left_pct}% left\` / \`${mq.gemini.weekly.left_pct}% left\`` : '';
      const cQ = mq.claude_gpt ? `\n• Quota Claude/GPT (5h / Wk): \`${mq.claude_gpt.five_hour.left_pct}% left\` / \`${mq.claude_gpt.weekly.left_pct}% left\`` : '';

      await this.sendMessage(chatId, `📊 *Status Sistem:*\n• Engine: \`${settings.active_engine}\`\n• Model: \`${settings.active_model}\`${gQ}${cQ}\n• Breaker: *${stats.breaker.status.toUpperCase()}* (${stats.breaker.consecutiveErrors} error)\n• Antrean: \`${qStatus.queueLength}\` antre (${qStatus.isProcessing ? 'Sedang Memproses' : 'Idle'})\n• Total Requests: \`${stats.metrics.total_requests}\`\n• Token Hari Ini: \`${stats.metrics.today_tokens.toLocaleString()}\``, threadId);
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
      const targetSession = threadId || chatId;
      db.clearConversationHistory(targetSession);
      await this.sendMessage(chatId, `✅ *Circuit Breaker & Memori Obrolan Topic Berhasil Direset ke Bersih!*`, threadId);
      return;
    }

    let userPrompt = text;
    let attachedImagePath = null;
    let attachedDocPath = null;

    // Handle attached Photo
    if (hasPhoto) {
      try {
        const photo = msg.photo[msg.photo.length - 1]; // Highest resolution
        const tempName = `img_${Date.now()}_${photo.file_unique_id}.jpg`;
        const savePath = path.join(__dirname, '..', 'data', 'temp', tempName);
        attachedImagePath = await this.downloadTelegramFile(photo.file_id, savePath);
        logger.logInfo('Gambar Diterima dari Telegram', `Tersimpan di ${tempName} (${Math.round((photo.file_size || 0) / 1024)} KB)`);
        if (!userPrompt) {
          userPrompt = 'Tolong periksa dan analisis gambar yang saya kirimkan ini.';
        }
      } catch (err) {
        console.error('[TELEGRAM] Gagal download foto:', err.message);
      }
    } else if (hasDocument) {
      try {
        const doc = msg.document;
        const cleanName = (doc.file_name || `doc_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
        const savePath = path.join(__dirname, '..', 'data', 'temp', cleanName);
        attachedDocPath = await this.downloadTelegramFile(doc.file_id, savePath);
        logger.logInfo('Dokumen Diterima dari Telegram', `Tersimpan di ${cleanName}`);
        if (!userPrompt) {
          userPrompt = `Tolong baca dan periksa isi file dokumen '${cleanName}' yang saya lampirkan ini.`;
        }
      } catch (err) {
        console.error('[TELEGRAM] Gagal download dokumen:', err.message);
      }
    }

    const isMedia = /video|reels|clip|download|render|mp4/i.test(userPrompt);

    if (userPrompt.startsWith('/reels')) {
      const topic = userPrompt.replace('/reels', '').trim() || 'podcast inspirasi viral';
      userPrompt = `Tolong buatkan video Reels rasio 16:9 dengan judul atas dan bawah bertema '${topic}'. Render videonya dan kirimkan hasilnya ke saya.`;
    }

    // Send dynamic adaptive processing acknowledgment tailored to the prompt
    let progressMsg = null;
    try {
      const adaptiveText = this.buildAdaptiveProgressMessage(userPrompt, {
        hasPhoto,
        hasDocument,
        docName: msg.document ? msg.document.file_name : null
      });
      progressMsg = await this.sendMessage(chatId, adaptiveText, threadId);
    } catch (msgErr) {
      console.error('[TELEGRAM] Gagal kirim progress message:', msgErr.message);
    }

    const progressMsgId = (progressMsg && progressMsg.result && progressMsg.result.message_id) ? progressMsg.result.message_id : null;

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
        imagePath: attachedImagePath,
        docPath: attachedDocPath,
        source: isGroup ? 'telegram_group' : 'telegram'
      });

      clearInterval(typingInterval);

      // Auto-delete the "Sedang diproses..." status message so the chat stays clean and tidy
      if (progressMsgId) {
        await this.deleteMessage(chatId, progressMsgId).catch(() => {});
      }

      // Send final text reply
      const replyText = taskResult.text || '✅ Permintaan selesai dikerjakan.';
      await this.sendMessage(chatId, replyText, threadId);

    } catch (err) {
      clearInterval(typingInterval);

      // Also clean up the status message on error
      if (progressMsgId) {
        await this.deleteMessage(chatId, progressMsgId).catch(() => {});
      }

      await this.sendMessage(chatId, `❌ *Terjadi Kesalahan saat memproses permintaan:*\n\`${err.message}\``, threadId);
    }
  }

  /**
   * Generate an adaptive, context-aware progress acknowledgment based on the prompt
   */
  buildAdaptiveProgressMessage(prompt, options = {}) {
    const { hasPhoto, hasDocument, docName } = options;
    const cleanPrompt = prompt.replace(/^\/[a-zA-Z0-9_-]+\s*/, '').trim();

    // 1. Photo with caption or vision analysis
    if (hasPhoto) {
      if (cleanPrompt && cleanPrompt.length > 3) {
        const snippet = cleanPrompt.length > 50 ? cleanPrompt.substring(0, 47) + '...' : cleanPrompt;
        return `🖼️ *Menganalisis Gambar & Instruksi: "${snippet}"*\n⏳ _Gemini Vision sedang memeriksa gambar dan memproses permintaan Anda..._\n⏱️ _Estimasi: ~30-60 detik. Pesan ini otomatis dihapus saat selesai._`;
      }
      return `🖼️ *Menganalisis Gambar...*\n⏳ _Gemini Vision sedang memeriksa dan menganalisis gambar Anda..._\n⏱️ _Estimasi: ~30-60 detik. Pesan ini otomatis dihapus saat selesai._`;
    }

    // 2. Document upload
    if (hasDocument) {
      return `📄 *Membaca File: \`${docName || 'Dokumen'}\`*\n⏳ _AI Agent sedang membaca dan menganalisis isi file dokumen di server VPS..._\n⏱️ _Estimasi: ~30-60 detik. Pesan ini otomatis dihapus saat selesai._`;
    }

    const lower = prompt.toLowerCase();

    // 3. Inquiry / Looking for previous output files (e.g. "mana videonya", "mana filenya", "kirim lagi")
    const isFileInquiry = /(?:mana|belum ada|belum masuk|kirim ulang|mana link|mana hasil)\s+(?:video|reels|file|klip|gambar|hasilnya|videonya)/i.test(prompt) ||
      /^(?:mana|kirim)\s+(?:videonya|filenya|hasilnya|videony)\??$/i.test(cleanPrompt);
    if (isFileInquiry) {
      return `🔎 *Mencari & Mengambil File Hasil di Server VPS...*\n⏳ _Sedang memeriksa file output terbaru dan menyiapkan pengiriman ke Telegram..._\n⏱️ _Estimasi: ~10-25 detik. Pesan ini otomatis dihapus saat file terkirim._`;
    }

    // 4. Integrations & Credentials (e.g. "bisa masukan token facebook", "upload otomatis ke facebook", "token fb", "access token")
    const isIntegrationOrToken = /(?:token|facebook|fb\b|page id|access token|api key|upload otomatis|integrasi)/i.test(prompt);
    if (isIntegrationOrToken && (lower.includes('token') || lower.includes('facebook') || lower.includes('fb') || lower.includes('integrasi') || lower.includes('upload otomatis'))) {
      if (lower.includes('eaab') || lower.includes('page id') || prompt.length > 70) {
        return `🔐 *Menyimpan Token & Konfigurasi Integrasi...*\n⏳ _Sedang memvalidasi dan menyimpan kredensial ke database server VPS..._\n⏱️ _Estimasi: ~10-25 detik. Pesan ini otomatis dihapus saat selesai._`;
      }
      return `⚡ *Menganalisis Integrasi & Otomasi...*\n🤖 _Gemini sedang menyiapkan konfigurasi dan instruksi integrasi server..._\n⏱️ _Estimasi: ~10-25 detik. Pesan ini otomatis dihapus saat selesai._`;
    }

    // 5. Memory & Settings (e.g. "simpen settingan memori", "shared memory", "simpan persona")
    const isMemoryOrSettings = /(?:memori|memory|simpan settingan|simpen settingan|save memory|shared memory|persona|catat|ingat)/i.test(prompt);
    if (isMemoryOrSettings) {
      return `🧠 *Memperbarui Memori & Pengaturan Server...*\n⏳ _Sedang menyimpan catatan preferensi ke database VPS..._\n⏱️ _Estimasi: ~10-25 detik. Pesan ini otomatis dihapus saat selesai._`;
    }

    // 5. Reels / Video Creation (STRICT: only if explicitly asking to create, cut, render, or generate video)
    const isExplicitVideoRender = /(?:bikin|buat|render|potong|klip|generate|download|unduh)\s+(?:video|reels|klip|clip|yt|youtube)/i.test(prompt) ||
      /^(?:buatkan|bikinin|render)\s+.*(?:reels|video)/i.test(cleanPrompt) ||
      cleanPrompt.startsWith('/reels');

    if (isExplicitVideoRender) {
      let topic = '';
      const topicMatch = prompt.match(/(?:bertema|tentang|judul|mengenai|tema)\s+['"]?([^'"\n.,]+)['"]?/i);
      if (topicMatch && topicMatch[1] && topicMatch[1].length > 2) {
        topic = topicMatch[1].trim();
      } else {
        const words = cleanPrompt.replace(/buatkan|bikin|tolong|coba|render|reels|video/gi, '').trim();
        if (words.length > 3) topic = words.substring(0, 35);
      }
      const topicLabel = topic ? `: "${topic}"` : '';
      return `🎬 *Merender Video Reels${topicLabel}*\n⏳ _Sedang mencari materi, memotong klip, dan merender video FFmpeg di VPS..._\n⏱️ _Estimasi: ~1 - 3 menit. Pesan ini otomatis dihapus saat video siap._`;
    }

    // 6. Script generation or downloader
    if (lower.includes('script') || lower.includes('skrip') || lower.includes('bikin program') || lower.includes('buat kode') || lower.includes('bikin bot') || lower.includes('download')) {
      let taskSubject = '';
      const subjMatch = prompt.match(/(?:script|skrip|bikin|buat|download)\s+([^.,\n]+)/i);
      if (subjMatch && subjMatch[1]) {
        taskSubject = subjMatch[1].trim().substring(0, 35);
      }
      const label = taskSubject ? `: "${taskSubject}"` : '';
      return `⚙️ *Menyusun & Menguji Script${label}*\n⏳ _Sedang menulis kode, memeriksa dependensi, dan mengeksekusinya di server..._\n⏱️ _Estimasi: ~30-90 detik. Pesan ini otomatis dihapus saat selesai._`;
    }

    // 7. Analysis / System Admin / Server Check
    if (lower.includes('analisa') || lower.includes('analisis') || lower.includes('cek server') || lower.includes('cek vps') || lower.includes('monitor') || lower.includes('ram') || lower.includes('cpu') || lower.includes('disk') || lower.includes('pm2')) {
      let focus = '';
      if (lower.includes('ram')) focus = 'RAM ';
      if (lower.includes('cpu')) focus += 'CPU ';
      if (lower.includes('disk')) focus += 'Disk ';
      if (lower.includes('pm2')) focus += 'PM2 ';
      const focusLabel = focus ? ` (${focus.trim()})` : '';
      return `🔍 *Menganalisis Sistem Server${focusLabel}...*\n⏳ _Sedang mengumpulkan metrik, membaca log, dan menyusun laporan analitik..._\n⏱️ _Estimasi: ~20-45 detik. Pesan ini otomatis dihapus saat selesai._`;
    }

    // 8. Skill installation
    if (lower.includes('skill') || lower.includes('install skill') || lower.includes('pasang skill')) {
      const skillName = cleanPrompt.replace(/install|pasang|skill|tolong|buatkan/gi, '').trim().substring(0, 25);
      const sLabel = skillName ? `: "${skillName}"` : '';
      return `🛠️ *Menyiapkan & Menginstall Skill${sLabel}*\n⏳ _Sedang menyusun instruksi SKILL.md dan mendaftarkannya ke server..._\n⏱️ _Estimasi: ~20-40 detik. Pesan ini otomatis dihapus saat selesai._`;
    }

    // 9. Clarification response or short answers (e.g. "1", "ya", "youtube", "lanjutkan")
    if (cleanPrompt.length <= 15) {
      return `⚡ *Memproses Jawaban: "${cleanPrompt}"*\n🤖 _Gemini sedang melanjutkan instruksi berdasarkan preferensi Anda..._\n⏱️ _Estimasi: ~15-30 detik. Pesan ini otomatis dihapus saat selesai._`;
    }

    // 10. General conversational / customized prompt
    const snippet = cleanPrompt.length > 45 ? cleanPrompt.substring(0, 42) + '...' : cleanPrompt;
    return `🤖 *Mengeksekusi: "${snippet}"*\n⏳ _AI Agent di VPS sedang memproses permintaan Anda..._\n⏱️ _Estimasi: ~20-60 detik. Pesan ini otomatis dihapus saat selesai._`;
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

  async deleteMessage(chatId, messageId) {
    if (!chatId || !messageId) return false;
    try {
      const url = this.getApiUrl('deleteMessage');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId
        })
      });
      const data = await res.json();
      return data.ok;
    } catch (err) {
      console.error('[TELEGRAM] Gagal hapus status message:', err.message);
      return false;
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

    const stats = fs.statSync(fullPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    if (fileSizeMB > 49.5) {
      throw new Error(`Ukuran file (${fileSizeMB.toFixed(1)} MB) melebihi batas upload Telegram Bot API (maksimal 50 MB). File tetap tersimpan di server.`);
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

      // Try sendVideo first, but if Telegram rejects it (e.g. video codec, bitrate, or metadata issue),
      // automatically fallback to sendDocument so the file is ALWAYS delivered to the user!
      try {
        if (process.platform === 'linux') {
          return await this.sendFileViaCurl(method, field, chatId, fullPath, caption, threadId);
        }
        return await this.sendFileViaFetch(method, field, chatId, fullPath, caption, threadId);
      } catch (videoErr) {
        console.warn('[TELEGRAM] sendVideo gagal, fallback otomatis ke sendDocument:', videoErr.message);
        method = 'sendDocument';
        field = 'document';
        await this.sendChatAction(chatId, 'upload_document', threadId);
        if (process.platform === 'linux') {
          return await this.sendFileViaCurl(method, field, chatId, fullPath, caption, threadId);
        }
        return await this.sendFileViaFetch(method, field, chatId, fullPath, caption, threadId);
      }
    } else if (isPhoto) {
      method = 'sendPhoto';
      field = 'photo';
      await this.sendChatAction(chatId, 'upload_photo', threadId);
    } else {
      await this.sendChatAction(chatId, 'upload_document', threadId);
    }

    // On Linux / Debian VPS, prefer native curl for 100% reliable multipart upload without undici memory bloat or streaming stalls
    if (process.platform === 'linux') {
      try {
        return await this.sendFileViaCurl(method, field, chatId, fullPath, caption, threadId);
      } catch (curlErr) {
        console.warn('[TELEGRAM] Upload via curl gagal, fallback ke fetch:', curlErr.message);
      }
    }

    return await this.sendFileViaFetch(method, field, chatId, fullPath, caption, threadId);
  }

  async sendFileViaCurl(method, field, chatId, fullPath, caption, threadId) {
    const { execFile } = require('child_process');
    const token = this.getToken();
    const url = `https://api.telegram.org/bot${token}/${method}`;

    const args = [
      '-s',
      '--max-time', '180', // 3 minutes timeout
      '-X', 'POST', url,
      '-F', `chat_id=${chatId}`
    ];
    if (threadId) {
      args.push('-F', `message_thread_id=${threadId}`);
    }
    if (caption) {
      args.push('-F', `caption=${caption.substring(0, 1024)}`);
    }
    args.push('-F', `${field}=@${fullPath}`);

    return new Promise((resolve, reject) => {
      execFile('curl', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`curl upload error: ${err.message}`));
        }
        try {
          const res = JSON.parse(stdout);
          if (!res.ok) {
            return reject(new Error(`Telegram API rejected: ${res.description || 'Unknown error'}`));
          }
          resolve(res);
        } catch (e) {
          reject(new Error(`Gagal parse respon Telegram upload: ${stdout.substring(0, 200)}`));
        }
      });
    });
  }

  async sendFileViaFetch(method, field, chatId, fullPath, caption, threadId) {
    const url = this.getApiUrl(method);
    const fileBuffer = fs.readFileSync(fullPath);
    const fileName = path.basename(fullPath);

    const formData = new FormData();
    formData.append('chat_id', chatId);
    if (threadId) formData.append('message_thread_id', String(threadId));
    if (caption) formData.append('caption', caption.substring(0, 1024));

    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
    formData.append(field, new Blob([fileBuffer], { type: mimeType }), fileName);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000); // 3 minutes max

    try {
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      const data = await res.json();
      if (!data.ok) {
        throw new Error(`Telegram upload failed: ${data.description || 'Unknown error'}`);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async downloadTelegramFile(fileId, savePath) {
    const getFileUrl = this.getApiUrl('getFile');
    const res = await fetch(`${getFileUrl}?file_id=${fileId}`);
    const data = await res.json();
    if (!data.ok || !data.result || !data.result.file_path) {
      throw new Error(`Gagal mengambil info file Telegram: ${data.description || 'Unknown error'}`);
    }

    const token = this.getToken();
    const downloadUrl = `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) {
      throw new Error(`Gagal mendownload file dari Telegram API: ${fileRes.statusText}`);
    }

    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(savePath, buffer);
    return savePath;
  }
}

module.exports = new TelegramService();
