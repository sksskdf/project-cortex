# windows-uninstall.ps1 — Stop and remove the Cortex Windows service.
#
# Reverses windows-install.ps1. Requires NSSM on PATH and an elevated shell.
#
# Usage (run from an elevated PowerShell):
#   ./scripts/service/windows-uninstall.ps1
#   ./scripts/service/windows-uninstall.ps1 -ServiceName Cortex
#
# Logs under %APPDATA%\Cortex\logs are left in place on purpose.

[CmdletBinding()]
param(
    [string]$ServiceName = 'Cortex'
)

$ErrorActionPreference = 'Stop'

$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) {
    throw "nssm not found on PATH. Install it first: 'winget install NSSM.NSSM' or 'choco install nssm'."
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Output "Service '$ServiceName' is not installed; nothing to do."
    return
}

& $nssm stop $ServiceName
& $nssm remove $ServiceName confirm

Write-Output "Removed service '$ServiceName'. Logs (if any) kept under %APPDATA%\Cortex\logs."
