/**
 * 直接测试每日简报API
 */

const http = require('http');

async function testDailyBriefAPI() {
  console.log('=== 测试每日简报API ===\n');
  
  // 测试1: 基本调用
  console.log('1. 测试基本调用...');
  try {
    const result1 = await callAPI('http://localhost:3000/api/stats/daily/brief');
    console.log('基本调用结果:', JSON.stringify(result1, null, 2));
  } catch (error) {
    console.error('基本调用失败:', error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // 测试2: 带参数调用
  console.log('2. 测试带参数调用...');
  try {
    const result2 = await callAPI('http://localhost:3000/api/stats/daily/brief?date=2025-01-01&order=count_asc');
    console.log('带参数调用结果:', JSON.stringify(result2, null, 2));
  } catch (error) {
    console.error('带参数调用失败:', error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // 测试3: 通过拉式API调用
  console.log('3. 测试通过拉式API调用...');
  try {
    const result3 = await callAPI('http://localhost:3001/api/pull/daily_brief');
    console.log('拉式API调用结果:', JSON.stringify(result3, null, 2));
  } catch (error) {
    console.error('拉式API调用失败:', error.message);
  }
}

function callAPI(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = require('url').parse(url);
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.path,
      method: 'GET',
      timeout: 10000,
      headers: {
        'User-Agent': 'SerialSync-Test/1.0'
      }
    };

    console.log(`调用: ${options.method} ${url}`);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log(`响应: ${res.statusCode} ${res.statusMessage}`);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (e) {
            resolve(data);
          }
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

// 运行测试
testDailyBriefAPI().catch(console.error);
