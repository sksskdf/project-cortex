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
$npmCliJs = Join-Path (Split-Path $npmCli -Parent) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $npmCliJs)) {
    # Fallback: let nssm call the npm shim directly.
    & $nssm install $ServiceName $npmCli 'run' 'start'
} else {
    & $nssm install $ServiceName $node $npmCliJs 'run' 'start'
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
