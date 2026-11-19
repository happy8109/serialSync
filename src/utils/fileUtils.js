const fs = require('fs');
const crypto = require('crypto');

/**
 * 流式计算文件 MD5 值（32位小写十六进制），适用于任意大小文件
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function computeFileMd5(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

module.exports = {
    computeFileMd5
};
