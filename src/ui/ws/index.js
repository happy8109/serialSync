// WebSocket 服务实现
const WebSocket = require('ws');

let wsServer = null;

function initWebSocket(server) {
  wsServer = new WebSocket.Server({ 
    server,
    path: '/ws'  // 明确指定WebSocket路径
  });
  
  wsServer.on('connection', (ws, req) => {
    console.log('WebSocket客户端已连接:', req.socket.remoteAddress);
    
    ws.on('message', (msg) => {
      // 可扩展：处理前端发来的消息
      console.log('收到WebSocket消息:', msg.toString());
    });
    
    ws.on('close', () => {
      console.log('WebSocket客户端已断开');
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket错误:', error);
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
