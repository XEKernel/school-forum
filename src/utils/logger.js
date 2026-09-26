const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/constants');
const { SENSITIVE_FIELDS, SENSITIVE_EXACT_KEYS } = require('../config/security');

// 日志文件保留天数：超出后在启动时删除（本模块按天分文件，这里补上保留策略）
const LOG_RETENTION_DAYS = 30;

/**
 * 脱敏：递归替换日志数据中的敏感字段
 * 在 formatLogMessage 统一调用，保证任何调用方传入的 req.body / 验证码都不会落盘明文
 * 注意：keys 用子串匹配（覆盖 currentPassword / verificationCode 这类变体），
 *      但 'code' 这类短名只做精确匹配，避免把 statusCode / errorCode 也一并脱敏
 * @param {*} data - 任意日志附加数据
 * @returns {*} 脱敏后的数据
 */
function sanitizeLogData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeLogData(item));
  }

  const sanitized = {};
  for (const key of Object.keys(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_EXACT_KEYS.includes(lowerKey) ||
        SENSITIVE_FIELDS.some(field => lowerKey.includes(field.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitizeLogData(data[key]);
    }
  }
  return sanitized;
}

// 日志级别
const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  SUCCESS: 'SUCCESS',
  DEBUG: 'DEBUG'
};

// 日志颜色（用于控制台输出）
const LOG_COLORS = {
  INFO: '\x1b[36m',    // 青色
  WARN: '\x1b[33m',    // 黄色
  ERROR: '\x1b[31m',   // 红色
  SUCCESS: '\x1b[32m', // 绿色
  DEBUG: '\x1b[90m',   // 灰色
  RESET: '\x1b[0m'     // 重置
};

/**
 * 获取日志文件路径（按日期）
 * @param {Date} date - 日期对象，默认为当前日期
 * @returns {string} 日志文件路径
 */
function getLogFilePath(date = new Date()) {
  const dateStr = date.toISOString().split('T')[0];
  return path.join(DATA_DIR, `server-${dateStr}.log`);
}

/**
 * 格式化日志消息
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 * @param {object} data - 附加数据
 * @returns {string} 格式化后的日志
 */
function formatLogMessage(level, message, data = null) {
  const timestamp = new Date().toISOString();
  // 统一脱敏：调用方可能直接传 req.body（含密码/验证码），绝不允许明文落盘
  const dataStr = data ? ` | Data: ${JSON.stringify(sanitizeLogData(data))}` : '';
  return `[${timestamp}] [${level}] ${message}${dataStr}`;
}

// ===================== 异步批量写盘（避免每请求 2-3 次同步磁盘 I/O 阻塞事件循环） =====================
const logQueue = [];
let flushTimer = null;
let flushing = false;

// 定时批量 flush（默认 300ms 一批，一次 appendFileSync 写入全部积压日志）
function scheduleFlush() {
  if (flushTimer || flushing) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushLogQueue();
  }, 300);
  // 不阻止进程退出
  if (flushTimer.unref) flushTimer.unref();
}

function flushLogQueue() {
  if (flushing) return;
  const batch = logQueue.splice(0, logQueue.length);
  if (batch.length === 0) return;
  flushing = true;
  try {
    const logFilePath = getLogFilePath();
    fs.appendFileSync(logFilePath, batch.join('\n') + '\n', 'utf8');
  } catch (error) {
    console.error('写入日志文件失败:', error);
  } finally {
    flushing = false;
  }
}

// 进程退出前把积压日志落盘
function flushLogsSync() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  flushLogQueue();
}

/**
 * 写入日志到文件（按日期，异步批量）
 * @param {string} formattedMessage - 格式化后的日志消息
 */
function writeLogToFile(formattedMessage) {
  logQueue.push(formattedMessage);
  scheduleFlush();
}

/**
 * 在控制台输出日志
 * @param {string} level - 日志级别
 * @param {string} formattedMessage - 格式化后的日志消息
 */
function logToConsole(level, formattedMessage) {
  const color = LOG_COLORS[level] || LOG_COLORS.RESET;
  console.log(`${color}${formattedMessage}${LOG_COLORS.RESET}`);
}

/**
 * 记录信息日志
 * @param {string} message - 日志消息
 * @param {object} data - 附加数据
 */
