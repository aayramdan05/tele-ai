const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class TelegramTool {
  constructor() {
    this.telegramService = null; // Injected to avoid circular dependency
  }

  setTelegramService(service) {
    this.telegramService = service;
  }

  async sendFile(chatId, filePath, caption = '') {
    logger.logToolCall('telegram_send_file', filePath, { chatId, caption });
    if (!this.telegramService) {
      return { success: false, error: 'Telegram Service belum siap.' };
    }

    try {
      const fullPath = path.resolve(filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File tidak ditemukan: ${filePath}` };
      }

      const res = await this.telegramService.sendFile(chatId, fullPath, caption);
      logger.logToolOutput('telegram_send_file', `File terkirim ke Telegram: ${path.basename(fullPath)}`);
      return { success: true, file: path.basename(fullPath), result: res };
    } catch (err) {
      logger.logError('Gagal Kirim File ke Telegram', err);
      return { success: false, error: err.message };
    }
  }

  async sendMessage(chatId, text) {
    if (!this.telegramService) {
      return { success: false, error: 'Telegram Service belum siap.' };
    }
    try {
      const res = await this.telegramService.sendMessage(chatId, text);
      return { success: true, result: res };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = new TelegramTool();
