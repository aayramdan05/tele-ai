const { exec } = require('child_process');
const path = require('path');
const logger = require('../logger');

const MAX_OUTPUT_CHARS = 4000;

class TerminalTool {
  /**
   * Execute a shell command on the host/VPS
   * @param {string} command 
   * @param {string} cwd 
   * @param {number} timeoutMs 
   */
  async execute(command, cwd = process.cwd(), timeoutMs = 180000) {
    logger.logToolCall('terminal', command, { cwd, timeoutMs });

    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const shell = isWin ? 'powershell.exe' : '/bin/bash';

      const proc = exec(command, {
        cwd,
        shell,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      }, (error, stdout, stderr) => {
        let output = (stdout || '') + (stderr ? `\n[STDERR]\n${stderr}` : '');
        let exitCode = error ? (error.code || 1) : 0;

        if (error && error.killed) {
          output += `\n[TIMEOUT: Perintah melampaui batas waktu ${timeoutMs / 1000} detik]`;
        }

        // Smart log truncation to prevent context blowup
        const truncatedOutput = this.truncateOutput(output);
        logger.logToolOutput('terminal', truncatedOutput, exitCode);

        resolve({
          command,
          exitCode,
          output: truncatedOutput,
          rawLength: output.length,
          success: exitCode === 0
        });
      });
    });
  }

  /**
   * Truncate long outputs (like ffmpeg or whisper progress) to keep token size lean
   */
  truncateOutput(text) {
    if (!text || text.length <= MAX_OUTPUT_CHARS) {
      return text || '(Output kosong)';
    }

    const lines = text.split('\n');
    if (lines.length <= 60) {
      return text.slice(0, MAX_OUTPUT_CHARS) + '\n... [dipotong karena terlalu panjang]';
    }

    // Keep top 25 lines and bottom 35 lines
    const topLines = lines.slice(0, 25).join('\n');
    const bottomLines = lines.slice(-35).join('\n');
    const omittedCount = lines.length - 60;

    return `${topLines}\n\n[... ${omittedCount} baris log dipotong untuk menghemat token ...]\n\n${bottomLines}`;
  }
}

module.exports = new TerminalTool();
