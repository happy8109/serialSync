/**
 * 简化的拉式数据传输API测试
 * 不依赖串口连接，直接测试HTTP API功能
 */

const express = require('express');
const http = require('http');

// 模拟SerialManager的HTTP客户端功能
class MockSerialManager {
  constructor() {
    this.localServices = new Map();
    this.loadServicesFromConfig();
  }

  loadServicesFromConfig() {
    // 模拟从配置文件加载服务
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
    
    console.log('已加载的服务:', Array.from(this.localServices.values()).map(s => s.name));
  }

  getLocalServices() {
    return Array.from(this.localServices.values());
  }

  async callHttpService(endpoint, params = {}, options = {}) {
    const http = require('http');
    const url = require('url');

    return new Promise((resolve, reject) => {
      const parsedUrl = url.parse(endpoint);
      const method = options.method || 'GET';
      const timeout = options.timeout || 5000;
      
      let requestPath = parsedUrl.path;
      let postData = null;

      if (method === 'GET') {
        // GET请求：参数作为查询字符串
        const queryString = Object.keys(params).length > 0 
          ? '?' + Object.keys(params).map(key => `${key}=${encodeURIComponent(params[key])}`).join('&')
          : '';
        requestPath = parsedUrl.path + queryString;
      } else {
        // POST/PUT等请求：参数作为请求体
        postData = JSON.stringify(params);
      }

      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 80,
        path: requestPath,
        method: method,
        timeout: timeout,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SerialSync/1.0'
        }
      };

      if (postData) {
        requestOptions.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      console.log(`调用HTTP服务: ${method} ${endpoint}${requestPath}`);
      console.log('请求参数:', params);

      const req = http.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          console.log(`HTTP响应: ${res.statusCode} ${res.statusMessage}`);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('HTTP请求错误:', error.message);
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (postData) {
        req.write(postData);
      }
      
      req.end();
    });
  }

  async pullData(serviceId, params = {}) {
    const service = this.localServices.get(serviceId);
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }
    
    if (!service.enabled) {
      throw new Error(`Service ${serviceId} is disabled`);
    }

    if (service.type === 'http') {
      // 合并默认参数和请求参数
      const mergedParams = { ...service.defaultParams, ...params };
      
      // 调用HTTP服务
      return await this.callHttpService(service.endpoint, mergedParams, {
        method: service.method,
        timeout: service.timeout
      });
    } else {
      throw new Error(`Unsupported service type: ${service.type}`);
    }
  }
}

// 创建HTTP服务器
const app = express();
app.use(express.json());

const serialManager = new MockSerialManager();

// 获取服务列表
app.get('/api/services', (req, res) => {
  const services = serialManager.getLocalServices();
  res.json({ success: true, data: services });
});

// 拉取对端数据
app.get('/api/pull/:serviceId', async (req, res) => {
  try {
    const { serviceId } = req.params;
    const params = req.query;
    
    console.log(`\n=== 拉取请求 ===`);
    console.log(`服务ID: ${serviceId}`);
    console.log(`参数:`, params);
    
    const result = await serialManager.pullData(serviceId, params);
    
    // 尝试解析JSON响应
    try {
      const jsonResult = JSON.parse(result);
      res.json({ success: true, data: jsonResult });
    } catch (e) {
      res.set('Content-Type', 'text/plain');
      res.send(result);
    }
  } catch (error) {
    console.error('拉取失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST方式拉取数据
app.post('/api/pull/:serviceId', async (req, res) => {
  try {
    const { serviceId } = req.params;
    const params = req.body;
    
    console.log(`\n=== POST拉取请求 ===`);
    console.log(`服务ID: ${serviceId}`);
    console.log(`参数:`, params);
    
    const result = await serialManager.pullData(serviceId, params);
    
    try {
      const jsonResult = JSON.parse(result);
      res.json({ success: true, data: jsonResult });
    } catch (e) {
      res.set('Content-Type', 'text/plain');
      res.send(result);
    }
  } catch (error) {
    console.error('拉取失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 启动服务器
const server = app.listen(3001, () => {
  console.log('HTTP API测试服务器已启动，端口: 3001');
  console.log('\n=== 测试URL ===');
  console.log('GET http://localhost:3001/api/services - 获取服务列表');
  console.log('GET http://localhost:3001/api/pull/daily_brief - 拉取今日简报');
  console.log('GET http://localhost:3001/api/pull/daily_brief?date=2025-01-01 - 拉取指定日期简报');
  console.log('GET http://localhost:3001/api/pull/daily_brief?regions=魏都区,东城区 - 拉取指定辖区简报');
  console.log('GET http://localhost:3001/api/pull/daily_brief?order=name_asc - 拉取指定排序简报');
  console.log('\n=== 开始测试 ===');
  
  // 自动测试
  setTimeout(async () => {
    try {
      console.log('\n1. 测试获取服务列表...');
      const services = await fetch('http://localhost:3001/api/services').then(r => r.json());
      console.log('服务列表:', services);
      
      console.log('\n2. 测试拉取今日简报...');
      const today = await fetch('http://localhost:3001/api/pull/daily_brief').then(r => r.json());
      console.log('今日简报结果:', JSON.stringify(today, null, 2));
      
      console.log('\n3. 测试拉取指定日期简报...');
      const specific = await fetch('http://localhost:3001/api/pull/daily_brief?date=2025-01-01').then(r => r.json());
      console.log('指定日期简报结果:', JSON.stringify(specific, null, 2));
      
    } catch (error) {
      console.error('测试失败:', error.message);
    }
  }, 1000);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});
