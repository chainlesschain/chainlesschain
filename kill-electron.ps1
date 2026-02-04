Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "All Electron processes killed"
