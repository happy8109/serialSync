/**
 * test-source-server.js
 * 用于验证 serialSync 通用 HTTP/1.1 透明反向代理（Virtual Port）的源服务测试程序
 * 零第三方依赖，纯 Node.js 原生模块实现
 *
 * 启动方式：node scripts/test-source-server.js [port]
 * 默认端口：8090
 */

const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8090', 10);

// 1x1 红色 PNG 合法二进制图片（用于测试二进制图片透传不损坏）
const SAMPLE_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAADklEQVQI12P4z8DwHwMDAxQA' +
    'AgwAAQUBAwEAAQAAAP//AwD8/wEAAQEAAAEBAQEAAQEBAQAAAQEBAQEBAQEBAQEBAQEBAQEA' +
    'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEA' +
    'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAP//';

// 生成一个有效的 8x8 RGBA PNG（纯原生 zlib 无依赖构造，确保浏览器 100% 正常渲染）
function createValidPngBuffer() {
    const zlib = require('zlib');
    const width = 16;
    const height = 16;
    const raw = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        const rowStart = y * (1 + width * 4);
        raw[rowStart] = 0; // filter type 0
        for (let x = 0; x < width; x++) {
            const px = rowStart + 1 + x * 4;
            raw[px] = 37;      // R
            raw[px + 1] = 99;  // G
            raw[px + 2] = 235; // B
            raw[px + 3] = 255; // A
        }
    }
    const idatData = zlib.deflateSync(raw);

    function crc32(buf) {
        let c = 0xffffffff;
        for (let i = 0; i < buf.length; i++) {
            c ^= buf[i];
            for (let k = 0; k < 8; k++) {
                c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
            }
        }
        return (c ^ 0xffffffff) >>> 0;
    }

    function chunk(type, data) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const typeBuf = Buffer.from(type, 'ascii');
        const crcBuf = Buffer.alloc(4);
        crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
        return Buffer.concat([len, typeBuf, data, crcBuf]);
    }

    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
        sig,
        chunk('IHDR', ihdr),
        chunk('IDAT', idatData),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

const VALID_PNG = createValidPngBuffer();

const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>serialSync 透明反代测试源站</title>
  <link rel="stylesheet" href="/assets/style.css" />
</head>
<body>
  <div class="card">
    <div class="header">
      <img src="/assets/logo.png" alt="PNG测试" class="logo" />
      <h1>serialSync 透明反向代理测试源站</h1>
    </div>
    <p class="tip">如果你通过远程虚拟端口（如 <code>http://127.0.0.1:18080/</code>）看到此页面且样式、图片正常加载，说明静态资源与绝对路径透传已成功。</p>
    <div class="actions">
      <button onclick="runTest('GET', '/api/echo?page=1&tag=a%2Bb&arr[]=1&arr[]=2')">测试 GET + Raw Query</button>
      <button onclick="runTest('POST', '/api/echo?from=web', { hello: 'serialSync', count: 42 })">测试 POST JSON</button>
      <button onclick="runTest('PUT', '/api/echo', { action: 'update' })">测试 PUT</button>
      <button onclick="runTest('DELETE', '/api/echo?id=99')">测试 DELETE</button>
      <button onclick="runTest('GET', '/api/status/404')">测试 404 状态码透传</button>
      <button onclick="runTest('GET', '/api/large-json')">测试大 JSON (分片+压缩)</button>
      <a class="btn-link" href="/download/sample.bin">下载二进制文件</a>
    </div>
    <div class="upload-box">
      <input type="file" id="fileInput" />
      <button onclick="uploadFile()">测试 Multipart 文件上传</button>
    </div>
    <pre id="output">点击上方按钮开始测试...</pre>
  </div>
  <script src="/assets/app.js"></script>
