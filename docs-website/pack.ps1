# ChainlessChain 官方网站打包脚本
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " ChainlessChain 官方网站打包工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outputFile = "chainlesschain-website-$timestamp.zip"

Write-Host "[1/4] 准备打包..." -ForegroundColor Yellow
Write-Host ""

# 定义需要打包的文件和目录
$filesToPack = @(
    "index.html",
    "logo.png",
    "logo.svg",
    "robots.txt",
    "sitemap.xml",
    "style-enhancements.css",
    "visual-enhancements.css",
    "fix-center.css",
    "loading-animation.css",
    "loading-simple.css"
)

$foldersTopack = @(
    "css",
    "js",
    "images",
    "products",
    "technology"
)

Write-Host "[2/4] 创建临时目录..." -ForegroundColor Yellow

# 创建临时目录
$tempDir = "temp_pack"
if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

Write-Host "[3/4] 复制文件..." -ForegroundColor Yellow

# 复制文件
foreach ($file in $filesToPack) {
    if (Test-Path $file) {
        Copy-Item $file -Destination $tempDir
        Write-Host "  ✓ $file" -ForegroundColor Green
    }
}

# 复制文件夹
foreach ($folder in $foldersTopack) {
    if (Test-Path $folder) {
        Copy-Item -Recurse $folder -Destination "$tempDir\$folder"
        Write-Host "  ✓ $folder\" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "[4/4] 压缩打包..." -ForegroundColor Yellow

# 压缩
Compress-Archive -Path "$tempDir\*" -DestinationPath $outputFile -Force

# 清理临时目录
Remove-Item -Recurse -Force $tempDir

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " 打包完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "输出文件: $outputFile" -ForegroundColor Cyan
Write-Host "文件位置: $PWD\$outputFile" -ForegroundColor Cyan

# 显示文件大小
$fileSize = (Get-Item $outputFile).Length
$fileSizeMB = [math]::Round($fileSize / 1MB, 2)
Write-Host "文件大小: $fileSizeMB MB" -ForegroundColor Cyan
Write-Host ""

Write-Host "部署说明:" -ForegroundColor Yellow
Write-Host "1. 上传 $outputFile 到服务器" -ForegroundColor White
Write-Host "2. 解压到网站根目录" -ForegroundColor White
Write-Host "3. 确保服务器支持静态网站托管" -ForegroundColor White
Write-Host ""
