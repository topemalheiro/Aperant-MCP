#Requires -Version 5.1
<#
.SYNOPSIS
    Kills Portainer Desktop and prevents its tray icon from reappearing.
.DESCRIPTION
    Force-stops all Portainer processes and removes it from Windows startup
    (both registry and startup folder) so the tray icon never comes back.
#>

$ErrorActionPreference = 'SilentlyContinue'
Write-Host ""
Write-Host " ============================================" -ForegroundColor Cyan
Write-Host "  Stopping Portainer Desktop..." -ForegroundColor Cyan
Write-Host " ============================================" -ForegroundColor Cyan
Write-Host ""

# Kill processes
$processes = @('Portainer Desktop', 'Portainer')
foreach ($proc in $processes) {
    $found = Get-Process -Name $proc -ErrorAction SilentlyContinue
    if ($found) {
        Stop-Process -Name $proc -Force
        Write-Host "  ✓ Stopped $proc" -ForegroundColor Green
    } else {
        Write-Host "  ℹ $proc was not running" -ForegroundColor DarkGray
    }
}

# Remove from Registry Run key
$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$regName = 'Portainer Desktop'
if (Get-ItemProperty -Path $regPath -Name $regName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $regPath -Name $regName -Force
    Write-Host "  ✓ Removed from startup registry" -ForegroundColor Green
} else {
    Write-Host "  ℹ No startup registry entry found" -ForegroundColor DarkGray
}

# Remove from Startup folder
$startupFolder = [Environment]::GetFolderPath('Startup')
$startupShortcut = Join-Path $startupFolder 'Portainer Desktop.lnk'
if (Test-Path $startupShortcut) {
    Remove-Item $startupShortcut -Force
    Write-Host "  ✓ Removed from startup folder" -ForegroundColor Green
} else {
    Write-Host "  ℹ No startup shortcut found" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host " ============================================" -ForegroundColor Cyan
Write-Host "  Done. Portainer tray icon removed." -ForegroundColor Cyan
Write-Host " ============================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to exit"
