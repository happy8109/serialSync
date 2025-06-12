const winston = require('winston');
const path = require('path');
const config = require('config');
const fs = require('fs');

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

const logger = winston.createLogger({
  level: config.get('logging.level'),
  format: logFormat,
  defaultMeta: { service: 'serial-sync' },
  transports: [
    new winston.transports.File({
      filename: config.get('logging.file'),
      maxsize: config.get('logging.maxSize'),
      maxFiles: config.get('logging.maxFiles'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: config.get('logging.maxSize'),
      maxFiles: config.get('logging.maxFiles')
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

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