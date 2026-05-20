#requires -Version 5.1
$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EntryPoint = Join-Path $ProjectRoot "dist\index.js"

if (-not (Test-Path $EntryPoint)) {
    Write-Error "Build artifact not found: $EntryPoint`nRun 'npm run build' first."
}

Write-Host "Starting Unified Memory MCP server (foreground, Ctrl+C to stop)..."
& node $EntryPoint
