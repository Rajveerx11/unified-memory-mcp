#requires -Version 5.1
<#
.SYNOPSIS
    Registers a Windows scheduled task that launches the Unified Memory MCP server on user logon.
.DESCRIPTION
    Creates a hidden VBS launcher (start-hidden.vbs) so node runs without any console window or
    taskbar entry, then registers a scheduled task pointing at it. Triggered at logon for the
    current user.
.PARAMETER ProjectRoot
    Path to the unified-memory-mcp project root. Defaults to the parent of this script.
#>

param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$VbsPath = Join-Path $ProjectRoot "scripts\start-hidden.vbs"
$EntryPoint = Join-Path $ProjectRoot "dist\index.js"

if (-not (Test-Path $EntryPoint)) {
    Write-Error "Build artifact not found: $EntryPoint`nRun 'npm run build' first."
}

$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$ProjectRoot"
WshShell.Run "cmd /c node ""$EntryPoint""", 0, False
"@

Set-Content -Path $VbsPath -Value $vbsContent -Encoding ASCII -Force
Write-Host "Wrote launcher: $VbsPath"

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument """$VbsPath""" -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName "SecondBrainMCP" -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "UnifiedMemoryMCP" -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName "UnifiedMemoryMCP" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Unified Memory MCP Server (stdio, runs hidden on logon)" | Out-Null

Write-Host "Scheduled task 'UnifiedMemoryMCP' installed."
Write-Host "It will start automatically on next logon. To start now: Start-ScheduledTask -TaskName UnifiedMemoryMCP"
