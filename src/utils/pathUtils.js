/**
 * utils/pathUtils.js
 * 路径处理工具
 */

const os = require('os');
const path = require('path');

/**
 * 将路径解析为绝对物理路径
 * 1. 处理 ~ 符号 (解析为用户家目录)
 * 2. 处理相对路径 (相对于 process.cwd())
 * 3. 规范化路径分隔符
 * 
 * @param {string} p 原始路径
 * @returns {string} 解析后的绝对路径
 */
function resolvePath(p) {
    if (!p) return p;

    let resolvedPath = p;

    // 1. 处理 ~ 符号
    if (p === '~') {
        resolvedPath = os.homedir();
    } else if (p.startsWith('~/') || p.startsWith('~\\')) {
        resolvedPath = path.join(os.homedir(), p.slice(2));
    }

    // 2. 转换为绝对路径
    // path.resolve 会自动处理跨平台的分隔符兼容性
    return path.resolve(resolvedPath);
}

/**
 * 规范化路径，主要用于跨系统传输时的内部路径表示 (统一使用 /)
 * @param {string} p 
 */
function normalizePath(p) {
    if (!p) return p;
    return p.replace(/\\/g, '/');
}

module.exports = {
    resolvePath,
    normalizePath
};
