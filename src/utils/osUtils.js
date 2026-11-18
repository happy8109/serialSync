/**
 * osUtils.js
 * 跨平台系统信息安全获取工具
 */

const os = require('os');

/**
 * 安全获取本机主机名。
 * 兼容 Windows 7 + Node.js 18+ 下 uv_os_gethostname 返回 ENOSYS 的异常场景。
 * @returns {string}
 */
function getSafeHostname() {
    try {
        return os.hostname() || process.env.COMPUTERNAME || process.env.HOSTNAME || 'localhost';
    } catch {
        return process.env.COMPUTERNAME || process.env.HOSTNAME || 'localhost';
    }
}

module.exports = {
    getSafeHostname
};
