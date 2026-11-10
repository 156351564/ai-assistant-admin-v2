# smoke.ps1 —— 一键验收 /api/chat
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1 -Message "你是谁"
#
# 为什么要自己解字节：Windows PowerShell 5.1 的 Invoke-RestMethod 在响应
# 没写 charset 时会按 ISO-8859-1 解码，中文会变成「æ»ä¹±ç »」这种乱码。

param(
    [string]$Message = "用一句话说明什么是 SSE 流式输出",
    [string]$Url = "http://localhost:3000/api/chat"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$body = @{ message = $Message } | ConvertTo-Json -Compress
$bytes = [Text.Encoding]::UTF8.GetBytes($body)

Write-Host "POST $Url" -ForegroundColor Cyan
Write-Host "body: $body" -ForegroundColor DarkGray

function Show-Result($jsonText, $elapsedMs) {
    $r = $jsonText | ConvertFrom-Json
    Write-Host "`n--- 响应 ---" -ForegroundColor Green
    $r | ConvertTo-Json -Depth 6

    if ($r.ok) {
        Write-Host "`n内容：" -ForegroundColor Green
        Write-Host $r.content
        $think = $r.usage.reasoningTokens
        if ($null -eq $think) { $think = 0 }
        Write-Host "`n指标：latency=$($r.latencyMs)ms  in=$($r.usage.promptTokens)  out=$($r.usage.completionTokens)  think=$think  total=$($r.usage.totalTokens)" -ForegroundColor Yellow
        if ($think -gt 0) {
            $pct = [math]::Round(100 * $think / [math]::Max($r.usage.completionTokens,1), 0)
            Write-Host "思考 token 占输出 $pct%（这部分也计费，但用户看不到）" -ForegroundColor DarkYellow
        } else {
            Write-Host "无思考 token（非推理模型，或供应商未返回该字段）" -ForegroundColor DarkYellow
        }
    }
    else {
        Write-Host "`n失败：[$($r.code)] $($r.message)" -ForegroundColor Red
    }
}

$sw = [Diagnostics.Stopwatch]::StartNew()
try {
    $resp = Invoke-WebRequest -Uri $Url -Method Post `
        -ContentType "application/json; charset=utf-8" `
        -Body $bytes -TimeoutSec 120 -UseBasicParsing
    $sw.Stop()
    $text = [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
    Show-Result $text $sw.ElapsedMilliseconds
}
catch {
    $sw.Stop()
    $err = $_
    Write-Host "`nHTTP 请求失败（耗时 $($sw.ElapsedMilliseconds)ms）" -ForegroundColor Red

    $text = $null
    if ($err.Exception.Response -ne $null) {
        try {
            $stream = $err.Exception.Response.GetResponseStream()
            $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)
            $text = $reader.ReadToEnd()
            $reader.Close()
        }
        catch { }
    }
    if (-not $text -and $err.ErrorDetails) { $text = $err.ErrorDetails.Message }

    if ($text) { Show-Result $text $sw.ElapsedMilliseconds }
    else {
        Write-Host $err.Exception.Message -ForegroundColor Red
        Write-Host "`n排查顺序：dev server 起来了吗 → 端口是 3000 吗 → .env.local 三个变量都有值吗" -ForegroundColor DarkYellow
    }
}
