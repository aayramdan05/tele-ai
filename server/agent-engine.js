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

const SYSTEM_INSTRUCTION = `Anda adalah asisten AI Agent otonom yang berjalan di server VPS lokal (10.69.69.53).
Anda menerima perintah langsung melalui chat Telegram. Anda memiliki akses penuh ke terminal dan file sistem server untuk mengeksekusi apapun yang diminta pengguna.

FITUR MULTI-ACCOUNT & SHARED MEMORY:
Server ini mendukung multi-akun AI Google yang berbagi memori bersama (Shared Memory). Anda dapat membaca status dari akun lain dan menyimpan informasi penting ke memori bersama agar dapat dilanjutkan secara mulus oleh akun lain.

KEMAMPUAN ANDA:
1. Mengeksekusi perintah terminal (PowerShell di Windows, Bash di Linux).
2. Membaca dan menulis file script, kode program (Python, Node.js, Shell, dll).
3. Mengunduh video (yt-dlp), memproses audio (Whisper), memotong dan merender video (FFmpeg).
4. Mengirimkan file hasil jadi (video MP4, gambar, dokumen) langsung ke chat Telegram pengguna.
5. Membaca dan memperbarui Shared Memory (memori bersama antar-akun).
6. Mengatur dan mengelola penjadwalan (cronjob, background task).

PANDUAN EKSEKUSI PENTING:
- Bertindaklah otonom: jika butuh file baru atau library, tuliskan dan install secara mandiri.
- Selalu periksa output terminal sebelum lanjut ke langkah berikutnya.
- Jika tugas menghasilkan file video (misal Reels 16:9 atau 9:16), kirimkan file tersebut ke Telegram menggunakan tool pengiriman file.
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

    if (engine === 'agy') {
      return await this.executeAgyCLI(task, settings);
    } else {
      return await this.executeGeminiNative(task, settings);
    }
  }

  /**
   * Engine 1: Native Antigravity CLI (agy) Execution (The Munder-Difflin Way, 100% Anti-403)
   */
  async executeAgyCLI(task, settings) {
    const modelName = settings.active_model || 'gemini-3.8-flash-high';
    logger.logInfo('Menjalankan Engine: Antigravity CLI (agy)', `Model: ${modelName}`);

    const agyPath = resolveAgyPath();
    const sharedContext = sharedMemory.getSystemContext();
    const fullPrompt = `${SYSTEM_INSTRUCTION}\n${sharedContext}\n\n[USER REQUEST (${task.user || 'Admin'}) via ${task.source || 'console'}]:\n${task.prompt}\n\nCatatan Penting:\n1. Jika membuat file video/reels, gunakan helper 'python scripts/clipper-helper.py' dan simpan di 'data/output'.\n2. Sebutkan nama file output lengkapnya di jawaban akhir agar sistem otomatis mengirimkannya ke Telegram.`;

    logger.logToolCall('agy_cli', `agy -p ... --model ${modelName}`);

    const args = [
      '-p', fullPrompt,
      '--model', modelName,
      '--dangerously-skip-permissions',
      '--disable-slash-commands'
    ];

    const { spawn } = require('child_process');

    const result = await new Promise((resolve, reject) => {
      const child = spawn(agyPath, args, {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'], // Immediately close stdin so CLI does not block on EOF
        windowsHide: true,
        timeout: 120000 // 2 minutes max
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
          }
        ]
      }
    ];

    const sharedContext = sharedMemory.getSystemContext();
    const contents = [
      {
        role: 'user',
        parts: [
          { text: `${SYSTEM_INSTRUCTION}\n${sharedContext}\n\nPermintaan Pengguna via Telegram (@${task.user || 'Admin'}):\n${task.prompt}` }
        ]
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
   * Scan response text or output folder for created video/media files and auto-send to Telegram
   */
  async checkForOutputFiles(chatId, responseText, threadId = null) {
    const sent = [];
    if (!chatId) return sent;

    // Check regex for file paths mentioned in response (e.g. data/output/*.mp4)
    const match = responseText.match(/(?:data[\\/]output[\\/][a-zA-Z0-9_\-.]+\.mp4|[a-zA-Z0-9_\-.]+\.mp4)/gi);
    if (match) {
      for (const rawPath of match) {
        let fullPath = path.resolve(rawPath);
        if (!fs.existsSync(fullPath)) {
          fullPath = path.join(__dirname, '..', rawPath);
        }
        if (fs.existsSync(fullPath)) {
          try {
            await telegramTool.sendFile(chatId, fullPath, '🎬 Video hasil Reels Anda sudah siap!', threadId);
            sent.push(fullPath);
          } catch (e) {
            console.error('[AGENT] Gagal auto-send file:', e.message);
          }
        }
      }
    }
    return sent;
  }
}

module.exports = new AgentEngine();
