#requires -Version 5.1
$ErrorActionPreference = "SilentlyContinue"

foreach ($taskName in @("UnifiedMemoryMCP", "SecondBrainMCP")) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Stop-ScheduledTask -TaskName $taskName
        Write-Host "Stopped scheduled task '$taskName'."
    }
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
