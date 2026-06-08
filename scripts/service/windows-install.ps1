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
# 경로에 공백(`C:\Program Files\...`)이 있으면 NSSM 이 AppParameters 의 따옴표를 stripping
# 해서 node 가 명령줄에서 첫 공백 앞(`C:\Program`)을 스크립트 경로로 잘라먹는다 →
# `Cannot find module 'C:\Program'` (사용자 보고 2026-06-05·재발). 인용 의존 대신
# **8.3 short path** 로 우회 — `C:\PROGRA~1\nodejs\...` 는 공백이 아예 없어서 따옴표 자체가
# 불필요해진다. NSSM 의 quoting 동작에 무관.
function Get-ShortPath {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $Path }
    $fso = New-Object -ComObject Scripting.FileSystemObject
    try {
        $item = if ((Get-Item $Path).PSIsContainer) { $fso.GetFolder($Path) } else { $fso.GetFile($Path) }
        return $item.ShortPath
    } finally {
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($fso) | Out-Null
    }
}

$nodeShort = Get-ShortPath $node
$npmCliJs = Join-Path (Split-Path $npmCli -Parent) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $npmCliJs)) {
    # Fallback: npm shim(.cmd) 직접 호출. shim 도 short path 로 변환.
    $npmShort = Get-ShortPath $npmCli
    & $nssm install $ServiceName $npmShort
    & $nssm set $ServiceName AppParameters 'run start'
} else {
    # node + npm-cli.js 둘 다 8.3 short path 로 등록.
    $cliShort = Get-ShortPath $npmCliJs
    & $nssm install $ServiceName $nodeShort
    & $nssm set $ServiceName AppParameters "$cliShort run start"
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
