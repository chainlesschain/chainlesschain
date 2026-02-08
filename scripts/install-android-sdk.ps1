# Android SDK安装脚本
$sdkUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
$downloadPath = "$env:TEMP\android-cmdline-tools.zip"
$sdkRoot = "C:\Android\sdk"
$extractPath = "$sdkRoot\cmdline-tools"

# 创建目录
Write-Host "Creating directories..."
New-Item -ItemType Directory -Path "$extractPath\latest" -Force | Out-Null

# 下载
Write-Host "Downloading Android SDK Command Line Tools (约200MB)..."
Invoke-WebRequest -Uri $sdkUrl -OutFile $downloadPath -UseBasicParsing

# 解压
Write-Host "Extracting..."
Expand-Archive -Path $downloadPath -DestinationPath $extractPath -Force

# 移动文件到latest目录
Write-Host "Moving files..."
$tempDir = "$extractPath\cmdline-tools"
if (Test-Path $tempDir) {
    Get-ChildItem $tempDir | Move-Item -Destination "$extractPath\latest\" -Force
    Remove-Item $tempDir -Force
}

# 清理下载文件
Remove-Item $downloadPath -Force

Write-Host ""
Write-Host "Android SDK Command Line Tools installed successfully!"
Write-Host "SDK Location: $sdkRoot"
Write-Host ""
Write-Host "Now installing required SDK components..."

# 接受许可证并安装必要组件
$sdkManager = "$extractPath\latest\bin\sdkmanager.bat"
& $sdkManager --licenses
& $sdkManager "platform-tools" "platforms;android-35" "build-tools;35.0.0"

Write-Host ""
Write-Host "Installation complete!"
