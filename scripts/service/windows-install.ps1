# windows-install.ps1 — Register Cortex as a Windows service via NSSM.
#
# NSSM (Non-Sucking Service Manager) wraps an arbitrary process as a real
# Windows service so it auto-starts on boot and shows up in services.msc.
# We do NOT bundle the nssm.exe binary — install it first:
#   winget install NSSM.NSSM      (or)   choco install nssm
#
# Usage (run from an elevated PowerShell — service install needs admin):
#   ./scripts/service/windows-install.ps1
#   ./scripts/service/windows-install.ps1 -ServiceName Cortex -Port 3000
#
# The service runs the production start command (`npm run start` =
# `NODE_ENV=production tsx server.ts`) with the repo as the working dir,
# routing stdout/stderr to a logs directory with size-based rotation.

[CmdletBinding()]
param(
    # Service name shown in services.msc.
    [string]$ServiceName = 'Cortex',
    # Port the Next custom server listens on (see server.ts).
    [int]$Port = 3000,
    # Repo root. Defaults to two levels up from this script (scripts/service/..).
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    # Where stdout/stderr logs go. Defaults to %APPDATA%\Cortex\logs.
    [string]$LogDir = (Join-Path $env:APPDATA 'Cortex\logs')
)

$ErrorActionPreference = 'Stop'

# --- Preconditions ---------------------------------------------------------

$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) {
    throw "nssm not found on PATH. Install it first: 'winget install NSSM.NSSM' or 'choco install nssm', then re-run."
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    throw "node not found on PATH. Install Node.js >= 20 first."
}

if (-not (Test-Path (Join-Path $RepoRoot 'server.ts'))) {
    throw "server.ts not found under RepoRoot '$RepoRoot'. Pass -RepoRoot pointing at the cloned repo."
}

# NSSM runs npm's start script. We invoke it through the user's npm shim so
# the resolved tsx/next from node_modules is used (no global install needed).
$npmCli = (Get-Command npm -ErrorAction SilentlyContinue).Source
if (-not $npmCli) {
    throw "npm not found on PATH. Install Node.js (which bundles npm) first."
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# --- Install ---------------------------------------------------------------

# If a stale service with the same name exists, remove it before re-installing.
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Output "Service '$ServiceName' already exists; reinstalling."
    & $nssm stop $ServiceName
    & $nssm remove $ServiceName confirm
}

# Point the service at node running the npm CLI's start script. Using node +
# npm-cli.js avoids relying on the npm.cmd batch shim under the SYSTEM account.
#
# 경로에 공백(`C:\Program Files\...`)이 있으면 NSSM 이 그대로 저장한 AppParameters 를
# node 가 받을 때 첫 토큰을 스크립트 경로로 잘라 `Cannot find module 'C:\Program'` 으로
# 죽는다(사용자 보고 2026-06-05). NSSM 의 nssm.exe install <name> <app> 은 app 만 받고,
# parameters 는 따로 set 으로 넘기는 게 인용 처리가 명확하다.
$npmCliJs = Join-Path (Split-Path $npmCli -Parent) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $npmCliJs)) {
    # Fallback: npm shim 직접 호출. shim 은 .cmd 라 자기 안에서 공백을 처리하지만,
    # AppParameters 의 `run start` 는 단순 토큰이라 인용 불요.
    & $nssm install $ServiceName $npmCli
    & $nssm set $ServiceName AppParameters 'run start'
} else {
    # Application 은 node, parameters 는 `"<npm-cli.js>" run start` — 스크립트 경로를
    # 따옴표로 감싸 공백 안전.
    & $nssm install $ServiceName $node
    & $nssm set $ServiceName AppParameters ('"{0}" run start' -f $npmCliJs)
}

& $nssm set $ServiceName AppDirectory $RepoRoot
& $nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=production" "PORT=$Port"

# Auto-start on boot.
& $nssm set $ServiceName Start SERVICE_AUTO_START

# Logging: stdout + stderr to files, with size-based rotation (~10 MB).
& $nssm set $ServiceName AppStdout (Join-Path $LogDir 'cortex.out.log')
& $nssm set $ServiceName AppStderr (Join-Path $LogDir 'cortex.err.log')
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateOnline 1
& $nssm set $ServiceName AppRotateBytes 10485760

# Restart on crash (give it a moment between restarts).
& $nssm set $ServiceName AppRestartDelay 3000

& $nssm start $ServiceName

Write-Output "Installed and started service '$ServiceName' (port $Port)."
Write-Output "Working dir: $RepoRoot"
Write-Output "Logs: $LogDir"
Write-Output "Manage it in services.msc or via: nssm stop/start/restart $ServiceName"
