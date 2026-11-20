const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class FileTools {
  readFile(filePath, maxBytes = 30000) {
    logger.logToolCall('file_read', filePath);
    try {
      const fullPath = path.resolve(filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File tidak ditemukan: ${filePath}` };
      }
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        return { success: false, error: `${filePath} adalah direktori, bukan file.` };
      }

      let content = fs.readFileSync(fullPath, 'utf8');
      let truncated = false;
      if (content.length > maxBytes) {
        content = content.slice(0, maxBytes) + '\n\n[... isi file dipotong ...]';
        truncated = true;
      }
      return { success: true, path: fullPath, content, size: stat.size, truncated };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  writeFile(filePath, content) {
    logger.logToolCall('file_write', filePath, { bytes: content.length });
    try {
      const fullPath = path.resolve(filePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, content, 'utf8');
      logger.logToolOutput('file_write', `File berhasil ditulis: ${filePath} (${content.length} bytes)`);
      return { success: true, path: fullPath, bytesWritten: content.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  listDirectory(dirPath = '.') {
    logger.logToolCall('list_dir', dirPath);
    try {
      const fullPath = path.resolve(dirPath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `Direktori tidak ditemukan: ${dirPath}` };
      }
      const items = fs.readdirSync(fullPath, { withFileTypes: true });
      const list = items.slice(0, 100).map(item => ({
        name: item.name,
        type: item.isDirectory() ? 'directory' : 'file'
      }));
      return { success: true, path: fullPath, items: list, total: items.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = new FileTools();
