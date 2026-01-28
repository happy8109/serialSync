# clean.ps1 - 强效清理 node_modules
# 用法: powershell ./scripts/clean.ps1

Write-Host "--- 开始深度清理 SerialSync 环境 ---" -ForegroundColor Cyan

# 1. 尝试杀掉所有可能锁定文件的 Node 进程
Write-Host "[1/3] 正在终止 Node.js 进程..."
Get-Process | Where-Object { $_.Name -match "node|nodemon" } | Stop-Process -Force -ErrorAction SilentlyContinue

# 2. 定义清理函数（重命名大法 + 后台异步删除）
function SafeDelete($path) {
    if (Test-Path $path) {
        $tempName = "$path" + "_old_" + (Get-Date -Format "HHmmss")
        try {
            # 先重命名，这样文件夹立即从项目结构中消失
            Rename-Item -Path $path -NewName $tempName -ErrorAction Stop
            Write-Host "  [+] 已重命名 $path -> $tempName (准备后台删除)" -ForegroundColor Green
            
            # 开启一个低优先级的后台作业去执行删除，不阻塞当前任务
            Start-Job -ScriptBlock { param($p) Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue } -ArgumentList $tempName | Out-Null
        } catch {
            Write-Host "  [!] 无法重命名 $path，请尝试关闭 VS Code 后再试。" -ForegroundColor Yellow
        }
    }
}

Write-Host "[2/3] 正在清理 node_modules..."
SafeDelete "node_modules"
SafeDelete "src/web/node_modules"

# 3. 提示
Write-Host "[3/3] 清理指令已下达。" -ForegroundColor Cyan
Write-Host "您现在可以立即运行 'npm install' 重新安装依赖了。" -ForegroundColor White
Write-Host "------------------------------------"
