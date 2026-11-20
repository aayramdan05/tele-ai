const db = require('./database');

class Logger {
  constructor() {
    this.wsClients = new Set();
  }

  registerWsClient(ws) {
    this.wsClients.add(ws);
    ws.on('close', () => {
      this.wsClients.delete(ws);
    });
  }

  broadcast(eventType, payload) {
    const message = JSON.stringify({ type: eventType, data: payload, timestamp: new Date().toISOString() });
    for (const client of this.wsClients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(message);
        } catch (err) {
          // ignore dead client
        }
      }
    }
  }

  /**
   * Log an event into DB and broadcast to all Web UI clients
   * @param {'prompt'|'thought'|'tool_call'|'tool_output'|'response'|'breaker'|'info'|'error'} type 
   * @param {string} title 
   * @param {any} details 
   * @param {object} meta 
   */
  logFlow(type, title, details = '', meta = {}) {
    const entry = db.addFlowLog({
      type,
      title,
      details: typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details),
      meta
    });

    // Console output for terminal monitoring
    const prefix = `[FLOW:${type.toUpperCase()}]`;
    console.log(`${prefix} ${title} ${meta.user ? `(@${meta.user})` : ''}`);

    this.broadcast('flow_log', entry);
    return entry;
  }

  logInfo(title, details = '') {
    return this.logFlow('info', title, details);
  }

  logPrompt(user, prompt, chatId) {
    return this.logFlow('prompt', `Pesan Telegram Masuk: "${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}"`, prompt, { user, chatId });
  }

  logThought(thought, step = 1) {
    return this.logFlow('thought', `Agent Berpikir (Langkah #${step})`, thought);
  }

  logToolCall(toolName, command, args) {
    return this.logFlow('tool_call', `Eksekusi Tool: ${toolName}`, { command, args });
  }

  logToolOutput(toolName, output, exitCode = 0) {
    return this.logFlow('tool_output', `Output Tool: ${toolName} (Exit ${exitCode})`, output);
  }

  logResponse(response, tokenUsage = {}) {
    return this.logFlow('response', 'Balasan Terkirim ke User', response, { tokenUsage });
  }

  logBreaker(status, reason, cooldownSec = 0) {
    return this.logFlow('breaker', `Circuit Breaker: ${status.toUpperCase()}`, reason, { cooldownSec });
  }

  logError(title, err) {
    const msg = err && err.stack ? err.stack : (err && err.message ? err.message : String(err));
    return this.logFlow('error', title, msg);
  }
}

module.exports = new Logger();
