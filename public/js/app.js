// Tele-AI Studio App Logic

const API = {
  async get(url) {
    const res = await fetch(url);
    return await res.json();
  },
  async post(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  },
  async delete(url) {
    const res = await fetch(url, { method: 'DELETE' });
    return await res.json();
  }
};

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadStatus();
  loadSettings();
  loadAccountsPool();
  loadSharedMemory();
  loadCronJobs();
  initConsole();
  initSettingsHandlers();
  initCronHandlers();
  initGuardrailsHandlers();
  initSharedMemoryHandlers();

  // Periodic refresh of status every 5 seconds
  setInterval(loadStatus, 5000);
  setInterval(loadSharedMemory, 10000);
});

// TAB NAVIGATION
function initTabs() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const panes = document.querySelectorAll('.tab-pane');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');

  const titles = {
    'tab-dashboard': ['Dashboard & Monitoring Kuota', 'Pemantauan real-time AI Agent, antrean request Telegram, dan circuit breaker.'],
    'tab-flow': ['Live Flow Monitor', 'Aliran data real-time: Prompt Telegram, pemikiran agen, eksekusi tool, dan respon.'],
    'tab-console': ['Interactive Agent Console', 'Uji coba perintah dan instruksi langsung ke AI Agent di VPS via web browser.'],
    'tab-cron': ['Penjadwalan Otomatis (Cron)', 'Atur dan pantau tugas otomatis harian untuk video clipping atau maintenance.'],
    'tab-clipper': ['Facebook Reels Clipper Studio', 'Panduan arsitektur hybrid FFmpeg + Whisper + Gemini tanpa risiko ban 403.'],
    'tab-memory': ['Shared Memory & Multi-Account Swarm', 'Memori terpusat yang dibagi bersama oleh seluruh akun AI Google agar bisa saling melanjutkan tugas.'],
    'tab-settings': ['Pengaturan Telegram & OAuth', 'Konfigurasi bot token, whitelist chat ID, dan otentikasi Google/Gemini.'],
    'tab-guardrails': ['Circuit Breaker & Anti-403 Protection', 'Kendali concurrency, pacing delay antar tool, dan proteksi ban akun.']
  };

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      navBtns.forEach(b => b.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const pane = document.getElementById(targetTab);
      if (pane) pane.classList.add('active');

      if (titles[targetTab]) {
        pageTitle.textContent = titles[targetTab][0];
        pageSubtitle.textContent = titles[targetTab][1];
      }
    });
  });
}

