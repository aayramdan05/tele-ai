const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const cors = require('cors');

const db = require('./database');
const config = require('./config');
const logger = require('./logger');
const quotaTracker = require('./quota-tracker');
const circuitBreaker = require('./circuit-breaker');
const oauthService = require('./oauth-service');
const sharedMemory = require('./shared-memory');
const agentEngine = require('./agent-engine');
const telegramService = require('./telegram-service');
const cronService = require('./cron-service');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static Web UI
app.use(express.static(path.join(__dirname, '..', 'public')));

// Register WebSocket clients to logger for Live Flow Monitor
wss.on('connection', (ws) => {
  logger.registerWsClient(ws);
  // Send initial welcome & stats
  ws.send(JSON.stringify({
    type: 'connected',
    data: {
      message: 'Connected to Tele-AI Live Stream',
      stats: quotaTracker.getStats()
    }
  }));
});

// Periodic broadcast of metrics (every 3 seconds)
setInterval(() => {
  logger.broadcast('metrics_update', quotaTracker.getStats());
}, 3000);

// --- REST API ENDPOINTS ---

// 1. System Status
app.get('/api/status', (req, res) => {
  res.json({
    app: 'Tele-AI Studio',
    version: '1.0.0',
    stats: quotaTracker.getStats(),
    queue: agentEngine.getQueueStatus(),
    telegram: {
      polling: telegramService.isPolling,
      bot: telegramService.botInfo
    },
    auth: oauthService.getAuthStatus()
  });
});

// 2. Metrics & Quota
app.get('/api/metrics', (req, res) => {
  res.json(quotaTracker.getStats());
});

// 3. Live Flow Logs (9router style)
app.get('/api/flow', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  res.json(db.getFlowLogs(limit));
});

app.delete('/api/flow', (req, res) => {
  db.clearFlowLogs();
  logger.broadcast('flow_cleared', {});
  res.json({ success: true });
});

// 4. Settings
app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

app.post('/api/settings', (req, res) => {
  const updated = db.updateSettings(req.body);
  logger.logInfo('Pengaturan Diperbarui', Object.keys(req.body).join(', '));
  
  // If bot token changed or polling was toggled
  if (req.body.telegram_bot_token !== undefined) {
    telegramService.stop();
    if (updated.telegram_bot_token) {
      telegramService.start();
    }
  }

  res.json({ success: true, settings: updated });
});

// 5. Google OAuth 2.0 Endpoints
app.get('/api/auth/status', (req, res) => {
  res.json(oauthService.getAuthStatus());
});

app.get('/api/auth/google/url', (req, res) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const redirectUri = `${protocol}://${host}/api/auth/google/callback`;
    const url = oauthService.getGoogleAuthUrl(redirectUri);
    res.json({ success: true, url, redirectUri });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.redirect(`/?auth_error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect('/?auth_error=No+code+provided');
  }

  try {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const redirectUri = `${protocol}://${host}/api/auth/google/callback`;

    await oauthService.handleGoogleCallback(code, redirectUri);
    res.redirect('/?auth_success=1');
  } catch (err) {
    res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
});

// 5b. Multi-Account Pool & Shared Memory
app.get('/api/accounts', (req, res) => {
  res.json(oauthService.getAuthStatus().google_accounts_pool);
});

app.delete('/api/accounts/:email', (req, res) => {
  const accounts = oauthService.removeAccount(req.params.email);
  res.json({ success: true, accounts });
});

app.get('/api/shared-memory', (req, res) => {
  res.json(sharedMemory.getAll());
});

app.post('/api/shared-memory/fact', (req, res) => {
  const { fact } = req.body;
  if (fact) sharedMemory.addFact(fact);
  res.json({ success: true, memory: sharedMemory.getAll() });
});

app.post('/api/shared-memory/workspace', (req, res) => {
  const { updates } = req.body;
  if (updates) sharedMemory.updateWorkspace(updates, 'AdminWeb');
  res.json({ success: true, memory: sharedMemory.getAll() });
});

// 5c. Topic Personas & Multi-Agent Swarm (Hermes & 9router)
app.get('/api/personas/templates', (req, res) => {
  res.json(db.getPersonaTemplates());
});

app.get('/api/topics', (req, res) => {
  res.json(db.getTopicPersonas());
});

app.post('/api/topics/:threadId', (req, res) => {
  const { personaKey, customName } = req.body;
  const updated = db.setTopicPersona(req.params.threadId, personaKey, customName);
  res.json({ success: true, topic: updated });
});

app.delete('/api/topics/:threadId', (req, res) => {
  const deleted = db.deleteTopicPersona(req.params.threadId);
  res.json({ success: deleted });
});

// 6. Circuit Breaker Controls
app.post('/api/circuit-breaker/reset', (req, res) => {
  circuitBreaker.resetBreaker();
  res.json({ success: true, breaker: circuitBreaker.getStatus() });
});

// 7. Telegram Bot Controls & Test
app.post('/api/telegram/test', async (req, res) => {
  const { token } = req.body;
  const result = await telegramService.testConnection(token);
  res.json(result);
});

app.post('/api/telegram/toggle', (req, res) => {
  if (telegramService.isPolling) {
    telegramService.stop();
  } else {
    telegramService.start();
  }
  res.json({ success: true, polling: telegramService.isPolling });
});

// 8. Cronjob Automations
app.get('/api/cron', (req, res) => {
  res.json(db.getCronJobs());
});

app.post('/api/cron', (req, res) => {
  const jobs = db.saveCronJob(req.body);
  cronService.refresh();
  res.json({ success: true, jobs });
});

app.delete('/api/cron/:id', (req, res) => {
  const jobs = db.deleteCronJob(req.params.id);
  cronService.refresh();
  res.json({ success: true, jobs });
});

app.post('/api/cron/:id/run', async (req, res) => {
  cronService.runJobNow(req.params.id);
  res.json({ success: true, message: 'Cronjob dimasukkan ke antrean eksekusi.' });
});

// 9. Interactive Prompt Console from Web UI
app.post('/api/agent/prompt', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt tidak boleh kosong.' });
  }

  try {
    const result = await agentEngine.submitTask({
      prompt: prompt.trim(),
      user: 'WebConsole',
      chatId: null,
      source: 'web'
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Task History
app.get('/api/tasks', (req, res) => {
  res.json(db.getTaskHistory());
});

// Start Server
const PORT = config.get('web_port') || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 Tele-AI Studio Server berjalan di http://0.0.0.0:${PORT}`);
  console.log(`📊 Web Dashboard & Flow Monitor siap diakses.`);
  console.log(`====================================================`);

  // Initialize background services
  cronService.init();
  telegramService.start();
});
