const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const logger = require('./logger');
const circuitBreaker = require('./circuit-breaker');
const oauthService = require('./oauth-service');
const sharedMemory = require('./shared-memory');
const terminalTool = require('./tools/terminal-tool');
const fileTools = require('./tools/file-tools');
const telegramTool = require('./tools/telegram-tool');

const SYSTEM_INSTRUCTION = `Anda adalah Gemini AI Agent Otonom (Hermes Swarm + 9router Edition) yang berjalan langsung di server VPS Debian (10.69.69.53) dan diakses melalui Telegram.
Anda bertindak sebagai Full-Stack AI Engineer, DevOps Administrator, dan Content Specialist pribadi pengguna. Anda memiliki akses penuh ke terminal shell Linux (Bash) dan file sistem server untuk menganalisis apa pun, membuat script apa pun, dan mengeksekusinya secara otonom.

IDENTITAS & KARAKTER UTAMA (GEMINI TELEGRAM EDITION):
1. Anda adalah Gemini versi server Telegram: cerdas, berinisiatif tinggi, tidak bertele-tele, responsif, dan mampu mengotomasi apapun di Linux.
2. Anda bisa menganalisis kode, log server, performa CPU/RAM/Disk, network, harga crypto, hingga konten media/video.
3. Anda bisa membuat, menguji, dan menjalankan script (Python, Node.js, Bash, SQL, FFmpeg) secara mandiri di server.

PROTOKOL KLARIFIKASI INTERAKTIF & FEEDBACK PERTANYAAN (HERMES INTERVIEW LOOP):
Jika permintaan pengguna terasa kurang informasi, ambigu, atau memerlukan spesifikasi penting sebelum dieksekusi (contoh: "bikin script download", "buatkan script analisa", "bikin video reels", "setup cronjob" tanpa menyebutkan sumber, format, atau jadwal):
- JANGAN berasumsi liar atau memberikan kode acak tanpa kepastian.
- Ajukan pertanyaan klarifikasi proaktif yang ramah, padat, dan sertakan opsi bernomor (1, 2, 3...) yang jelas agar pengguna mudah membalas dari smartphone/Telegram.
- Jelaskan secara ringkas opsi apa yang paling Anda rekomendasikan dan tanyakan apakah ingin langsung dieksekusi.
- Karena sistem memiliki memori percakapan berlanjut (multi-turn), saat pengguna menjawab dengan "1" atau menyebutkan pilihannya, Anda dapat langsung melanjutkan pengerjaannya secara tuntas!

KEMAMPUAN SERVER & SKRIPTING MANDIRI:
1. Pembuatan & Eksekusi Script Download:
   - Mampu membuat script downloader (YouTube via yt-dlp, media sosial, scraper web, API downloader).
   - Menjalankan download dan menyimpan hasil di 'data/temp/' atau 'data/output/'.
2. Script Analisis & Pengolahan Data:
   - Mampu membuat script Python/Node.js untuk menganalisis data, parsing teks/CSV/JSON, visualisasi grafik chart, scraping informasi publik, atau pengecekan sistem.
3. Pemrosesan Media & Reels Otomatis:
   - Mengunduh video, potong highlight viral, subtitle audio otomatis, dan render rasio 16:9 / 9:16 menggunakan FFmpeg.
   - Hasil render di 'data/output/' otomatis dikirim langsung ke Telegram pengguna.

FITUR INSTALASI SKILL OTONOM (HERMES SKILLS SYSTEM):
Jika pengguna meminta menginstall skill atau Anda membutuhkan keahlian baru:
1. Anda memiliki wewenang penuh membuat file petunjuk skill di '.agents/skills/<nama-skill>/SKILL.md' (YAML frontmatter name & description + panduan langkah instruksi).
2. Jika skill butuh script helper (Python/JS), buat script tersebut di folder 'scripts/'.
3. Jika butuh library eksternal (pip install / npm install), pasang atau sebutkan kebutuhannya.
4. Sertakan tag: [INSTALL_SKILL: {"name": "nama-skill", "description": "deskripsi fungsi", "instruction": "panduan"}] di respon Anda agar server otomatis mendaftarkan skill tersebut ke topic persona ini.

FITUR AUTO-SYNTHESIS PERSONA PER-TOPIC (HERMES AGENT):
Jika pengguna meminta Anda menjadi karakter atau peran khusus di chat/topic ini ("mulai sekarang jadilah konsultan crypto", "jadilah sysadmin debian", "topic ini khusus reels"):
1. Terima peran baru dengan antusias.
2. Sertakan tag: [SAVE_PERSONA: {"name": "Nama Peran", "icon": "Emoji", "description": "Tugas utama", "instruction": "Instruksi gaya bicara & fokus", "model": "gemini-3.8-flash-low", "skills": ["skill1", "skill2"]}] di akhir respon Anda.

FITUR MULTI-ACCOUNT & SHARED MEMORY (9ROUTER):
Server ini mendukung multi-akun AI Google dengan memori bersama (Shared Memory) dan circuit breaker anti-403 yang menjaga kontinuitas tugas 24/7.

PANDUAN EKSEKUSI PENTING:
- Bertindaklah otonom: jika butuh file baru atau library, tuliskan dan install secara mandiri.
- Selalu periksa output terminal sebelum lanjut ke langkah berikutnya.
- Jika tugas menghasilkan file video/gambar (MP4, PNG, JPG), sebutkan nama file output lengkapnya di jawaban akhir agar sistem otomatis mengirimkannya ke Telegram.
- Jawablah dengan ringkas, profesional, dan gunakan Bahasa Indonesia yang ramah.`;

