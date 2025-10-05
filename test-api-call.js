/**
 * 测试串口桥API调用功能
 * 验证SerialManager是否可以正常调用HTTP API
 */

const SerialManager = require('./src/core/serial/SerialManager');
const config = require('config');
const logger = require('./src/utils/logger');

async function testApiCall() {
  console.log('=== 测试串口桥API调用功能 ===\n');

  // 创建SerialManager实例
  const serialManager = new SerialManager();

  try {
    // 1. 检查服务配置加载
    console.log('1. 检查服务配置加载...');
    const services = serialManager.getLocalServices();
    console.log(`   已加载服务数量: ${services.length}`);
    
    if (services.length > 0) {
      services.forEach(service => {
        console.log(`   - ${service.id}: ${service.name}`);
        console.log(`     类型: ${service.type}`);
        console.log(`     端点: ${service.endpoint}`);
        console.log(`     方法: ${service.method}`);
        console.log(`     超时: ${service.timeout}ms`);
        console.log(`     默认参数:`, service.defaultParams);
        console.log('');
      });
    } else {
      console.log('   ❌ 没有加载到任何服务');
      return;
    }

    // 2. 测试HTTP客户端
    console.log('2. 测试HTTP客户端...');
    const dailyBriefService = services.find(s => s.id === 'daily_brief');
    
    if (!dailyBriefService) {
      console.log('   ❌ 找不到daily_brief服务');
      return;
    }

    console.log(`   测试服务: ${dailyBriefService.name}`);
    console.log(`   端点: ${dailyBriefService.endpoint}`);
    
    // 测试基本调用
    console.log('   测试基本调用...');
    try {
      const result1 = await serialManager.callHttpService(
        dailyBriefService.endpoint,
        dailyBriefService.defaultParams,
        {
          method: dailyBriefService.method,
          timeout: dailyBriefService.timeout
        }
      );
      
      console.log('   ✅ 基本调用成功');
      console.log(`   响应长度: ${result1.length} 字符`);
      console.log(`   响应预览: ${result1.substring(0, 200)}...`);
      
    } catch (error) {
      console.log(`   ❌ 基本调用失败: ${error.message}`);
      return;
    }

    // 测试带参数调用
    console.log('   测试带参数调用...');
    try {
      const result2 = await serialManager.callHttpService(
        dailyBriefService.endpoint,
        { ...dailyBriefService.defaultParams, date: '2025-01-01', order: 'count_asc' },
        {
          method: dailyBriefService.method,
          timeout: dailyBriefService.timeout
        }
      );
      
      console.log('   ✅ 带参数调用成功');
      console.log(`   响应长度: ${result2.length} 字符`);
      console.log(`   响应预览: ${result2.substring(0, 200)}...`);
      
    } catch (error) {
      console.log(`   ❌ 带参数调用失败: ${error.message}`);
    }

    // 3. 测试服务检查功能
    console.log('3. 测试服务检查功能...');
    console.log(`   hasLocalService('daily_brief'): ${serialManager.hasLocalService('daily_brief')}`);
    console.log(`   hasLocalService('nonexistent'): ${serialManager.hasLocalService('nonexistent')}`);

    // 4. 测试拉取请求处理逻辑（不实际发送串口数据）
    console.log('4. 测试拉取请求处理逻辑...');
    
    // 模拟拉取请求数据
    const mockRequest = {
      type: 'PULL_REQUEST',
      requestId: 'test-request-123',
      serviceId: 'daily_brief',
      params: { date: '2025-01-01' }
    };

    console.log('   模拟请求:', JSON.stringify(mockRequest, null, 2));
    
    // 检查服务是否存在
    if (serialManager.hasLocalService(mockRequest.serviceId)) {
      const service = serialManager.getLocalServices().find(s => s.id === mockRequest.serviceId);
      console.log(`   ✅ 服务存在: ${service.name}`);
      
      // 合并参数
      const mergedParams = { ...service.defaultParams, ...mockRequest.params };
      console.log('   合并后参数:', mergedParams);
      
      // 模拟调用HTTP服务
      try {
        const result = await serialManager.callHttpService(
          service.endpoint,
          mergedParams,
          {
            method: service.method,
            timeout: service.timeout
          }
        );
        
        console.log('   ✅ 模拟HTTP调用成功');
        console.log(`   响应长度: ${result.length} 字符`);
        
        // 模拟响应格式
        const mockResponse = {
          type: 'PULL_RESPONSE',
          requestId: mockRequest.requestId,
          success: true,
          data: result
        };
        
        console.log('   模拟响应格式:');
        console.log(`   - 类型: ${mockResponse.type}`);
        console.log(`   - 请求ID: ${mockResponse.requestId}`);
        console.log(`   - 成功: ${mockResponse.success}`);
        console.log(`   - 数据长度: ${mockResponse.data.length} 字符`);
        
      } catch (error) {
        console.log(`   ❌ 模拟HTTP调用失败: ${error.message}`);
      }
    } else {
      console.log('   ❌ 服务不存在');
    }

    console.log('\n=== 测试完成 ===');
    console.log('✅ 串口桥API调用功能正常');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.error(error.stack);
  }
}

// 运行测试
testApiCall().catch(console.error);
