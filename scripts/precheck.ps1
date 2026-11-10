# precheck.ps1 —— 提交/推送前的一键安全检查
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\scripts\precheck.ps1
#
# 检查三件事：
#   1. 有没有密钥被跟踪进仓库
#   2. 全部 git 历史里有没有密钥字面量
#   3. .env 类文件是否被误纳入版本控制

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$fail = 0

Write-Host "`n[1/3] 扫描已跟踪文件中的疑似密钥..." -ForegroundColor Cyan
# 要求 sk- 后面至少 20 位，避开 pnpm-lock 里 "task-list-item" 之类的假阳性
$pattern = 'sk-[A-Za-z0-9._\-]{20,}'
$tracked = git grep -nE $pattern -- . 2>$null
if ($tracked) {
    Write-Host "  ⚠ 发现疑似密钥：" -ForegroundColor Red
    $tracked | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    $fail = 1
} else {
    Write-Host "  ✅ 已跟踪文件中无密钥" -ForegroundColor Green
}

Write-Host "`n[2/3] 扫描全部 git 历史（含已删除内容）..." -ForegroundColor Cyan
$found = $false
foreach ($commit in (git rev-list --all)) {
    $hit = git grep -lE $pattern $commit 2>$null
    if ($hit) {
        Write-Host "  ⚠ 在 $commit 中发现：" -ForegroundColor Red
        $hit | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        $found = $true
        $fail = 1
    }
}
if (-not $found) {
    Write-Host "  ✅ 全部历史无密钥" -ForegroundColor Green
}

Write-Host "`n[3/3] 检查 .env 类文件是否被跟踪..." -ForegroundColor Cyan
$envFiles = git ls-files | Where-Object { $_ -match '(^|/)\.env' }
if ($envFiles) {
    $bad = $envFiles | Where-Object { $_ -notmatch '\.env\.(example|sample)$' }
    if ($bad) {
        Write-Host "  ⚠ 以下 env 文件被跟踪，必须移除：" -ForegroundColor Red
        $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        $fail = 1
    }
    $envFiles | ForEach-Object { Write-Host "  · $_" -ForegroundColor DarkGray }
} else {
    Write-Host "  ✅ 无 .env 文件被跟踪" -ForegroundColor Green
}

Write-Host ""
if ($fail -eq 0) {
    Write-Host "全部通过，可以安全推送 ✅" -ForegroundColor Green
    exit 0
} else {
    Write-Host "发现问题，先处理后推送 ❌" -ForegroundColor Red
    exit 1
}
