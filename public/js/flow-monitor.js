// 9router-style Live Flow Monitor

class FlowMonitor {
  constructor() {
    this.container = document.getElementById('flow-stream');
    this.wsIndicator = document.getElementById('ws-indicator');
    this.wsStatusText = document.getElementById('ws-status-text');
    this.autoScrollChk = document.getElementById('chk-autoscroll');
    this.btnClear = document.getElementById('btn-clear-flow');
    this.filterBtns = document.querySelectorAll('.filter-btn');

    this.activeFilter = 'all';
    this.logs = [];
    this.ws = null;

    this.init();
  }

  async init() {
    this.initFilters();
    this.initClear();
    await this.loadInitialLogs();
    this.connectWs();
  }

  initFilters() {
    this.filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.getAttribute('data-filter');
        this.renderAll();
      });
    });
  }

  initClear() {
    if (this.btnClear) {
      this.btnClear.addEventListener('click', async () => {
        await fetch('/api/flow', { method: 'DELETE' });
        this.logs = [];
        this.renderAll();
      });
    }
  }

  async loadInitialLogs() {
    try {
      const res = await fetch('/api/flow?limit=80');
      this.logs = await res.json();
      this.renderAll();
    } catch (e) {
      console.error('Gagal memuat log awal:', e);
    }
  }

  connectWs() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      if (this.wsIndicator) this.wsIndicator.className = 'status-indicator online';
      if (this.wsStatusText) this.wsStatusText.textContent = 'Live Connected';
    };

    this.ws.onclose = () => {
      if (this.wsIndicator) this.wsIndicator.className = 'status-indicator';
      if (this.wsStatusText) this.wsStatusText.textContent = 'Reconnecting...';
      setTimeout(() => this.connectWs(), 3000);
    };

    this.ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'flow_log') {
          this.addLog(payload.data);
        } else if (payload.type === 'flow_cleared') {
          this.logs = [];
          this.renderAll();
        }
      } catch (e) {
        console.error('Error parsing WS message:', e);
      }
    };
  }

  addLog(entry) {
    this.logs.push(entry);
    if (this.logs.length > 300) this.logs.shift();

    if (this.matchesFilter(entry)) {
      this.appendItem(entry);
      if (this.autoScrollChk && this.autoScrollChk.checked) {
        this.container.scrollTop = this.container.scrollHeight;
      }
    }
  }

  matchesFilter(entry) {
    if (this.activeFilter === 'all') return true;
    if (this.activeFilter === 'prompt' && entry.type === 'prompt') return true;
    if (this.activeFilter === 'tool_call' && (entry.type === 'tool_call' || entry.type === 'tool_output')) return true;
    if (this.activeFilter === 'response' && entry.type === 'response') return true;
    if (this.activeFilter === 'breaker' && entry.type === 'breaker') return true;
    return false;
  }

  renderAll() {
    if (!this.container) return;
    this.container.innerHTML = '';

    const filtered = this.logs.filter(entry => this.matchesFilter(entry));
    if (filtered.length === 0) {
      this.container.innerHTML = '<div class="flow-empty">Tidak ada event log untuk filter ini.</div>';
      return;
    }

    filtered.forEach(entry => this.appendItem(entry));
    if (this.autoScrollChk && this.autoScrollChk.checked) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }

  appendItem(entry) {
    const emptyMsg = this.container.querySelector('.flow-empty');
    if (emptyMsg) emptyMsg.remove();

    const item = document.createElement('div');
    item.className = 'flow-item';

    const timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
    const hasDetails = entry.details && entry.details.trim().length > 0;

    item.innerHTML = `
      <div class="flow-item-header">
        <span class="flow-badge ${entry.type || 'info'}">${entry.type || 'info'}</span>
        <span class="flow-time">${timeStr}</span>
        <span class="flow-title">${this.escape(entry.title || '')}</span>
      </div>
      ${hasDetails ? `<div class="flow-details">${this.escape(entry.details)}</div>` : ''}
    `;

    this.container.appendChild(item);
  }

  escape(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new FlowMonitor();
});
