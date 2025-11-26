#!/usr/bin/env node

/**
 * 端口管理工具
 * 检查端口占用情况，并提供清除占用进程的功能
 * 
 * 用法:
 *   node port-manager.js                    # 检查所有可用串口
 *   node port-manager.js COM4               # 检查指定串口
 *   node port-manager.js COM4 COM5          # 检查多个指定串口
 *   node port-manager.js --help             # 显示帮助信息
 */

const { SerialPort } = require('serialport');
const { exec } = require('child_process');
const { promisify } = require('util');
const readline = require('readline');

const execAsync = promisify(exec);

// 创建readline接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 将readline.question包装为Promise
function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function checkPortUsage(targetPorts = null) {
  console.log('=== 端口占用检查工具 ===\n');
  
  try {
    let portsToCheck = [];
    
    if (targetPorts && targetPorts.length > 0) {
      // 检查指定的串口（包括虚拟串口）
      console.log(`检查指定串口: ${targetPorts.join(', ')}`);
      portsToCheck = targetPorts.map(portName => ({ path: portName }));
    } else {
      // 获取所有可用串口
      console.log('扫描系统注册的串口...');
      const availablePorts = await SerialPort.list();
      
      if (availablePorts.length === 0) {
        console.log('   ❌ 未发现任何系统注册的串口设备');
        console.log('   💡 提示: 虚拟串口可能不会出现在系统扫描列表中');
        console.log('   💡 建议: 使用 "node check-ports.js COM4" 直接检查指定串口');
        return [];
      }
      
      console.log(`   ✅ 发现 ${availablePorts.length} 个系统注册的串口设备:`);
      availablePorts.forEach(port => {
        console.log(`   - ${port.path} (${port.manufacturer || 'Unknown'})`);
      });
      console.log('');
      console.log('   💡 提示: 虚拟串口(如COM4, COM5等)可能不会出现在上述列表中');
      console.log('   💡 建议: 使用 "node check-ports.js COM4 COM5" 直接检查虚拟串口');
      console.log('');
      
      portsToCheck = availablePorts;
    }
    
    // 检查每个串口的占用情况
    console.log('检查串口占用情况...');
    
    const occupiedPorts = [];
    
    for (const port of portsToCheck) {
      console.log(`\n检查 ${port.path}:`);
      
      try {
        // 尝试打开串口
        const testPort = new SerialPort({
          path: port.path,
          baudRate: 9600,
          autoOpen: false
        });
        
        await new Promise((resolve, reject) => {
          testPort.open((err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
        
        // 如果能打开，说明没有被占用
        console.log(`   ✅ ${port.path} 可用`);
        testPort.close();
        
      } catch (error) {
        // 如果打开失败，说明被占用
        console.log(`   ❌ ${port.path} 被占用`);
        console.log(`   错误: ${error.message}`);
        
        const portInfo = {
          port: port.path,
          error: error.message,
          processes: []
        };
        
        // 尝试获取占用进程信息（Windows）
        if (process.platform === 'win32') {
          try {
            // 方法1: 通过命令行查找
            const { stdout: stdout1 } = await execAsync(`wmic process where "CommandLine like '%${port.path}%'" get ProcessId,Name,CommandLine /format:csv`);
            const lines1 = stdout1.split('\n').filter(line => 
              line.trim() && 
              !line.includes('NodeId') && 
              !line.includes('ProcessId,Name,CommandLine') &&
              line.includes(',')
            );
            
            // 方法2: 通过进程名查找所有Node.js进程
            const { stdout: stdout2 } = await execAsync(`wmic process where "name='node.exe'" get ProcessId,Name,CommandLine /format:csv`);
            const lines2 = stdout2.split('\n').filter(line => 
              line.trim() && 
              !line.includes('NodeId') && 
              !line.includes('ProcessId,Name,CommandLine') &&
              line.includes(',')
            );
            
            // 方法3: 使用PowerShell查找
            let powershellResult = [];
            try {
              const { stdout: stdout3 } = await execAsync(`powershell "Get-Process | Where-Object {$_.ProcessName -eq 'node'} | Select-Object Id,ProcessName,Path | ConvertTo-Csv -NoTypeInformation"`);
              const lines3 = stdout3.split('\n').filter(line => line.trim() && line.includes(','));
              powershellResult = lines3.slice(1); // 跳过标题行
            } catch (e) {
              // PowerShell方法失败，继续使用其他方法
            }
            
            console.log(`   占用进程:`);
            
            // 处理命令行查找结果
            lines1.forEach(line => {
              const parts = line.split(',');
              if (parts.length >= 4) {
                const pid = parts[1]?.replace(/"/g, '').trim();
                const name = parts[2]?.replace(/"/g, '').trim();
                const cmd = parts[3]?.replace(/"/g, '').trim();
                
                if (pid && name && pid !== 'CommandLine' && name !== 'Name' && /^\d+$/.test(pid)) {
                  const processInfo = {
                    pid: pid,
                    name: name,
                    cmd: cmd,
                    method: 'commandline'
                  };
                  portInfo.processes.push(processInfo);
                  
                  console.log(`     PID: ${pid}, 进程: ${name} (命令行匹配)`);
                  if (cmd && cmd.includes('node')) {
                    console.log(`     命令行: ${cmd.substring(0, 100)}...`);
                  }
                }
              }
            });
            
            // 处理Node.js进程查找结果
            lines2.forEach(line => {
              const parts = line.split(',');
              if (parts.length >= 4) {
                const pid = parts[1]?.replace(/"/g, '').trim();
                const name = parts[2]?.replace(/"/g, '').trim();
                const cmd = parts[3]?.replace(/"/g, '').trim();
                
                if (pid && name && pid !== 'CommandLine' && name !== 'Name' && /^\d+$/.test(pid)) {
                  // 避免重复添加
                  if (!portInfo.processes.find(p => p.pid === pid)) {
                    const processInfo = {
                      pid: pid,
                      name: name,
                      cmd: cmd,
                      method: 'nodejs'
                    };
                    portInfo.processes.push(processInfo);
                    
                    console.log(`     PID: ${pid}, 进程: ${name} (Node.js进程)`);
                    if (cmd && cmd.includes('node')) {
                      console.log(`     命令行: ${cmd.substring(0, 100)}...`);
                    }
                  }
                }
              }
            });
            
            // 处理PowerShell结果
            powershellResult.forEach(line => {
              const parts = line.split(',');
              if (parts.length >= 3) {
                const pid = parts[0]?.replace(/"/g, '').trim();
                const name = parts[1]?.replace(/"/g, '').trim();
                const path = parts[2]?.replace(/"/g, '').trim();
                
                if (pid && name && /^\d+$/.test(pid)) {
                  // 避免重复添加
                  if (!portInfo.processes.find(p => p.pid === pid)) {
                    const processInfo = {
                      pid: pid,
                      name: name,
                      cmd: path,
                      method: 'powershell'
                    };
                    portInfo.processes.push(processInfo);
                    
                    console.log(`     PID: ${pid}, 进程: ${name} (PowerShell检测)`);
                    if (path) {
                      console.log(`     路径: ${path}`);
                    }
                  }
                }
              }
            });
            
            if (portInfo.processes.length === 0) {
              console.log(`   ⚠️ 串口被占用但无法识别占用进程`);
              console.log(`   💡 可能的原因:`);
              console.log(`      - 进程以系统服务方式运行`);
              console.log(`      - 进程权限不足，无法查询`);
              console.log(`      - 虚拟串口驱动占用`);
              console.log(`      - 其他系统级程序占用`);
            }
            
          } catch (e) {
            console.log(`   无法获取占用进程信息: ${e.message}`);
          }
        }
        
        // 额外检查：如果是虚拟串口，提供特殊提示
        if (port.path.includes('COM') && parseInt(port.path.replace('COM', '')) > 3) {
          console.log(`   💡 提示: ${port.path} 可能是虚拟串口，请确保虚拟串口软件已正确创建该端口`);
        }
        
        occupiedPorts.push(portInfo);
      }
    }
    
    return occupiedPorts;
    
  } catch (error) {
    console.error('检查过程中发生错误:', error.message);
    return [];
  }
}

async function killProcess(pid) {
  try {
    console.log(`正在结束进程 PID: ${pid}...`);
    await execAsync(`taskkill /PID ${pid} /F`);
    console.log(`✅ 进程 ${pid} 已成功结束`);
    return true;
  } catch (error) {
    console.error(`❌ 结束进程 ${pid} 失败:`, error.message);
    return false;
  }
}

async function killAllNodeProcesses() {
  try {
    console.log('正在结束所有Node.js进程...');
    await execAsync('taskkill /IM node.exe /F');
    console.log('✅ 所有Node.js进程已结束');
    return true;
  } catch (error) {
    console.error('❌ 结束所有Node.js进程失败:', error.message);
    return false;
  }
}

async function showProcessDetails(pid) {
  try {
    console.log(`\n=== 进程 ${pid} 详细信息 ===`);
    
    // 获取进程详细信息
    const { stdout } = await execAsync(`wmic process where "ProcessId=${pid}" get ProcessId,Name,CommandLine,ParentProcessId,CreationDate,ExecutablePath /format:list`);
    
    const lines = stdout.split('\n').filter(line => line.trim());
    lines.forEach(line => {
      if (line.includes('=')) {
        const [key, value] = line.split('=');
        console.log(`${key}: ${value}`);
      }
    });
    
  } catch (error) {
    console.error('获取进程详细信息失败:', error.message);
  }
}

async function manageOccupiedPorts(occupiedPorts) {
  if (occupiedPorts.length === 0) {
    console.log('\n✅ 所有检查的串口都可用，无需清理！');
    return;
  }
    
  console.log(`\n=== 发现 ${occupiedPorts.length} 个被占用的串口 ===`);
  
  // 收集所有占用进程
  const allProcesses = [];
  occupiedPorts.forEach(portInfo => {
    portInfo.processes.forEach(process => {
      if (!allProcesses.find(p => p.pid === process.pid)) {
        allProcesses.push({
          ...process,
          port: portInfo.port
        });
      }
    });
  });
  
  // 显示被占用的串口信息
  occupiedPorts.forEach(portInfo => {
    console.log(`\n串口 ${portInfo.port}:`);
    console.log(`  错误: ${portInfo.error}`);
    if (portInfo.processes.length > 0) {
      console.log(`  占用进程: ${portInfo.processes.length} 个`);
    } else {
      console.log(`  占用进程: 无法识别`);
    }
  });
  
  if (allProcesses.length === 0) {
    console.log('\n⚠️ 没有发现可识别的占用进程，但串口确实被占用。');
    console.log('\n请选择操作:');
    console.log('1. 尝试结束所有Node.js进程');
    console.log('2. 重启计算机（推荐）');
    console.log('3. 跳过清理');
    
    const choice = await question('\n请输入选择 (1-3): ');
    
    switch (choice.trim()) {
      case '1':
        const confirm1 = await question('确定要结束所有Node.js进程吗？(y/N): ');
        if (confirm1.toLowerCase() === 'y' || confirm1.toLowerCase() === 'yes') {
          await killAllNodeProcesses();
        } else {
          console.log('操作已取消');
        }
        break;
        
      case '2':
        console.log('建议重启计算机以释放所有串口资源。');
        break;
        
      case '3':
        console.log('跳过清理操作');
        break;
        
      default:
        console.log('❌ 无效选择');
    }
    return;
  }
  
  console.log(`\n发现 ${allProcesses.length} 个占用进程:`);
  allProcesses.forEach((process, index) => {
    console.log(`${index + 1}. PID: ${process.pid}, 进程: ${process.name}, 占用串口: ${process.port}`);
    if (process.cmd && process.cmd.includes('node')) {
      console.log(`   命令行: ${process.cmd.substring(0, 80)}...`);
    }
  });
  
  console.log('\n请选择操作:');
  console.log('1. 结束所有占用进程');
  console.log('2. 选择性结束进程');
  console.log('3. 查看进程详细信息');
  console.log('4. 跳过清理');
  
  const choice = await question('\n请输入选择 (1-4): ');
  
  switch (choice.trim()) {
    case '1':
      const confirm1 = await question('确定要结束所有占用进程吗？(y/N): ');
      if (confirm1.toLowerCase() === 'y' || confirm1.toLowerCase() === 'yes') {
        console.log('\n正在结束所有占用进程...');
        let successCount = 0;
        for (const process of allProcesses) {
          if (await killProcess(process.pid)) {
            successCount++;
          }
        }
        console.log(`\n✅ 成功结束 ${successCount}/${allProcesses.length} 个进程`);
      } else {
        console.log('操作已取消');
      }
      break;
      
    case '2':
      console.log('\n选择性结束进程:');
      for (let i = 0; i < allProcesses.length; i++) {
        const process = allProcesses[i];
        const confirm = await question(`结束进程 ${process.pid} (${process.name}) 吗？(y/N): `);
        if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
          await killProcess(process.pid);
        }
      }
      break;
      
    case '3':
      const detailPid = await question('请输入要查看的进程PID: ');
      if (detailPid && /^\d+$/.test(detailPid)) {
        await showProcessDetails(detailPid);
      } else {
        console.log('❌ 无效的PID');
      }
      break;
      
    case '4':
      console.log('跳过清理操作');
      break;
      
    default:
      console.log('❌ 无效选择');
  }
}

// 显示帮助信息
function showHelp() {
  console.log(`
端口管理工具

用法:
  node check-ports.js                    # 检查系统注册的串口
  node check-ports.js COM4               # 检查指定串口（包括虚拟串口）
  node check-ports.js COM4 COM5          # 检查多个指定串口
  node check-ports.js --help             # 显示帮助信息

示例:
  node check-ports.js                    # 扫描系统注册的串口
  node check-ports.js COM4               # 检查COM4是否被占用
  node check-ports.js COM4 COM5          # 检查COM4和COM5

功能:
  - 检查串口是否被占用
  - 显示占用进程信息
  - 提供清理占用进程的选项
  - 支持选择性或批量清理
  - 支持虚拟串口检测

虚拟串口说明:
  - 虚拟串口软件创建的端口(如COM4, COM5)可能不会出现在系统扫描中
  - 使用 "node check-ports.js COM4" 可以直接检查虚拟串口
  - 工具会尝试打开串口来检测占用情况，无论是否在系统列表中
  `);
}

async function main() {
  // 获取命令行参数
  const args = process.argv.slice(2);
  
  // 检查帮助参数
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  const targetPorts = args.length > 0 ? args : null;
  
  try {
    // 检查端口占用情况
    const occupiedPorts = await checkPortUsage(targetPorts);
    
    // 管理被占用的端口
    await manageOccupiedPorts(occupiedPorts);
    
    console.log('\n=== 检查完成 ===');
    
  } catch (error) {
    console.error('程序执行过程中发生错误:', error.message);
  } finally {
    rl.close();
  }
}

// 处理Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n程序被用户中断');
  rl.close();
  process.exit(0);
});

// 运行主程序
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { checkPortUsage, manageOccupiedPorts };
