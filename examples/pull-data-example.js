/**
 * 拉式数据传输功能使用示例（配置文件版本）
 * 
 * 这个示例展示了如何使用配置文件管理服务：
 * 1. 在 config/default.json 中配置服务
 * 2. SerialManager 自动从配置文件加载服务
 * 3. 支持HTTP API调用和自定义处理函数
 */

const SerialManager = require('../src/core/serial/SerialManager');
const express = require('express');
const http = require('http');

// ==================== A端示例（服务提供方） ====================

class ServiceProvider {
  constructor() {
    this.serialManager = new SerialManager();
    this.setupCustomHandlers();
  }

  async start() {
    // 连接串口
    await this.serialManager.connect();
    
    // 注册自定义处理函数（用于非HTTP服务）
    this.serialManager.onPullRequest(async (serviceId, params) => {
      return await this.handleCustomRequest(serviceId, params);
    });

    console.log('A端服务提供方已启动');
    console.log('已加载的服务:', this.serialManager.getLocalServices().map(s => s.name));
  }

  setupCustomHandlers() {
    // 可以在这里添加自定义服务处理逻辑
    // 配置文件中的服务会自动加载，无需手动注册
  }

  async handleCustomRequest(serviceId, params) {
    // 处理非HTTP类型的服务请求
    console.log(`处理自定义请求: ${serviceId}`, params);

    switch (serviceId) {
      case 'custom_service':
        return JSON.stringify({
          message: 'This is a custom service response',
          timestamp: new Date().toISOString(),
          params: params
        });
      
      default:
        throw new Error(`Unknown custom service: ${serviceId}`);
    }
  }
}

// ==================== B端示例（服务消费方） ====================

class ServiceConsumer {
  constructor() {
    this.serialManager = new SerialManager();
    this.app = express();
    this.setupAPI();
  }

  async start() {
    // 连接串口
    await this.serialManager.connect();
    
    // 启动HTTP服务器
    this.server = this.app.listen(3001, () => {
      console.log('B端HTTP服务已启动，端口: 3001');
    });

    console.log('B端服务消费方已启动');
  }

  setupAPI() {
    // 获取服务列表
    this.app.get('/api/services', (req, res) => {
      const services = this.serialManager.getLocalServices();
      res.json({ success: true, data: services });
    });

    // 拉取对端数据
    this.app.get('/api/pull/:serviceId', async (req, res) => {
      try {
        const { serviceId } = req.params;
        const params = req.query;
        
        console.log(`拉取对端数据: ${serviceId}`, params);
        const result = await this.serialManager.pullData(serviceId, params);
        
        // 尝试解析JSON响应
        try {
          const jsonResult = JSON.parse(result);
          res.json({ success: true, data: jsonResult });
        } catch (e) {
          res.set('Content-Type', 'text/plain');
          res.send(result);
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // POST方式拉取数据
    this.app.post('/api/pull/:serviceId', async (req, res) => {
      try {
        const { serviceId } = req.params;
        const params = req.body;
        
        console.log(`拉取对端数据: ${serviceId}`, params);
        const result = await this.serialManager.pullData(serviceId, params);
        
        try {
          const jsonResult = JSON.parse(result);
          res.json({ success: true, data: jsonResult });
        } catch (e) {
          res.set('Content-Type', 'text/plain');
          res.send(result);
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 测试配置中的服务
    this.app.get('/api/test/:serviceId', async (req, res) => {
      try {
        const { serviceId } = req.params;
        const params = req.query;
        
        console.log(`测试服务: ${serviceId}`, params);
        const result = await this.serialManager.pullData(serviceId, params);
        
        res.json({ 
          success: true, 
          serviceId: serviceId,
          result: result,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }
}

// ==================== 使用示例 ====================

async function runExample() {
  console.log('=== 拉式数据传输功能示例（配置文件版本） ===\n');

  // 启动A端（服务提供方）
  console.log('启动A端服务提供方...');
  const provider = new ServiceProvider();
  await provider.start();

  // 等待一下让A端完全启动
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 启动B端（服务消费方）
  console.log('启动B端服务消费方...');
  const consumer = new ServiceConsumer();
  await consumer.start();

  // 等待一下让B端完全启动
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('\n=== 测试配置中的服务 ===');
  
  // 测试每日简报服务
  try {
    console.log('测试每日简报服务...');
    const briefResult = await consumer.serialManager.pullData('daily_brief', {
      date: '2025-01-01',
      regions: '魏都区,东城区'
    });
    console.log('每日简报结果:', briefResult);
  } catch (error) {
    console.error('每日简报服务拉取失败:', error.message);
  }

  // 测试今日简报（无参数）
  try {
    console.log('测试今日简报（默认参数）...');
    const todayResult = await consumer.serialManager.pullData('daily_brief', {});
    console.log('今日简报结果:', todayResult);
  } catch (error) {
    console.error('今日简报拉取失败:', error.message);
  }

  console.log('\n=== HTTP API测试 ===');
  console.log('可以通过以下URL测试HTTP API:');
  console.log('GET http://localhost:3001/api/services - 获取服务列表');
  console.log('GET http://localhost:3001/api/pull/daily_brief - 拉取今日简报');
  console.log('GET http://localhost:3001/api/pull/daily_brief?date=2025-01-01 - 拉取指定日期简报');
  console.log('GET http://localhost:3001/api/pull/daily_brief?regions=魏都区,东城区 - 拉取指定辖区简报');
  console.log('GET http://localhost:3001/api/test/daily_brief?date=2025-01-01&order=count_asc - 测试服务');
}

// 如果直接运行此文件，则执行示例
if (require.main === module) {
  runExample().catch(console.error);
}

module.exports = { ServiceProvider, ServiceConsumer };