</body>
</html>`;

const STYLE_CSS = `body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px; }
.card { max-width: 820px; margin: 0 auto; background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; }
.header { display: flex; align-items: center; gap: 12px; }
.logo { width: 32px; height: 32px; border-radius: 6px; border: 1px solid #60a5fa; }
.tip { color: #94a3b8; font-size: 14px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
button, .btn-link { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 14px; cursor: pointer; font-size: 13px; text-decoration: none; }
button:hover, .btn-link:hover { background: #1d4ed8; }
.upload-box { margin: 12px 0; display: flex; gap: 8px; align-items: center; }
pre { background: #020617; color: #38bdf8; padding: 14px; border-radius: 8px; overflow: auto; max-height: 360px; font-size: 12px; }`;

const APP_JS = `async function runTest(method, url, body) {
  const out = document.getElementById('output');
  out.textContent = '请求中: ' + method + ' ' + url;
  try {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    out.textContent = 'HTTP ' + res.status + ' ' + res.statusText + '\\n' + text;
  } catch (err) {
    out.textContent = '请求失败: ' + err.message;
  }
}

async function uploadFile() {
  const input = document.getElementById('fileInput');
  const out = document.getElementById('output');
  if (!input.files || !input.files[0]) {
    out.textContent = '请先选择一个文件';
    return;
  }
  const fd = new FormData();
  fd.append('file', input.files[0]);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  out.textContent = 'HTTP ' + res.status + '\\n' + (await res.text());
}`;

const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const pathname = parsed.pathname;
    const chunks = [];

    req.on('data', c => chunks.push(c));
    req.on('end', () => {
        const bodyBuf = Buffer.concat(chunks);
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} (${bodyBuf.length}B)`);

        if (pathname === '/' || pathname === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(INDEX_HTML);
        }

        if (pathname === '/assets/style.css') {
            res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
            return res.end(STYLE_CSS);
        }

        if (pathname === '/assets/app.js') {
            res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
            return res.end(APP_JS);
        }

        if (pathname === '/assets/logo.png') {
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': VALID_PNG.length });
            return res.end(VALID_PNG);
        }

        if (pathname === '/download/sample.bin') {
            const bin = Buffer.alloc(1024);
            for (let i = 0; i < bin.length; i++) bin[i] = i % 256;
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': 'attachment; filename="sample.bin"',
                'Content-Length': bin.length
            });
            return res.end(bin);
        }

        if (pathname === '/api/echo') {
            const payload = {
                ok: true,
                method: req.method,
                rawUrl: req.url,
                pathname,
                query: Object.fromEntries(parsed.searchParams.entries()),
                headers: req.headers,
                bodySize: bodyBuf.length,
                bodyText: bodyBuf.toString('utf8'),
                timestamp: new Date().toISOString()
            };
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Echo-Server': 'serialSync-Test' });
            return res.end(JSON.stringify(payload, null, 2));
        }

        if (pathname.startsWith('/api/status/')) {
            const code = parseInt(pathname.split('/').pop(), 10) || 200;
            res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'X-Test-Status': String(code) });
            if (code === 204 || code === 304) return res.end();
            return res.end(JSON.stringify({ statusCode: code, message: `Simulated HTTP ${code}` }));
        }

        if (pathname === '/api/large-json') {
            const items = Array.from({ length: 80 }, (_, i) => ({
                index: i + 1,
                name: `serialSync-node-item-${i + 1}`,
                description: '用于验证超过 4KB 分片重组与 zlib 低带宽串口压缩传输的测试数据项'
            }));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ total: items.length, items }, null, 2));
        }

        if (pathname === '/api/upload') {
            const md5 = crypto.createHash('md5').update(bodyBuf).digest('hex');
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
                ok: true,
                contentType: req.headers['content-type'] || '',
                receivedBytes: bodyBuf.length,
                md5
            }, null, 2));
        }

        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`==================================================`);
    console.log(`serialSync 透明反代测试源服务已启动`);
    console.log(`监听地址: http://127.0.0.1:${PORT}`);
    console.log(`请在源端串口桥 (如 A1s) 注册此地址，模式选择 [透明反代]`);
    console.log(`==================================================`);
});