// LOAD OVERALL STATUS & METRICS
async function loadStatus() {
  try {
    const data = await API.get('/api/status');
    const stats = data.stats;
    const metrics = stats.metrics;
    const breaker = stats.breaker;

    // Metrics Cards
    document.getElementById('val-total-requests').textContent = metrics.total_requests;
    const successRate = metrics.total_requests > 0
      ? Math.round((metrics.successful_requests / metrics.total_requests) * 100)
      : 100;
    document.getElementById('val-success-rate').textContent = `${successRate}% Berhasil (${metrics.failed_requests} gagal)`;
    document.getElementById('val-today-tokens').textContent = metrics.today_tokens.toLocaleString();
    document.getElementById('val-total-tokens').textContent = `Total: ${metrics.total_tokens_estimated.toLocaleString()} tokens`;
    document.getElementById('val-current-rpm').textContent = breaker.currentRpm;
    document.getElementById('val-current-tpm').textContent = breaker.currentTpm.toLocaleString();

    // Circuit Breaker Pill
    const breakerPill = document.getElementById('top-breaker-pill');
    const breakerText = document.getElementById('top-breaker-text');
    const valBreaker = document.getElementById('val-breaker-status');
    const valBreakerTrips = document.getElementById('val-breaker-trips');

    valBreaker.textContent = breaker.status.toUpperCase();
    valBreakerTrips.textContent = `${metrics.breaker_trips} kali terpicu`;

    if (breaker.status === 'healthy') {
      breakerPill.className = 'breaker-pill healthy';
      breakerText.textContent = 'BREAKER: HEALTHY';
    } else {
      breakerPill.className = 'breaker-pill cooldown';
      breakerText.textContent = `COOLDOWN (${breaker.cooldownRemainingSec}s)`;
    }

    // Telegram Status Pill
    const telePill = document.getElementById('top-telegram-pill');
    const teleText = document.getElementById('top-telegram-text');
    if (data.telegram.polling) {
      telePill.className = 'telegram-pill online';
      teleText.textContent = data.telegram.bot ? `@${data.telegram.bot.username}` : 'TELEGRAM: ONLINE';
    } else {
      telePill.className = 'telegram-pill offline';
      teleText.textContent = 'TELEGRAM: OFFLINE';
    }

    // Engine Badge
    document.getElementById('lbl-engine').textContent = stats.engine.active_engine;
    document.getElementById('dash-active-model').textContent = stats.engine.active_model;
    document.getElementById('dash-pacing').textContent = `${stats.engine.pacing_ms} ms`;
    document.getElementById('dash-concurrency').textContent = `${stats.engine.concurrency_limit} (Serial)`;
    document.getElementById('dash-cost-savings').textContent = `Rp ${metrics.estimated_cost_idr.toLocaleString()}`;

    // Render hourly chart
    renderHourlyChart(metrics.hourly_distribution);
  } catch (err) {
    console.error('Gagal memuat status:', err);
  }
}

function renderHourlyChart(dist = []) {
  const container = document.getElementById('hourly-chart');
  if (!container) return;
  container.innerHTML = '';

  const maxVal = Math.max(...dist, 5);

  dist.forEach((count, hour) => {
    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-wrap';

    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    const pct = Math.max(4, Math.round((count / maxVal) * 100));
    bar.style.height = `${pct}%`;
    bar.title = `Jam ${hour}:00 - ${count} requests`;

    const lbl = document.createElement('div');
    lbl.className = 'chart-label';
    lbl.textContent = hour % 3 === 0 ? `${hour}` : '';

    wrap.appendChild(bar);
    wrap.appendChild(lbl);
    container.appendChild(wrap);
  });
}

// SETTINGS & OAUTH
async function loadSettings() {
  try {
    const settings = await API.get('/api/settings');
    const authStatus = await API.get('/api/auth/status');

    // Telegram
    document.getElementById('cfg-telegram-token').value = settings.telegram_bot_token || '';
    document.getElementById('cfg-allowed-chats').value = (settings.allowed_chat_ids || []).join(', ');
    document.getElementById('cfg-telegram-enabled').checked = Boolean(settings.telegram_bot_token);

    // Engine
    document.getElementById('cfg-active-engine').value = settings.active_engine || 'agy';
    document.getElementById('cfg-active-model').value = settings.active_model || 'gemini-3.8-flash-high';
    document.getElementById('cfg-google-client-id').value = settings.google_client_id || '';
    document.getElementById('cfg-google-client-secret').value = settings.google_client_secret || '';
    document.getElementById('cfg-gemini-api-key').value = settings.gemini_api_key || '';

    // Guardrails
    document.getElementById('cfg-concurrency').value = settings.concurrency_limit || 1;
    document.getElementById('cfg-pacing').value = settings.pacing_ms || 2000;
    document.getElementById('cfg-max-turns').value = settings.max_turns_per_prompt || 15;
    document.getElementById('cfg-cooldown-sec').value = settings.circuit_breaker_cooldown_sec || 300;

    // OAuth Badge
    const oauthBadge = document.getElementById('lbl-oauth-status');
    if (authStatus.google_oauth && authStatus.google_oauth.connected) {
      oauthBadge.textContent = `Terhubung: ${authStatus.google_oauth.email}`;
      oauthBadge.style.color = '#34d399';
    } else {
      oauthBadge.textContent = 'Belum Terhubung';
      oauthBadge.style.color = '#94a3b8';
    }
  } catch (err) {
    console.error('Error loadSettings:', err);
  }
}

