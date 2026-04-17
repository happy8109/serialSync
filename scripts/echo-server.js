#!/usr/bin/env node
/**
 * echo-server.js
 * 开发用轻量 Echo/Mock Server（零外部依赖）
 * 
 * 用途：模拟远程 API 服务，记录所有收到的请求，返回预设或回显响应。
 * 适用于 API 透明代理、网关模式等功能的开发调试。
 * 
 * 使用方法：
 *   node scripts/echo-server.js [端口号]
 *   node scripts/echo-server.js 11434      # 模拟 Ollama
 *   node scripts/echo-server.js 8080       # 通用 mock
 */

const http = require('http');

const PORT = parseInt(process.argv[2]) || 11434;
let requestCount = 0;

// ============================================================
// 预设 Mock 响应（可按需扩展）
// key 格式: "METHOD /path"
// ============================================================
const mockRoutes = {
    // Ollama API 模拟
    'GET /api/tags': {
        models: [
            { name: 'qwen2:latest', size: 4661211616, details: { family: 'qwen2', parameter_size: '7B', quantization_level: 'Q4_0' } },
            { name: 'llama3:latest', size: 3825819519, details: { family: 'llama', parameter_size: '8B', quantization_level: 'Q4_0' } }
        ]
    },

    'POST /api/generate': {
        model: 'qwen2:latest',
        created_at: new Date().toISOString(),
        response: '你好！我是 Echo Server 模拟的 AI 回复。这是一条来自 Mock 服务的测试响应。',
        done: true,
        total_duration: 1234567890,
        eval_count: 42
    },

    'POST /api/chat': {
        model: 'qwen2:latest',
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: '你好！我是 Echo Server 模拟的 AI 助手。有什么可以帮你的？' },
        done: true,
        total_duration: 987654321,
        eval_count: 36
    },

    'GET /api/version': {
        version: '0.0.0-echo-server'
    },

    'POST /api/show': {
        modelfile: '# Mock Modelfile\nFROM qwen2\nSYSTEM You are a helpful assistant.',
        parameters: 'temperature 0.7\ntop_p 0.9',
        template: '{{ .System }}\n{{ .Prompt }}'
    },

    // 通用测试接口
    'GET /health': { status: 'ok', server: 'echo-server' },
    'GET /api/status': { status: 'running', uptime: process.uptime() }
};

// ============================================================
// 请求处理
// ============================================================
const server = http.createServer((req, res) => {
    requestCount++;
    const startTime = Date.now();

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        // 解析请求
        const url = new URL(req.url, `http://localhost:${PORT}`);
        const routeKey = `${req.method} ${url.pathname}`;
        let parsedBody = null;

        if (body) {
            try { parsedBody = JSON.parse(body); } catch (e) { parsedBody = body; }
        }

        // 打印请求日志
        const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`[#${requestCount}] ${timestamp}`);
        console.log(`  ${req.method} ${req.url}`);

        if (url.searchParams.toString()) {
            console.log(`  Query: ${url.searchParams.toString()}`);
        }

        // 仅打印非标准请求头
        const interestingHeaders = {};
        for (const [k, v] of Object.entries(req.headers)) {
            if (!['host', 'connection', 'accept', 'user-agent', 'content-length', 'accept-encoding'].includes(k)) {
                interestingHeaders[k] = v;
            }
        }
        if (Object.keys(interestingHeaders).length > 0) {
            console.log(`  Headers: ${JSON.stringify(interestingHeaders)}`);
        }

        if (parsedBody) {
            const bodyStr = JSON.stringify(parsedBody, null, 2);
            // 截断过长的 body
            if (bodyStr.length > 500) {
                console.log(`  Body (${bodyStr.length} chars): ${bodyStr.substring(0, 500)}...`);
            } else {
                console.log(`  Body: ${bodyStr}`);
            }
        }

        // 查找预设响应
        const mockData = mockRoutes[routeKey];
        let responseData;
        let statusCode = 200;

        if (mockData) {
            responseData = typeof mockData === 'function' ? mockData(parsedBody, url) : mockData;
            console.log(`  → 200 Mock 响应 (预设路由匹配)`);
        } else {
            // 未匹配路由：返回回显信息
            responseData = {
                echo: true,
                message: 'Echo Server - 未匹配预设路由，原样回显请求',
                request: {
                    method: req.method,
                    path: url.pathname,
                    query: Object.fromEntries(url.searchParams),
                    headers: interestingHeaders,
                    body: parsedBody
                },
                timestamp: new Date().toISOString()
            };
            console.log(`  → 200 Echo 响应 (回显模式)`);
        }

        const elapsed = Date.now() - startTime;
        console.log(`  耗时: ${elapsed}ms`);

        // 发送响应
        const responseBody = JSON.stringify(responseData, null, 2);
        res.writeHead(statusCode, {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Echo-Server': 'true',
            'X-Request-Id': `echo_${requestCount}`
        });
        res.end(responseBody);
    });
});

// ============================================================
// 启动
// ============================================================
server.listen(PORT, () => {
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Echo Server 已启动`);
    console.log(`  监听端口: ${PORT}`);
    console.log(`  地址: http://localhost:${PORT}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`\n预设路由:`);
    for (const key of Object.keys(mockRoutes)) {
        console.log(`  ${key}`);
    }
    console.log(`\n其他路由将以 Echo 模式回显请求内容。`);
    console.log(`按 Ctrl+C 停止。\n`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`端口 ${PORT} 已被占用，请换一个端口：node scripts/echo-server.js <其他端口>`);
    } else {
        console.error('服务器错误:', err);
    }
    process.exit(1);
});
