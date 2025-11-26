const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('config');

// 1. 确保日志目录存在
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// 2. 获取配置
const logLevel = config.has('logging.level') ? config.get('logging.level') : 'info';
const consoleEnabled = config.has('logging.console') ? config.get('logging.console') : true;
const fileEnabled = config.has('logging.file') ? config.get('logging.file') : true;

// 3. 自定义控制台格式
const consoleFormat = winston.format.printf(({ level, message, label, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level.toUpperCase()}]`;
    if (label) {
        msg += ` [${label}]`;
    }
    msg += `: ${message}`;

    // 如果有额外的元数据 (如对象)，也打印出来
    if (Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
});

// 4. 创建 Logger
const transports = [];

// 控制台输出
if (consoleEnabled) {
    transports.push(new winston.transports.Console({
        level: logLevel,
        format: winston.format.combine(
            winston.format.timestamp({ format: 'HH:mm:ss' }),
            winston.format.colorize(),
            consoleFormat
        )
    }));
}

// 文件输出 (滚动日志)
if (fileEnabled) {
    transports.push(new winston.transports.File({
        filename: path.join(logDir, 'app.log'),
        level: logLevel,
        maxsize: 5242880, // 5MB
        maxFiles: 5,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        )
    }));
}

const logger = winston.createLogger({
    level: logLevel,
    transports: transports
});

// 5. 导出
// 为了兼容旧代码的 logger.info，直接导出 logger
// 同时提供 createLogger 方法用于创建带 Label 的子日志
logger.create = (label) => {
    return logger.child({ label });
};

module.exports = { logger };