function logInfo(message, data = null) {
  const formattedMessage = formatLogMessage(LOG_LEVELS.INFO, message, data);
  logToConsole(LOG_LEVELS.INFO, formattedMessage);
  writeLogToFile(formattedMessage);
}

/**
 * 记录警告日志
 * @param {string} message - 日志消息
 * @param {object} data - 附加数据
 */
function logWarn(message, data = null) {
  const formattedMessage = formatLogMessage(LOG_LEVELS.WARN, message, data);
  logToConsole(LOG_LEVELS.WARN, formattedMessage);
  writeLogToFile(formattedMessage);
}

/**
 * 记录错误日志
 * @param {string} message - 日志消息
 * @param {object} data - 附加数据
 */
function logError(message, data = null) {
  const formattedMessage = formatLogMessage(LOG_LEVELS.ERROR, message, data);
  logToConsole(LOG_LEVELS.ERROR, formattedMessage);
  writeLogToFile(formattedMessage);
}

/**
 * 记录成功日志
 * @param {string} message - 日志消息
 * @param {object} data - 附加数据
 */
function logSuccess(message, data = null) {
  const formattedMessage = formatLogMessage(LOG_LEVELS.SUCCESS, message, data);
  logToConsole(LOG_LEVELS.SUCCESS, formattedMessage);
  writeLogToFile(formattedMessage);
}

/**
 * 记录调试日志
 * @param {string} message - 日志消息
 * @param {object} data - 附加数据
 */
function logDebug(message, data = null) {
  const formattedMessage = formatLogMessage(LOG_LEVELS.DEBUG, message, data);
  logToConsole(LOG_LEVELS.DEBUG, formattedMessage);
  writeLogToFile(formattedMessage);
}

/**
 * 记录用户操作
 * @param {string} action - 操作类型
 * @param {string} userId - 用户ID
 * @param {string} username - 用户名
 * @param {object} details - 操作详情
 */
function logUserAction(action, userId, username, details = {}) {
  const message = `用户操作: ${action} | 用户: ${username} (ID: ${userId})`;
  logInfo(message, details);
}

/**
 * 记录系统事件
 * @param {string} event - 事件类型
 * @param {object} details - 事件详情
 */
function logSystemEvent(event, details = {}) {
  const message = `系统事件: ${event}`;
  logInfo(message, details);
}

/**
 * 记录安全事件
 * @param {string} event - 安全事件类型
 * @param {object} details - 事件详情
 */
function logSecurityEvent(event, details = {}) {
  const message = `安全事件: ${event}`;
  logWarn(message, details);
}

/**
 * 获取所有日志文件列表
 * @returns {Array} 日志文件信息数组 [{date: '2026-02-08', size: 1234, path: '/path/to/file'}, ...]
 */
