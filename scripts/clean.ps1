# clean.ps1 - Deep cleanup for node_modules
# Usage: pwsh ./scripts/clean.ps1

Write-Host "--- SerialSync Environment Cleanup ---" -ForegroundColor Cyan

# Define roots
$RootDir = Get-Item "$PSScriptRoot\.."
$WebDir = Join-Path $RootDir.FullName "src\web"

# 1. Kill Node/Nodemon processes
Write-Host "[1/4] Terminating Node.js processes..."
Get-Process | Where-Object { $_.Name -match "node|nodemon" } | Stop-Process -Force -ErrorAction SilentlyContinue

# 2. Cleanup Function
function SafeDelete {
    param([string]$targetDir)
    if (Test-Path $targetDir) {
        $name = Split-Path $targetDir -Leaf
        $parent = Split-Path $targetDir -Parent
        
        Write-Host "  [-] Found: $targetDir" -ForegroundColor Gray
        
        try {
            # --- Try direct deletion first ---
            Write-Host "  [*] Attempting direct deletion..." -ForegroundColor Gray
            Remove-Item -Path $targetDir -Recurse -Force -ErrorAction Stop
            Write-Host "  [+] Success: $name deleted directly." -ForegroundColor Green
        }
        catch {
            # --- Fallback to rename strategy if locked ---
            Write-Host "  [!] Direct delete failed (File Locked). Using fallback strategy..." -ForegroundColor Yellow
            $tempName = $name + "_old_" + (Get-Date -Format "HHmmss")
            $tempPath = Join-Path $parent $tempName
            
            try {
                Rename-Item -Path $targetDir -NewName $tempName -ErrorAction Stop
                Write-Host "  [+] Moved: $name -> $tempName (background deletion started)" -ForegroundColor Green
                
                # Async delete in background
                Start-Job -ScriptBlock { 
                    param($p) 
                    Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue 
                } -ArgumentList $tempPath | Out-Null
            }
            catch {
                Write-Host "  [!] CRITICAL: Failed to move $targetDir. Error: $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    }
    else {
        Write-Host "  [?] Not found: $targetDir" -ForegroundColor Gray
    }
}

Write-Host "[2/4] Cleaning Root node_modules..."
SafeDelete (Join-Path $RootDir.FullName "node_modules")

Write-Host "[3/4] Cleaning Web node_modules..."
SafeDelete (Join-Path $WebDir "node_modules")

# 4. Final steps
Write-Host "[4/4] Cleanup commands completed." -ForegroundColor Cyan
Write-Host "You can now run 'npm install' to reinstall dependencies." -ForegroundColor White
Write-Host "------------------------------------"
