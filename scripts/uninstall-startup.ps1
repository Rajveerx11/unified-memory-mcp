#requires -Version 5.1
$ErrorActionPreference = "Stop"

Unregister-ScheduledTask -TaskName "SecondBrainMCP" -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Scheduled task 'SecondBrainMCP' removed (if it existed)."

$VbsPath = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "scripts\start-hidden.vbs"
if (Test-Path $VbsPath) {
    Remove-Item -Path $VbsPath -Force
    Write-Host "Removed launcher: $VbsPath"
}