function initSettingsHandlers() {
  // Test Telegram Bot
  document.getElementById('btn-test-telegram').addEventListener('click', async () => {
    const token = document.getElementById('cfg-telegram-token').value.trim();
    if (!token) return alert('Masukkan token bot terlebih dahulu.');

    const res = await API.post('/api/telegram/test', { token });
    if (res.success) {
      alert(`✅ Berhasil terhubung ke bot: @${res.bot.username} (${res.bot.first_name})`);
    } else {
      alert(`❌ Gagal: ${res.error}`);
    }
  });

  // Save Telegram Settings
  document.getElementById('btn-save-telegram').addEventListener('click', async () => {
    const token = document.getElementById('cfg-telegram-token').value.trim();
    const chatsRaw = document.getElementById('cfg-allowed-chats').value;
    const allowedChats = chatsRaw.split(',').map(s => s.trim()).filter(Boolean);

    await API.post('/api/settings', {
      telegram_bot_token: token,
      allowed_chat_ids: allowedChats
    });
    alert('✅ Pengaturan Telegram berhasil disimpan!');
    loadStatus();
  });

  // Save Engine & Model
  document.getElementById('btn-save-engine').addEventListener('click', async () => {
    const engine = document.getElementById('cfg-active-engine').value;
    const model = document.getElementById('cfg-active-model').value;
    const clientId = document.getElementById('cfg-google-client-id').value.trim();
    const clientSecret = document.getElementById('cfg-google-client-secret').value.trim();
    const apiKey = document.getElementById('cfg-gemini-api-key').value.trim();

    await API.post('/api/settings', {
      active_engine: engine,
      active_model: model,
      google_client_id: clientId,
      google_client_secret: clientSecret,
      gemini_api_key: apiKey
    });
    alert('✅ Pengaturan Engine berhasil disimpan!');
    loadStatus();
  });

  // Connect Google OAuth (1-Click without manual Client ID)
  document.getElementById('btn-connect-google').addEventListener('click', async () => {
    try {
      const res = await API.get('/api/auth/google/url');
      if (res.success && res.url) {
        window.location.href = res.url;
      } else {
        alert(res.error || 'Gagal membuat URL OAuth.');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
}

// MULTI-ACCOUNT POOL MANAGEMENT
async function loadAccountsPool() {
  try {
    const data = await API.get('/api/accounts');
    const container = document.getElementById('accounts-container');
    const lblCount = document.getElementById('lbl-pool-count');
    if (!container) return;
    container.innerHTML = '';

    const accounts = data.accounts || [];
    lblCount.textContent = `${accounts.length} Akun Terhubung`;

    if (accounts.length === 0) {
      container.innerHTML = '<div class="flow-empty" style="padding: 10px 0;">Belum ada akun Google terhubung di pool. Klik tombol di bawah untuk menambah akun.</div>';
      return;
    }

    accounts.forEach(acc => {
      const div = document.createElement('div');
      div.className = 'info-row';
      div.style.alignItems = 'center';

      const isHealthy = acc.status === 'healthy';
      const statusBadge = isHealthy
        ? '<span style="color: #34d399; font-weight: 600; font-size: 11px;">● AKTIF</span>'
        : `<span style="color: #f87171; font-weight: 600; font-size: 11px;">● COOLDOWN (${acc.cooldownRemainingSec}s)</span>`;

      div.innerHTML = `
        <div style="display: flex; flex-direction: column;">
          <strong style="font-size: 13px;">${escapeHtml(acc.email)}</strong>
          <small style="color: var(--text-dim);">${statusBadge} | Token hari ini: ${acc.tokensToday || 0}</small>
        </div>
        <button class="btn btn-sm btn-secondary btn-del-acc" data-email="${escapeHtml(acc.email)}" style="color: #f87171;">Hapus</button>
      `;
      container.appendChild(div);
    });

    container.querySelectorAll('.btn-del-acc').forEach(btn => {
      btn.addEventListener('click', async () => {
        const email = btn.getAttribute('data-email');
        if (!confirm(`Hapus akun ${email} dari pool?`)) return;
        await API.delete(`/api/accounts/${encodeURIComponent(email)}`);
        loadAccountsPool();
      });
    });
  } catch (err) {
    console.error('Error loadAccountsPool:', err);
  }
}

// SHARED MEMORY MANAGEMENT
async function loadSharedMemory() {
  try {
    const mem = await API.get('/api/shared-memory');
    const factsContainer = document.getElementById('facts-container');
    const stateJson = document.getElementById('workspace-state-json');
    const activityContainer = document.getElementById('account-activity-container');

    // Facts
    if (factsContainer) {
      factsContainer.innerHTML = '';
      (mem.facts || []).forEach(fact => {
        const li = document.createElement('li');
        li.style.background = 'var(--bg-input)';
        li.style.padding = '8px 12px';
        li.style.borderRadius = 'var(--radius-sm)';
        li.style.border = '1px solid var(--border-color)';
        li.style.fontSize = '12px';
        li.textContent = `📌 ${fact}`;
        factsContainer.appendChild(li);
      });
    }

    // Workspace state
    if (stateJson) {
      stateJson.textContent = JSON.stringify(mem.workspace_state || {}, null, 2);
    }

    // Recent collaborative activity
    if (activityContainer) {
      activityContainer.innerHTML = '';
      const acts = mem.account_activity || [];
      if (acts.length === 0) {
        activityContainer.innerHTML = '<div class="flow-empty" style="font-size: 11px;">Belum ada log kolaborasi akun.</div>';
      } else {
        acts.slice(-6).reverse().forEach(a => {
          const item = document.createElement('div');
          item.style.fontSize = '11px';
          item.style.color = 'var(--text-muted)';
          item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
          item.style.padding = '4px 0';
          item.innerHTML = `<b style="color: #93c5fd;">[${escapeHtml(a.account)}]</b> ${escapeHtml(a.action)}: ${escapeHtml(a.details)}`;
          activityContainer.appendChild(item);
        });
      }
    }
  } catch (err) {
    console.error('Error loadSharedMemory:', err);
  }
}

function initSharedMemoryHandlers() {
  const btnAddFact = document.getElementById('btn-add-fact');
  if (btnAddFact) {
    btnAddFact.addEventListener('click', async () => {
      const fact = prompt('Masukkan fakta / preferensi baru untuk dibagikan ke seluruh akun AI:');
      if (fact && fact.trim()) {
        await API.post('/api/shared-memory/fact', { fact: fact.trim() });
        loadSharedMemory();
      }
    });
  }
}

function initGuardrailsHandlers() {
  document.getElementById('btn-save-guardrails').addEventListener('click', async () => {
    const concurrency = parseInt(document.getElementById('cfg-concurrency').value, 10) || 1;
    const pacing = parseInt(document.getElementById('cfg-pacing').value, 10) || 2000;
    const maxTurns = parseInt(document.getElementById('cfg-max-turns').value, 10) || 15;
    const cooldown = parseInt(document.getElementById('cfg-cooldown-sec').value, 10) || 300;

    await API.post('/api/settings', {
      concurrency_limit: concurrency,
      pacing_ms: pacing,
      max_turns_per_prompt: maxTurns,
      circuit_breaker_cooldown_sec: cooldown
    });
    alert('✅ Guardrails berhasil diterapkan!');
    loadStatus();
  });

  document.getElementById('btn-reset-breaker').addEventListener('click', async () => {
    await API.post('/api/circuit-breaker/reset', {});
    alert('✅ Circuit Breaker berhasil direset ke status HEALTHY.');
    loadStatus();
  });
}

// CRON AUTOMATIONS
async function loadCronJobs() {
  try {
    const jobs = await API.get('/api/cron');
    const container = document.getElementById('cron-container');
    if (!container) return;
    container.innerHTML = '';

    if (jobs.length === 0) {
      container.innerHTML = '<div class="flow-empty">Belum ada tugas cron terjadwal.</div>';
      return;
    }

    jobs.forEach(job => {
      const item = document.createElement('div');
      item.className = 'cron-item';
      item.innerHTML = `
        <div class="cron-item-info">
          <h4>${escapeHtml(job.name)} <span class="cron-tag">${escapeHtml(job.schedule)}</span></h4>
          <p>${escapeHtml(job.prompt)}</p>
          <small class="helper-text">Status: <b>${job.status || 'idle'}</b> | Terakhir Jalan: ${job.last_run ? new Date(job.last_run).toLocaleString() : 'Belum pernah'}</small>
        </div>
        <div class="cron-actions">
          <button class="btn btn-sm btn-outline btn-run-cron" data-id="${job.id}">▶ Jalankan Sekarang</button>
          <button class="btn btn-sm btn-secondary btn-del-cron" data-id="${job.id}">Hapus</button>
        </div>
      `;
      container.appendChild(item);
    });

    // Attach actions
    container.querySelectorAll('.btn-run-cron').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        btn.disabled = true;
        btn.textContent = 'Memproses...';
        await API.post(`/api/cron/${id}/run`, {});
        alert('Tugas dimasukkan ke antrean!');
        loadCronJobs();
      });
    });

    container.querySelectorAll('.btn-del-cron').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Hapus tugas cron ini?')) return;
        const id = btn.getAttribute('data-id');
        await API.delete(`/api/cron/${id}`);
        loadCronJobs();
      });
    });
  } catch (e) {
    console.error('Error loadCronJobs:', e);
  }
}

