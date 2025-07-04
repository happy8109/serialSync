const winston = require('winston');
const path = require('path');
const config = require('config');
const fs = require('fs');
const { createLogger, format, transports } = require('winston');

// 创建日志目录
const logDir = path.dirname(config.get('logging.file'));
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = createLogger({
  level: config.get('logging.level'),
  format: logFormat,
  defaultMeta: { service: 'serial-sync' },
  transports: [
    new transports.File({
      filename: config.get('logging.file'),
      maxsize: config.get('logging.maxSize'),
      maxFiles: config.get('logging.maxFiles'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    new transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: config.get('logging.maxSize'),
      maxFiles: config.get('logging.maxFiles')
    }),
    new transports.Console({
      level: 'warn',
      format: format.combine(
        format((info) => {
          if (info.onlyFile) return false; // 只写文件，不输出到console
          return info;
        })(),
        format.colorize(),
        format.simple()
      )
    })
  ]
});

const auditLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  defaultMeta: { service: 'audit' },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'audit.log'),
      maxsize: config.get('logging.maxSize'),
      maxFiles: config.get('logging.maxFiles')
    })
  ]
});

module.exports = {
  logger,
  auditLogger
}; 