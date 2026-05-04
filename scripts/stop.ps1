#requires -Version 5.1
$ErrorActionPreference = "SilentlyContinue"

$task = Get-ScheduledTask -TaskName "SecondBrainMCP" -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName "SecondBrainMCP"
    Write-Host "Stopped scheduled task 'SecondBrainMCP'."
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pattern = "*$($ProjectRoot.Replace('\','\\'))*"

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like $pattern } |
    ForEach-Object {
        Write-Host "Killing node PID $($_.ProcessId): $($_.CommandLine)"
        Stop-Process -Id $_.ProcessId -Force
    }

Write-Host "Stop complete."