function initCronHandlers() {
  const modal = document.getElementById('cron-modal');
  document.getElementById('btn-add-cron').addEventListener('click', () => {
    modal.style.display = 'flex';
  });

  document.getElementById('btn-cancel-cron').addEventListener('click', () => {
    modal.style.display = 'none';
  });

  document.getElementById('btn-save-cron').addEventListener('click', async () => {
    const name = document.getElementById('cron-name').value.trim();
    const schedule = document.getElementById('cron-schedule').value.trim();
    const prompt = document.getElementById('cron-prompt').value.trim();
    const enabled = document.getElementById('cron-enabled').checked;

    if (!name || !schedule || !prompt) {
      return alert('Lengkapi semua field.');
    }

    await API.post('/api/cron', { name, schedule, prompt, enabled });
    modal.style.display = 'none';
    loadCronJobs();
  });
}

// AGENT CONSOLE (BROWSER CHAT)
function initConsole() {
  const btn = document.getElementById('btn-send-console');
  const input = document.getElementById('console-prompt-input');
  const logs = document.getElementById('console-output');

  async function sendPrompt() {
    const text = input.value.trim();
    if (!text) return;

    appendConsoleMsg('user', text);
    input.value = '';

    const loadingMsg = appendConsoleMsg('agent', '⏳ Sedang diproses oleh AI Agent di VPS...');

    try {
      const res = await API.post('/api/agent/prompt', { prompt: text });
      if (res.success) {
        loadingMsg.textContent = res.result.text;
      } else {
        loadingMsg.textContent = `❌ Error: ${res.error}`;
      }
    } catch (e) {
      loadingMsg.textContent = `❌ Gagal menghubungi server: ${e.message}`;
    }
  }

  btn.addEventListener('click', sendPrompt);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  function appendConsoleMsg(role, text) {
    const div = document.createElement('div');
    div.className = `console-msg ${role}`;
    div.textContent = text;
    logs.appendChild(div);
    logs.scrollTop = logs.scrollHeight;
    return div;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
