# ChainlessChain 打包依赖下载脚本
# 自动下载所需的所有依赖

$ErrorActionPreference = "Stop"
$ProgressPreference = 'SilentlyContinue' # 加速下载

$PACKAGING_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "=== ChainlessChain 打包依赖下载 ===" -ForegroundColor Cyan
Write-Host "目标目录: $PACKAGING_DIR" -ForegroundColor Gray

# 1. 下载 JRE 17 (Eclipse Temurin)
Write-Host "`n[1/4] 下载 JRE 17..." -ForegroundColor Yellow
$JRE_URL = "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jre_x64_windows_hotspot_17.0.13_11.zip"
$JRE_ZIP = "$PACKAGING_DIR\jre-17.zip"
$JRE_DIR = "$PACKAGING_DIR\jre-17"

if (Test-Path $JRE_DIR) {
    Write-Host "  JRE 17 已存在，跳过" -ForegroundColor Green
} else {
    Write-Host "  下载中: $JRE_URL" -ForegroundColor Gray
    Invoke-WebRequest -Uri $JRE_URL -OutFile $JRE_ZIP -UseBasicParsing
    Write-Host "  解压中..." -ForegroundColor Gray
    Expand-Archive -Path $JRE_ZIP -DestinationPath "$PACKAGING_DIR\jre-17-temp"
    # 移动到正确的目录（解压后通常有一个子目录）
    $extractedDir = Get-ChildItem "$PACKAGING_DIR\jre-17-temp" | Select-Object -First 1
    Move-Item "$PACKAGING_DIR\jre-17-temp\$($extractedDir.Name)" $JRE_DIR
    Remove-Item "$PACKAGING_DIR\jre-17-temp" -Recurse -Force
    Remove-Item $JRE_ZIP -Force
    Write-Host "  ✓ JRE 17 下载完成" -ForegroundColor Green
}

# 2. 下载 PostgreSQL Portable
Write-Host "`n[2/4] 下载 PostgreSQL 16..." -ForegroundColor Yellow
$PG_URL = "https://get.enterprisedb.com/postgresql/postgresql-16.6-1-windows-x64-binaries.zip"
$PG_ZIP = "$PACKAGING_DIR\postgres.zip"
$PG_DIR = "$PACKAGING_DIR\postgres"

if (Test-Path $PG_DIR) {
    Write-Host "  PostgreSQL 已存在，跳过" -ForegroundColor Green
} else {
    Write-Host "  下载中: $PG_URL" -ForegroundColor Gray
    Invoke-WebRequest -Uri $PG_URL -OutFile $PG_ZIP -UseBasicParsing
    Write-Host "  解压中..." -ForegroundColor Gray
    Expand-Archive -Path $PG_ZIP -DestinationPath "$PACKAGING_DIR\postgres-temp"
    # PostgreSQL binaries在pgsql子目录中
    Move-Item "$PACKAGING_DIR\postgres-temp\pgsql" $PG_DIR
    Remove-Item "$PACKAGING_DIR\postgres-temp" -Recurse -Force
    Remove-Item $PG_ZIP -Force
    Write-Host "  ✓ PostgreSQL 下载完成" -ForegroundColor Green
}

# 3. 下载 Redis for Windows
Write-Host "`n[3/4] 下载 Redis..." -ForegroundColor Yellow
$REDIS_URL = "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"
$REDIS_ZIP = "$PACKAGING_DIR\redis.zip"
$REDIS_DIR = "$PACKAGING_DIR\redis"

if (Test-Path $REDIS_DIR) {
    Write-Host "  Redis 已存在，跳过" -ForegroundColor Green
} else {
    Write-Host "  下载中: $REDIS_URL" -ForegroundColor Gray
    Invoke-WebRequest -Uri $REDIS_URL -OutFile $REDIS_ZIP -UseBasicParsing
    Write-Host "  解压中..." -ForegroundColor Gray
    Expand-Archive -Path $REDIS_ZIP -DestinationPath $REDIS_DIR
    Remove-Item $REDIS_ZIP -Force
    Write-Host "  ✓ Redis 下载完成" -ForegroundColor Green
}

# 4. 下载 Qdrant
Write-Host "`n[4/4] 下载 Qdrant..." -ForegroundColor Yellow
$QDRANT_URL = "https://github.com/qdrant/qdrant/releases/download/v1.12.5/qdrant-x86_64-pc-windows-msvc.zip"
$QDRANT_ZIP = "$PACKAGING_DIR\qdrant.zip"
$QDRANT_DIR = "$PACKAGING_DIR\qdrant"

if (Test-Path $QDRANT_DIR) {
    Write-Host "  Qdrant 已存在，跳过" -ForegroundColor Green
} else {
    Write-Host "  下载中: $QDRANT_URL" -ForegroundColor Gray
    Invoke-WebRequest -Uri $QDRANT_URL -OutFile $QDRANT_ZIP -UseBasicParsing
    Write-Host "  解压中..." -ForegroundColor Gray
    Expand-Archive -Path $QDRANT_ZIP -DestinationPath $QDRANT_DIR
    Remove-Item $QDRANT_ZIP -Force
    Write-Host "  ✓ Qdrant 下载完成" -ForegroundColor Green
}

Write-Host "`n=== 依赖下载完成 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "下载的依赖:" -ForegroundColor Yellow
Write-Host "  ✓ JRE 17         : $JRE_DIR" -ForegroundColor Green
Write-Host "  ✓ PostgreSQL 16  : $PG_DIR" -ForegroundColor Green
Write-Host "  ✓ Redis 5.0.14   : $REDIS_DIR" -ForegroundColor Green
Write-Host "  ✓ Qdrant 1.12.5  : $QDRANT_DIR" -ForegroundColor Green

# 显示目录大小
Write-Host "`n依赖大小:" -ForegroundColor Yellow
$jreSize = (Get-ChildItem -Path $JRE_DIR -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
$pgSize = (Get-ChildItem -Path $PG_DIR -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
$redisSize = (Get-ChildItem -Path $REDIS_DIR -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
$qdrantSize = (Get-ChildItem -Path $QDRANT_DIR -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host "  JRE 17      : $([math]::Round($jreSize, 2)) MB" -ForegroundColor Gray
Write-Host "  PostgreSQL  : $([math]::Round($pgSize, 2)) MB" -ForegroundColor Gray
Write-Host "  Redis       : $([math]::Round($redisSize, 2)) MB" -ForegroundColor Gray
Write-Host "  Qdrant      : $([math]::Round($qdrantSize, 2)) MB" -ForegroundColor Gray
$totalSize = $jreSize + $pgSize + $redisSize + $qdrantSize
Write-Host "  总计        : $([math]::Round($totalSize, 2)) MB" -ForegroundColor Cyan

Write-Host "`n接下来需要:" -ForegroundColor Yellow
Write-Host "  1. 构建 Java 项目 (project-service.jar)" -ForegroundColor White
Write-Host "     运行: cd backend/project-service && mvn clean package -DskipTests" -ForegroundColor Gray
Write-Host "  2. 运行打包命令" -ForegroundColor White
Write-Host "     运行: cd desktop-app-vue && npm run make:win" -ForegroundColor Gray
