/**
 * ecosystem.config.js
 * PM2 生产环境配置
 * 
 * 使用方法:
 *   1. 先构建前端: npm run build
 *   2. 启动服务:   pm2 start ecosystem.config.js
 *   3. 查看状态:   pm2 status
 *   4. 查看日志:   pm2 logs serialsync
 *   5. 重启:       pm2 restart serialsync
 *   6. 停止:       pm2 stop serialsync
 */
module.exports = {
    apps: [{
        name: 'serialsync',
        script: 'src/server/index.js',
        cwd: __dirname,
        instances: 1,           // 必须单实例！串口是独占资源
        exec_mode: 'fork',
        autorestart: true,
        max_restarts: 10,
        restart_delay: 2000,    // 重启间隔 2 秒，等待串口释放
        watch: false,
        env: {
            NODE_ENV: 'production'
        }
    }]
};
