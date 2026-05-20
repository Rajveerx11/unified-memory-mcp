#requires -Version 5.1
<#
.SYNOPSIS
    Creates config.json from config.example.json if it does not exist.
#>
$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Example = Join-Path $ProjectRoot "config.example.json"
$Target = Join-Path $ProjectRoot "config.json"

if (-not (Test-Path $Example)) {
    Write-Error "Missing template: $Example"
}

if (Test-Path $Target) {
    Write-Host "config.json already exists — leaving unchanged."
    exit 0
}

Copy-Item -Path $Example -Destination $Target
Write-Host "Created config.json from config.example.json"
Write-Host "Edit paths in config.json for your machine, then run: npm run build; .\scripts\start.ps1"