function resolveAgyPath() {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || 'C:\\Users\\AAY\\AppData\\Local', 'agy', 'bin', 'agy.exe'),
      path.join(process.env.USERPROFILE || 'C:\\Users\\AAY', '.gemini', 'antigravity', 'bin', 'agy.exe'),
      'C:\\Users\\AAY\\AppData\\Local\\agy\\bin\\agy.exe'
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return 'agy';
}

class AgentEngine {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  /**
   * Enqueue a new prompt task
   * @param {object} task { prompt, user, chatId, source: 'telegram'|'web', callback }
   */
  async submitTask(task) {
    logger.logPrompt(task.user || 'Admin', task.prompt, task.chatId);

    return new Promise((resolve, reject) => {
      this.queue.push({
        ...task,
        resolve,
        reject,
        queuedAt: Date.now()
      });
      this.processQueue();
    });
  }

  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing
    };
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    // Check circuit breaker
    const breakerCheck = circuitBreaker.canExecute();
    if (!breakerCheck.allowed) {
      if (breakerCheck.remainingSec > 0) {
        logger.logBreaker('cooldown', breakerCheck.reason, breakerCheck.remainingSec);
      }
      return;
    }

    const task = this.queue.shift();
    this.isProcessing = true;
    circuitBreaker.acquireExecution();

    try {
      const result = await this.executeTask(task);
      circuitBreaker.recordSuccess(result.tokensEstimated || 500);
      task.resolve(result);
    } catch (err) {
      logger.logError(`Gagal Memproses Task (${task.prompt.slice(0, 40)})`, err);
      circuitBreaker.recordFailure(err);
      task.reject(err);
    } finally {
      circuitBreaker.releaseExecution();
      this.isProcessing = false;
      // Schedule next item
      setTimeout(() => this.processQueue(), 500);
    }
  }

  /**
   * Execute the task depending on the selected engine
   */
  async executeTask(task) {
    const settings = db.getSettings();
    const engine = settings.active_engine || 'agy';

    // Retrieve active Topic Persona if this message is inside a topic
    let persona = null;
    if (task.threadId) {
      persona = db.getTopicPersona(task.threadId);
      if (persona) {
        logger.logInfo(`Topic Persona Aktif [#${task.threadId}]: ${persona.icon} ${persona.name}`, `Model: ${persona.model || settings.active_model}`);
      }
    }

    // Merge settings with persona overrides (model & persona instruction)
    const effectiveSettings = {
      ...settings,
      active_model: (persona && persona.model) ? persona.model : (settings.active_model || 'gemini-3.8-flash-low'),
      active_persona: persona
    };

    let result;
    if (engine === 'agy') {
      try {
        result = await this.executeAgyCLI(task, effectiveSettings);
      } catch (agyErr) {
        logger.logInfo('Agy CLI Mengalami Kendala / Timeout', `${agyErr.message}. Mencoba fallback ke Gemini Native Engine...`);
        try {
          result = await this.executeGeminiNative(task, effectiveSettings);
        } catch (fallbackErr) {
          throw agyErr; // Return original descriptive agy error if fallback also fails
        }
      }
    } else {
      result = await this.executeGeminiNative(task, effectiveSettings);
    }

    // Auto-detect and persist dynamically synthesized persona from response
    if (result.text && result.text.includes('[SAVE_PERSONA:')) {
      const match = result.text.match(/\[SAVE_PERSONA:\s*(\{.+?\})\]/s);
      if (match) {
        try {
          const personaObj = JSON.parse(match[1]);
          const targetThread = task.threadId || task.chatId;
          const saved = db.setTopicPersona(targetThread, personaObj);
          logger.logInfo(`Persona Otomatis Disintesis & Disimpan [#${targetThread}]`, `${saved.icon} ${saved.name}`);
          persona = saved;
          result.text = result.text.replace(/\[SAVE_PERSONA:\s*\{.+?\}\]/s, '').trim();
        } catch (e) {
          console.error('[AGENT] Gagal parse SAVE_PERSONA JSON:', e.message);
        }
      }
    }

    // Auto-detect and persist dynamically installed skills from response
    if (result.text && result.text.includes('[INSTALL_SKILL:')) {
      const match = result.text.match(/\[INSTALL_SKILL:\s*(\{.+?\})\]/s);
      if (match) {
        try {
          const skillObj = JSON.parse(match[1]);
          const targetThread = task.threadId || task.chatId;
          const skillName = skillObj.name ? skillObj.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-') : 'custom-skill';
          
          // Ensure .agents/skills/<skillName>/SKILL.md exists on disk
          const skillDir = path.join(__dirname, '..', '.agents', 'skills', skillName);
          const skillFile = path.join(skillDir, 'SKILL.md');
          if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
          }
          if (!fs.existsSync(skillFile)) {
            const skillContent = `---\nname: ${skillName}\ndescription: ${skillObj.description || 'Skill kustom yang diinstal oleh agen'}\n---\n\n# ${skillObj.name || skillName}\n${skillObj.instruction || skillObj.description || 'Panduan eksekusi skill.'}\n`;
            fs.writeFileSync(skillFile, skillContent, 'utf8');
          }

          db.addTopicSkill(targetThread, skillName);
          logger.logInfo(`Skill Berhasil Diinstall [#${targetThread}]`, `${skillName}: ${skillObj.description || ''}`);
          result.text = result.text.replace(/\[INSTALL_SKILL:\s*\{.+?\}\]/s, '').trim();
        } catch (e) {
          console.error('[AGENT] Gagal parse INSTALL_SKILL JSON:', e.message);
        }
      }
    }

    // Save to multi-turn conversation memory
    const sessionId = task.threadId || task.chatId;
    if (sessionId && task.prompt && result.text) {
      db.addConversationMessage(sessionId, 'user', task.prompt);
      db.addConversationMessage(sessionId, 'model', result.text);
    }

    // If inside a topic with a persona, badge the text nicely
    if (persona && result.text && !result.text.includes(persona.name)) {
      result.text = `${persona.icon} *[${persona.name}]*\n\n${result.text}`;
    }

    return result;
  }

  /**
   * Engine 1: Native Antigravity CLI (agy) Execution (The Munder-Difflin Way, 100% Anti-403)
   */
  async executeAgyCLI(task, settings) {
    const modelName = settings.active_model || 'gemini-3.8-flash-low';
    logger.logInfo('Menjalankan Engine: Antigravity CLI (agy)', `Model: ${modelName}`);

    const agyPath = resolveAgyPath();
    const sharedContext = sharedMemory.getSystemContext();
    const persona = settings.active_persona;
    const personaInstruction = persona ? `\n\nPERAN KHUSUS ANDA DI TOPIC INI:\n${persona.instruction}` : '';
    
    // Inject multi-turn conversation memory for seamless interactive clarifications
    const sessionId = task.threadId || task.chatId;
    const history = db.getConversationHistory(sessionId, 6);
    let historyText = '';
    if (history.length > 0) {
      historyText = `\n\n[RIWAYAT PERCAKAPAN SEBELUMNYA DI TOPIC/CHAT INI]:\n` +
        history.map(h => `${h.role === 'user' ? 'User' : 'Gemini Agent'}: ${h.text}`).join('\n') + `\n[AKHIR RIWAYAT PERCAKAPAN]\n`;
    }

    let mediaNote = '';
    if (task.imagePath) {
      mediaNote += `\n\n[FILE GAMBAR TERLAMPIR DARI USER]:\nPath: "${task.imagePath}"\nSilakan gunakan tool yang relevan (seperti read_file atau python script) untuk memeriksa dan menganalisis gambar ini.`;
    }
    if (task.docPath) {
      mediaNote += `\n\n[FILE DOKUMEN TERLAMPIR DARI USER]:\nPath: "${task.docPath}"\nSilakan baca file tersebut menggunakan tool file_read atau terminal.`;
    }

    const fullPrompt = `${SYSTEM_INSTRUCTION}${personaInstruction}\n${sharedContext}${historyText}${mediaNote}\n\n[USER REQUEST (${task.user || 'Admin'}) via ${task.source || 'console'}]:\n${task.prompt}\n\nCatatan Penting:\n1. Jika membuat file video/reels, gunakan helper 'python scripts/clipper-helper.py' dan simpan di 'data/output'.\n2. Jika membuat file gambar/chart/visual, simpan di 'data/output'.\n3. Sebutkan nama file output lengkapnya di jawaban akhir agar sistem otomatis mengirimkannya ke Telegram.`;

    logger.logToolCall('agy_cli', `agy -p ... --model ${modelName}`);

    const args = [
      '-p', fullPrompt,
      '--model', modelName,
      '--dangerously-skip-permissions',
      '--disable-slash-commands'
    ];

    const { spawn } = require('child_process');
    const isMediaTask = /video|reels|clip|download|render|mp4|podcast/i.test(task.prompt);
    const timeoutMs = isMediaTask ? 900000 : 600000; // 15 minutes for media processing, 10 minutes default for background tasks

    const result = await new Promise((resolve, reject) => {
      const child = spawn(agyPath, args, {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'], // Immediately close stdin so CLI does not block on EOF
        windowsHide: true,
        timeout: timeoutMs
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Gagal menjalankan agy CLI: ${err.message}`));
      });

      child.on('close', (code) => {
        const cleanOut = stdout.trim();
        const cleanErr = stderr.trim();
        if (code !== 0 && !cleanOut) {
          const isInterrupted = cleanErr.includes('interrupted') || cleanErr.includes('waiting for') || cleanErr.includes('idle');
          if (isInterrupted) {
            return reject(new Error(`Proses latar belakang di VPS memerlukan waktu pemrosesan lebih lama (melebihi batas timeout 10-15 menit) atau terhenti. Silakan periksa kembali atau gunakan instruksi yang lebih spesifik.`));
          }
          return reject(new Error(`agy CLI keluar dengan exit code ${code}: ${cleanErr || 'Unknown error'}`));
        }
        resolve(cleanOut || cleanErr || 'Tugas selesai diproses.');
      });
    });

    logger.logResponse(result);

    // Look for generated files to send to Telegram (e.g. mp4 videos in data/output)
    const sentFiles = await this.checkForOutputFiles(task.chatId, result, task.threadId);

    db.addTaskHistory({
      prompt: task.prompt,
      user: task.user,
      engine: 'agy',
      model: settings.active_model,
      response: result,
      filesSent: sentFiles
    });

    return {
      text: result,
      filesSent: sentFiles,
      tokensEstimated: Math.round((task.prompt.length + result.length) / 3)
    };
  }

  /**
   * Engine 2: Native Gemini ReAct Engine with Function Calling
   */
  async executeGeminiNative(task, settings) {
    logger.logInfo('Menjalankan Engine: Gemini Native API/OAuth', `Model: ${settings.active_model}`);

    let accessToken = null;
    let apiKey = settings.gemini_api_key;
    let activeAccount = null;

    if (settings.active_engine === 'gemini_oauth') {
      try {
        activeAccount = await oauthService.getNextAvailableAccountToken();
        accessToken = activeAccount.token;
        logger.logInfo(`Menggunakan Akun Google [${activeAccount.accountIndex}/${activeAccount.totalAccounts}]`, activeAccount.email);
      } catch (authErr) {
        logger.logInfo('OAuth Fallback', `OAuth pool belum siap (${authErr.message}). Otomatis beralih ke Engine Antigravity CLI (agy) bebas 403.`);
        return await this.executeAgyCLI(task, settings);
      }
    } else if (!apiKey) {
      logger.logInfo('API Key Kosong', 'Beralih otomatis ke Engine Antigravity CLI (agy) yang terotentikasi.');
      return await this.executeAgyCLI(task, settings);
    }

    const model = settings.active_model || 'gemini-1.5-flash';
    const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const url = accessToken ? baseUrl : `${baseUrl}?key=${apiKey}`;

    // Available tools for Gemini Function Calling
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'terminal_execute',
            description: 'Mengeksekusi perintah terminal shell (PowerShell/Bash) di VPS server',
            parameters: {
              type: 'OBJECT',
              properties: {
                command: { type: 'STRING', description: 'Perintah shell yang akan dijalankan' }
              },
              required: ['command']
            }
          },
          {
            name: 'file_read',
            description: 'Membaca isi file teks di server',
            parameters: {
              type: 'OBJECT',
              properties: {
                path: { type: 'STRING', description: 'Path file relatif atau absolut' }
              },
              required: ['path']
            }
          },
          {
            name: 'file_write',
            description: 'Menulis atau membuat file teks baru di server',
            parameters: {
              type: 'OBJECT',
              properties: {
                path: { type: 'STRING', description: 'Path file' },
                content: { type: 'STRING', description: 'Isi teks file' }
              },
              required: ['path', 'content']
            }
          },
          {
            name: 'list_directory',
            description: 'Melihat daftar file dan folder dalam direktori',
            parameters: {
              type: 'OBJECT',
              properties: {
                path: { type: 'STRING', description: 'Path direktori (default: .)' }
              }
            }
          },
          {
            name: 'telegram_send_file',
            description: 'Mengirim file (video MP4, gambar, atau dokumen) ke chat Telegram pengguna',
            parameters: {
              type: 'OBJECT',
              properties: {
                file_path: { type: 'STRING', description: 'Path file yang akan dikirim' },
                caption: { type: 'STRING', description: 'Keterangan atau caption untuk file' }
              },
              required: ['file_path']
            }
          },
          {
            name: 'video_clipper',
            description: 'Mengunduh video (YouTube/link), memotong highlight, menambahkan judul atas-bawah rasio 16:9 atau 9:16 untuk FB Reels',
            parameters: {
              type: 'OBJECT',
              properties: {
                search_or_url: { type: 'STRING', description: 'URL video atau kata kunci pencarian YouTube' },
                start_time: { type: 'STRING', description: 'Waktu mulai highlight (format: 00:01:00, default: 00:00:30)' },
                duration: { type: 'STRING', description: 'Durasi dalam detik (default: 45)' },
                title_top: { type: 'STRING', description: 'Teks judul bar atas' },
                title_bottom: { type: 'STRING', description: 'Teks deskripsi bar bawah' },
                aspect_ratio: { type: 'STRING', description: 'Rasio video: 16:9 atau 9:16 (default: 16:9)' }
              },
              required: ['search_or_url', 'title_top', 'title_bottom']
            }
          },
          {
            name: 'update_shared_memory',
            description: 'Memperbarui Shared Memory (memori bersama) yang bisa dibaca dan dilanjutkan oleh akun/agen lain',
            parameters: {
              type: 'OBJECT',
              properties: {
                fact: { type: 'STRING', description: 'Fakta penting yang perlu diingat bersama oleh semua akun' },
                workspace_key: { type: 'STRING', description: 'Key status proses/pipeline (misal: current_video, highlight_time)' },
                workspace_value: { type: 'STRING', description: 'Value status' }
              }
            }
          },
          {
            name: 'set_custom_persona',
            description: 'Menyimpan persona dan keahlian baru untuk topic chat Telegram ini secara otomatis',
            parameters: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING', description: 'Nama peran persona (misal: "TikTok Content Strategist", "Linux Sysadmin")' },
                icon: { type: 'STRING', description: 'Emoji ikon (misal: "📱", "💻", "🎬", "💰")' },
                description: { type: 'STRING', description: 'Deskripsi singkat peran' },
                instruction: { type: 'STRING', description: 'Instruksi sistem dan gaya bicara persona ini' },
                model: { type: 'STRING', description: 'Model yang disarankan, misal "gemini-3.8-flash-low"' },
                skills: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Daftar keahlian' }
              },
              required: ['name', 'instruction']
            }
          }
        ]
      }
    ];

    const sharedContext = sharedMemory.getSystemContext();
    const sessionId = task.threadId || task.chatId;
    const history = db.getConversationHistory(sessionId, 6);
    let historyText = '';
    if (history.length > 0) {
      historyText = `\n\n[RIWAYAT PERCAKAPAN SEBELUMNYA DI TOPIC/CHAT INI]:\n` +
        history.map(h => `${h.role === 'user' ? 'User' : 'Gemini Agent'}: ${h.text}`).join('\n') + `\n[AKHIR RIWAYAT PERCAKAPAN]\n`;
    }

    const userParts = [
      { text: `${SYSTEM_INSTRUCTION}\n${sharedContext}${historyText}\n\nPermintaan Pengguna via Telegram (@${task.user || 'Admin'}):\n${task.prompt}` }
    ];

    if (task.imagePath && fs.existsSync(task.imagePath)) {
      try {
        const imgBuffer = fs.readFileSync(task.imagePath);
        const ext = path.extname(task.imagePath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        userParts.unshift({
          inlineData: {
            mimeType: mimeType,
            data: imgBuffer.toString('base64')
          }
        });
      } catch (imgErr) {
        console.error('[AGENT] Gagal muat inline image data:', imgErr.message);
      }
    }

    const contents = [
      {
        role: 'user',
        parts: userParts
      }
    ];

    let turns = 0;
    const maxTurns = settings.max_turns_per_prompt || 15;
    let finalResponseText = '';
    const filesSent = [];
    let totalTokens = 0;

    while (turns < maxTurns) {
      turns += 1;

      // Pacing delay to avoid burst limits
      await circuitBreaker.enforcePacingDelay();

      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Antigravity/1.0',
        'x-goog-api-client': 'gl-node/20.x gdcl/0.1.0'
      };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      logger.logThought(`Mengirim giliran ke Gemini (#${turns})...`, turns);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents,
          tools,
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        if (response.status === 403 || response.status === 429) {
          logger.logBreaker('cooldown', `Google OAuth mengembalikan status ${response.status}: Beralih otomatis ke Engine Antigravity CLI (agy) bebas 403.`);
          if (activeAccount) {
            oauthService.cooldownAccount(activeAccount.email, 600);
          }
          return await this.executeAgyCLI(task, settings);
        }
        throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
      }

      const resData = await response.json();
      const candidate = resData.candidates && resData.candidates[0];
      if (!candidate) {
        throw new Error('Tidak ada respon kandidat dari Gemini API.');
      }

      // Track usage
      if (resData.usageMetadata) {
        totalTokens += (resData.usageMetadata.totalTokenCount || 0);
      }

      const parts = candidate.content.parts || [];
      contents.push(candidate.content);

      // Check for function calls
      const functionCalls = parts.filter(p => p.functionCall);

      if (functionCalls.length === 0) {
        // No function calls: agent is done
        finalResponseText = parts.map(p => p.text || '').join('\n').trim();
        break;
      }

      // Execute function calls
      const responseParts = [];
      for (const fc of functionCalls) {
        const call = fc.functionCall;
        const toolName = call.name;
        const args = call.args || {};

        logger.logToolCall(toolName, JSON.stringify(args));
        let toolResult = null;

        try {
          if (toolName === 'terminal_execute') {
            toolResult = await terminalTool.execute(args.command);
          } else if (toolName === 'file_read') {
            toolResult = fileTools.readFile(args.path);
          } else if (toolName === 'file_write') {
            toolResult = fileTools.writeFile(args.path, args.content);
          } else if (toolName === 'list_directory') {
            toolResult = fileTools.listDirectory(args.path || '.');
          } else if (toolName === 'telegram_send_file') {
            toolResult = await telegramTool.sendFile(task.chatId, args.file_path, args.caption || '');
            if (toolResult.success) filesSent.push(args.file_path);
          } else if (toolName === 'video_clipper') {
            const scriptPath = path.join(__dirname, '..', 'scripts', 'clipper-helper.py');
            const cleanSearch = (args.search_or_url || '').replace(/"/g, '');
            const cleanTop = (args.title_top || '').replace(/"/g, '');
            const cleanBot = (args.title_bottom || '').replace(/"/g, '');
            const start = args.start_time || '00:00:30';
            const dur = args.duration || '45';
            const ratio = args.aspect_ratio || '16:9';
            const cmd = `python "${scriptPath}" --search "${cleanSearch}" --start "${start}" --duration "${dur}" --title-top "${cleanTop}" --title-bottom "${cleanBot}" --ratio "${ratio}"`;
            toolResult = await terminalTool.execute(cmd);
          } else if (toolName === 'update_shared_memory') {
            if (args.fact) sharedMemory.addFact(args.fact);
            if (args.workspace_key) {
              sharedMemory.updateWorkspace({ [args.workspace_key]: args.workspace_value }, activeAccount ? activeAccount.email : 'Gemini');
            }
            toolResult = { success: true, message: 'Shared memory berhasil diperbarui dan disinkronkan ke seluruh akun.' };
          } else if (toolName === 'set_custom_persona') {
            const targetThread = task.threadId || task.chatId;
            const saved = db.setTopicPersona(targetThread, args);
            logger.logInfo(`Persona Otomatis Disimpan via Tool [#${targetThread}]`, `${saved.icon} ${saved.name}`);
            toolResult = { success: true, message: `Persona berhasil disimpan untuk topic/chat ini: ${saved.icon} ${saved.name}` };
          } else {
            toolResult = { error: `Tool tidak dikenal: ${toolName}` };
          }
        } catch (toolErr) {
          toolResult = { error: toolErr.message };
        }

        responseParts.push({
          functionResponse: {
            name: toolName,
            response: { result: toolResult }
          }
        });
      }

      contents.push({
        role: 'user',
        parts: responseParts
      });
    }

    if (!finalResponseText) {
      finalResponseText = 'Tugas selesai diproses oleh AI Agent.';
    }

    logger.logResponse(finalResponseText, { totalTokens });

    // Look for generated files to send to Telegram
    const additionalFiles = await this.checkForOutputFiles(task.chatId, finalResponseText, task.threadId);
    const allFilesSent = [...filesSent, ...additionalFiles];

    db.addTaskHistory({
      prompt: task.prompt,
      user: task.user,
      engine: settings.active_engine,
      model: settings.active_model,
      response: finalResponseText,
      filesSent: allFilesSent
    });

    return {
      text: finalResponseText,
      filesSent: allFilesSent,
      tokensEstimated: totalTokens || Math.round((task.prompt.length + finalResponseText.length) / 3)
    };
  }

  /**
   * Scan response text or output folder for created video/media/image files and auto-send to Telegram
   */
  async checkForOutputFiles(chatId, responseText, threadId = null) {
    const sent = [];
    if (!chatId) return sent;

    // Check regex for file paths mentioned in response (mp4, webm, png, jpg, jpeg, webp)
    const match = responseText.match(/(?:data[\\/]output[\\/][a-zA-Z0-9_\-.]+\.(?:mp4|webm|png|jpg|jpeg|webp)|[a-zA-Z0-9_\-.]+\.(?:mp4|webm|png|jpg|jpeg|webp))/gi);
    if (match) {
      for (const rawPath of match) {
        let fullPath = path.resolve(rawPath);
        if (!fs.existsSync(fullPath)) {
          fullPath = path.join(__dirname, '..', rawPath);
        }
        if (fs.existsSync(fullPath)) {
          try {
            const ext = path.extname(fullPath).toLowerCase();
            const isVideo = ['.mp4', '.webm', '.mov'].includes(ext);
            const caption = isVideo ? '🎬 Video hasil Reels Anda sudah siap!' : '🖼️ File gambar hasil permintaan Anda:';

            // Send file with timeout safety (180s max) so it can never hang indefinitely
            const uploadPromise = telegramTool.sendFile(chatId, fullPath, caption, threadId);
            const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('Upload file timeout (180 detik)')), 180000));
            const uploadRes = await Promise.race([uploadPromise, timeoutPromise]);
            if (uploadRes && uploadRes.success) {
              sent.push(fullPath);
            }
          } catch (e) {
            console.error('[AGENT] Gagal auto-send file ke Telegram:', e.message);
            try {
              await telegramTool.sendMessage(chatId, `⚠️ *Catatan Pengiriman File:*\nFile \`${path.basename(fullPath)}\` berhasil selesai dibuat di server (\`${fullPath}\`), namun gagal terunggah ke Telegram: _${e.message}_`, threadId);
            } catch (notifyErr) {}
          }
        }
      }
    }
    return sent;
  }
}

module.exports = new AgentEngine();