function getAllLogFiles() {
  try {
    const files = fs.readdirSync(DATA_DIR);
    const logFiles = files
      .filter(file => file.startsWith('server-') && file.endsWith('.log'))
      .map(file => {
        const filePath = path.join(DATA_DIR, file);
        const stats = fs.statSync(filePath);
        const dateMatch = file.match(/server-(\d{4}-\d{2}-\d{2})\.log/);
        return {
          date: dateMatch ? dateMatch[1] : file,
          size: stats.size,
          path: filePath,
          modified: stats.mtime
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return logFiles;
  } catch (error) {
    console.error('获取日志文件列表失败:', error);
    return [];
  }
}

/**
 * 获取可用的日志日期列表
 * @returns {Array} 日期字符串数组 ['2026-02-08', '2026-02-07', ...]
 */
function getAvailableLogDates() {
  const logFiles = getAllLogFiles();
  return logFiles.map(file => file.date);
}

/**
 * 读取日志文件
 * @param {string} date - 日期字符串，格式为 'YYYY-MM-DD'，默认为今天
 * @param {number} lines - 读取的行数，0表示读取全部
 * @returns {string[]} 日志行数组
 */
function readLogs(date = null, lines = 0) {
  try {
    const logFilePath = date ? getLogFilePath(new Date(date)) : getLogFilePath();
    
    if (!fs.existsSync(logFilePath)) {
      return [];
    }

    let content;
    if (lines > 0) {
      // 有界读取：只从文件尾部读取「够切出 lines 行」的字节数，避免把整份日志读进内存
      // （单行上限约 1KB：请求日志截断 UA、内容长度有限，取 1KB/行足够）
      const { size } = fs.statSync(logFilePath);
      const maxBytes = Math.min(size, lines * 1024);
      const fd = fs.openSync(logFilePath, 'r');
      try {
        const buffer = Buffer.alloc(maxBytes);
        fs.readSync(fd, buffer, 0, maxBytes, size - maxBytes);
        content = buffer.toString('utf8');
        // 从中间截断时首行可能是半行，丢弃
        if (maxBytes < size) {
          const firstNewline = content.indexOf('\n');
          if (firstNewline !== -1) content = content.slice(firstNewline + 1);
        }
      } finally {
        fs.closeSync(fd);
      }
    } else {
      content = fs.readFileSync(logFilePath, 'utf8');
    }

    const allLines = content.split('\n').filter(line => line.trim() !== '');
    
    // 如果lines为0或大于等于总行数，返回全部
    if (lines === 0 || lines >= allLines.length) {
      return allLines;
    }
    
    // 返回最后 N 行
    return allLines.slice(-lines);
  } catch (error) {
    console.error('读取日志文件失败:', error);
    return [];
  }
}

/**
 * 清空指定日期的日志文件
 * @param {string} date - 日期字符串，格式为 'YYYY-MM-DD'，默认为今天
 */
function clearLogs(date = null) {
  try {
    const logFilePath = date ? getLogFilePath(new Date(date)) : getLogFilePath();
    
    if (fs.existsSync(logFilePath)) {
      fs.writeFileSync(logFilePath, '', 'utf8');
      logSystemEvent('日志文件已清空', { date: date || new Date().toISOString().split('T')[0] });
    }
  } catch (error) {
    console.error('清空日志文件失败:', error);
  }
}

/**
 * 删除指定日期的日志文件
 * @param {string} date - 日期字符串，格式为 'YYYY-MM-DD'
 */
function deleteLogs(date) {
  try {
    const logFilePath = getLogFilePath(new Date(date));
    
    if (fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
      logSystemEvent('日志文件已删除', { date });
      return true;
    }
    return false;
  } catch (error) {
    console.error('删除日志文件失败:', error);
    return false;
  }
}

/**
 * 清空所有日志文件
 */
function clearAllLogs() {
  try {
    const logFiles = getAllLogFiles();
    let clearedCount = 0;
    
    logFiles.forEach(file => {
      try {
        fs.writeFileSync(file.path, '', 'utf8');
        clearedCount++;
      } catch (error) {
        console.error(`清空日志文件失败: ${file.path}`, error);
      }
    });
    
    logSystemEvent('所有日志文件已清空', { clearedCount });
    return clearedCount;
  } catch (error) {
    console.error('清空所有日志文件失败:', error);
    return 0;
  }
}

/**
 * 清理过期日志文件（启动时调用）
 * 本模块按天分文件，此前没有任何保留策略，日志会无限累积占用磁盘
 * @param {number} retentionDays - 保留天数，默认 LOG_RETENTION_DAYS
 * @returns {number} 清理的文件数
 */
function cleanupOldLogs(retentionDays = LOG_RETENTION_DAYS) {
  try {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    getAllLogFiles().forEach(file => {
      if (new Date(file.date).getTime() < cutoff) {
        try {
          fs.unlinkSync(file.path);
          removed++;
        } catch (error) {
          console.error(`清理过期日志失败: ${file.path}`, error);
        }
      }
    });
    if (removed > 0) {
      logSystemEvent('过期日志已清理', { removed, retentionDays });
    }
    return removed;
  } catch (error) {
    console.error('清理过期日志失败:', error);
    return 0;
  }
}

module.exports = {
  logInfo,
  logWarn,
  logError,
  logSuccess,
  logDebug,
  logUserAction,
  logSystemEvent,
  logSecurityEvent,
  getLogFilePath,
  getAllLogFiles,
  getAvailableLogDates,
  readLogs,
  clearLogs,
  deleteLogs,
  clearAllLogs,
  cleanupOldLogs,
  sanitizeLogData,
  flushLogsSync,
  LOG_RETENTION_DAYS,
  LOG_LEVELS
};