// WebSocket 服务实现
const WebSocket = require('ws');

let wsServer = null;

function initWebSocket(server) {
  wsServer = new WebSocket.Server({ server });
  wsServer.on('connection', (ws) => {
    ws.on('message', (msg) => {
      // 可扩展：处理前端发来的消息
    });
  });
  return wsServer;
}

function broadcast(data) {
  if (!wsServer) return;
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  wsServer.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

module.exports = { initWebSocket, broadcast };
