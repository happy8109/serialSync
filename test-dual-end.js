/**
 * 双端串口桥拉式数据传输测试
 * 模拟A端（服务提供方）和B端（服务消费方）的通信
 */

const EventEmitter = require('events');

// 模拟串口连接
class MockSerialConnection extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.isConnected = false;
    this.peer = null;
  }

  connect(peer) {
    this.peer = peer;
    this.isConnected = true;
    console.log(`${this.name} 已连接`);
    this.emit('connected');
  }

  connectTo(peer) {
    this.peer = peer;
    peer.peer = this;
    this.isConnected = true;
    peer.isConnected = true;
    console.log(`${this.name} 连接到 ${peer.name}`);
    this.emit('connected');
    peer.emit('connected');
  }

  send(data) {
    if (!this.isConnected || !this.peer) {
      throw new Error(`${this.name} 未连接`);
    }
    
    console.log(`${this.name} 发送:`, data);
    
    // 模拟串口传输延迟
    setTimeout(() => {
      this.peer.receive(data);
    }, 10);
  }

  receive(data) {
    console.log(`${this.name} 接收:`, data);
    this.emit('data', data);
  }

  disconnect() {
    this.isConnected = false;
    this.peer = null;
    console.log(`${this.name} 已断开`);
    this.emit('disconnected');
  }
}

// A端：服务提供方
class ServiceProvider {
  constructor() {
    this.connection = new MockSerialConnection('A端');
    this.localServices = new Map();
    this.loadServices();
    this.setupHandlers();
  }

  loadServices() {
    // 从配置文件加载服务
    this.localServices.set('daily_brief', {
      id: 'daily_brief',
      name: '每日简报',
      description: '生成指定日期的每日简报，包含结构化数据和中文简报文本',
      version: '1.0',
      type: 'http',
      endpoint: 'http://localhost:3000/api/stats/daily/brief',
      method: 'GET',
      timeout: 10000,
      defaultParams: {
        order: 'count_desc'
      },
      enabled: true,
      registeredAt: Date.now(),
      fromConfig: true
    });
    
    console.log('A端已加载服务:', Array.from(this.localServices.values()).map(s => s.name));
  }

  setupHandlers() {
    this.connection.on('data', (data) => {
      this.handlePullRequest(data);
    });
  }

  async handlePullRequest(data) {
    let request;
    try {
      request = JSON.parse(data);
      
      if (request.type === 'PULL_REQUEST') {
        const { requestId, serviceId, params } = request;
        
        console.log(`\n=== A端处理拉取请求 ===`);
        console.log(`请求ID: ${requestId}`);
        console.log(`服务ID: ${serviceId}`);
        console.log(`参数:`, params);

        // 检查服务是否存在
        if (!this.localServices.has(serviceId)) {
          throw new Error(`Service ${serviceId} not found`);
        }

        const service = this.localServices.get(serviceId);
        if (!service.enabled) {
          throw new Error(`Service ${serviceId} is disabled`);
        }

        // 调用HTTP API
        const result = await this.callHttpService(service.endpoint, { ...service.defaultParams, ...params });
        
        // 发送响应
        const response = {
          type: 'PULL_RESPONSE',
          requestId,
          success: true,
          data: result
        };

        this.connection.send(JSON.stringify(response));
        console.log(`A端发送响应: 成功`);
        
      }
    } catch (error) {
      console.error('A端处理请求失败:', error.message);
      
      // 发送错误响应
      const response = {
        type: 'PULL_RESPONSE',
        requestId: request.requestId || 'unknown',
        success: false,
        error: error.message
      };
      
      this.connection.send(JSON.stringify(response));
    }
  }

  async callHttpService(endpoint, params = {}) {
    const http = require('http');
    const url = require('url');

    return new Promise((resolve, reject) => {
      const parsedUrl = url.parse(endpoint);
      
      // 构建查询参数
      const queryString = Object.keys(params).length > 0 
        ? '?' + Object.keys(params).map(key => `${key}=${encodeURIComponent(params[key])}`).join('&')
        : '';

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 80,
        path: parsedUrl.path + queryString,
        method: 'GET',
        timeout: 10000,
        headers: {
          'User-Agent': 'SerialSync/1.0'
        }
      };

      console.log(`A端调用HTTP: ${options.method} ${endpoint}${queryString}`);

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  connect(peer) {
    this.connection.connectTo(peer.connection);
  }
}

// B端：服务消费方
class ServiceConsumer {
  constructor() {
    this.connection = new MockSerialConnection('B端');
    this.pendingRequests = new Map();
    this.setupHandlers();
  }

  setupHandlers() {
    this.connection.on('data', (data) => {
      this.handlePullResponse(data);
    });
  }

  async pullData(serviceId, params = {}) {
    const requestId = this.generateRequestId();
    const request = {
      type: 'PULL_REQUEST',
      requestId,
      serviceId,
      params
    };

    console.log(`\n=== B端发送拉取请求 ===`);
    console.log(`请求ID: ${requestId}`);
    console.log(`服务ID: ${serviceId}`);
    console.log(`参数:`, params);

    // 发送请求
    this.connection.send(JSON.stringify(request));

    // 等待响应
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, 30000);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout
      });
    });
  }

  handlePullResponse(data) {
    try {
      const response = JSON.parse(data);
      
      if (response.type === 'PULL_RESPONSE') {
        const { requestId, success, data: responseData, error } = response;
        const pending = this.pendingRequests.get(requestId);

        console.log(`\n=== B端接收响应 ===`);
        console.log(`请求ID: ${requestId}`);
        console.log(`成功: ${success}`);

        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(requestId);

          if (success) {
            console.log('响应数据:', JSON.stringify(responseData, null, 2));
            pending.resolve(responseData);
          } else {
            console.error('响应错误:', error);
            pending.reject(new Error(error));
          }
        }
      }
    } catch (error) {
      console.error('B端处理响应失败:', error.message);
    }
  }

  generateRequestId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  connect(peer) {
    this.connection.connectTo(peer.connection);
  }
}

// 测试函数
async function runTest() {
  console.log('=== 双端串口桥拉式数据传输测试 ===\n');

  // 创建A端和B端
  const provider = new ServiceProvider();
  const consumer = new ServiceConsumer();

  // 连接两端
  provider.connect(consumer);

  // 等待连接建立
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('\n' + '='.repeat(60) + '\n');

  // 测试1: 拉取今日简报
  try {
    console.log('测试1: 拉取今日简报');
    const result1 = await consumer.pullData('daily_brief', {});
    console.log('测试1结果: 成功');
  } catch (error) {
    console.error('测试1失败:', error.message);
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // 测试2: 拉取指定日期简报
  try {
    console.log('测试2: 拉取指定日期简报');
    const result2 = await consumer.pullData('daily_brief', {
      date: '2025-01-01',
      order: 'count_asc'
    });
    console.log('测试2结果: 成功');
  } catch (error) {
    console.error('测试2失败:', error.message);
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // 测试3: 拉取不存在的服务
  try {
    console.log('测试3: 拉取不存在的服务');
    const result3 = await consumer.pullData('nonexistent_service', {});
    console.log('测试3结果: 成功');
  } catch (error) {
    console.error('测试3失败:', error.message);
  }

  console.log('\n=== 测试完成 ===');
}

// 运行测试
runTest().catch(console.error);
