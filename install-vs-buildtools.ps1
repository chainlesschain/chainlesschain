# Visual Studio Build Tools 自动安装脚本
# 用于解决 node-gyp 编译原生模块所需的 C++ 构建工具

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Visual Studio Build Tools 安装脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "此脚本将安装以下组件：" -ForegroundColor Yellow
Write-Host "  - Visual Studio Build Tools 2022" -ForegroundColor Yellow
Write-Host "  - Desktop development with C++ workload" -ForegroundColor Yellow
Write-Host "  - Windows SDK" -ForegroundColor Yellow
Write-Host ""
Write-Host "所需空间: ~10 GB" -ForegroundColor Yellow
Write-Host "预计时间: 15-30 分钟" -ForegroundColor Yellow
Write-Host ""

# 检查是否以管理员身份运行
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "错误: 需要管理员权限运行此脚本" -ForegroundColor Red
    Write-Host ""
    Write-Host "请右键单击此脚本，选择 '以管理员身份运行'" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "按任意键退出"
    exit 1
}

# 创建临时目录
$tempDir = "$env:TEMP\vs_buildtools"
if (!(Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
}

# 下载 VS Build Tools 安装程序
$installerUrl = "https://aka.ms/vs/17/release/vs_BuildTools.exe"
$installerPath = "$tempDir\vs_BuildTools.exe"

Write-Host "正在下载 Visual Studio Build Tools 安装程序..." -ForegroundColor Green

try {
    # 使用 .NET WebClient 下载（更可靠）
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($installerUrl, $installerPath)
    Write-Host "✓ 下载完成" -ForegroundColor Green
} catch {
    Write-Host "× 下载失败: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "请手动下载并安装 Visual Studio Build Tools:" -ForegroundColor Yellow
    Write-Host "  URL: $installerUrl" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "或使用 Chocolatey 安装:" -ForegroundColor Yellow
    Write-Host "  choco install visualstudio2022buildtools --package-parameters '--add Microsoft.VisualStudio.Workload.VCTools'" -ForegroundColor Cyan
    Read-Host "按任意键退出"
    exit 1
}

Write-Host ""
Write-Host "正在启动安装程序（请在安装窗口中完成安装）..." -ForegroundColor Green
Write-Host ""
Write-Host "重要提示：" -ForegroundColor Yellow
Write-Host "  1. 在安装界面中，确保勾选 'Desktop development with C++'" -ForegroundColor Yellow
Write-Host "  2. 如果已安装，可以选择 'Modify' 修改现有安装" -ForegroundColor Yellow
Write-Host "  3. 安装完成后需要重启电脑" -ForegroundColor Yellow
Write-Host ""

# 静默安装参数（推荐用于自动化）
$installArgs = @(
    "--quiet",                                                    # 静默安装
    "--wait",                                                     # 等待安装完成
    "--norestart",                                                # 不自动重启
    "--add", "Microsoft.VisualStudio.Workload.VCTools",          # C++ 工具
    "--add", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", # x86/x64 编译器
    "--add", "Microsoft.VisualStudio.Component.Windows11SDK.22621" # Windows 11 SDK
)

# 交互式安装参数（推荐用于手动选择）
$interactiveArgs = @(
    "--add", "Microsoft.VisualStudio.Workload.VCTools"
)

Write-Host "选择安装模式：" -ForegroundColor Cyan
Write-Host "  1. 自动安装（推荐，静默安装所需组件）" -ForegroundColor White
Write-Host "  2. 交互式安装（手动选择组件）" -ForegroundColor White
Write-Host ""
$choice = Read-Host "请选择 (1 或 2, 默认为 1)"

if ($choice -eq "2") {
    Write-Host ""
    Write-Host "启动交互式安装..." -ForegroundColor Green
    Start-Process -FilePath $installerPath -ArgumentList $interactiveArgs -Wait
} else {
    Write-Host ""
    Write-Host "启动自动安装（这可能需要 15-30 分钟）..." -ForegroundColor Green
    Write-Host "请耐心等待..." -ForegroundColor Yellow
    Write-Host ""

    try {
        $process = Start-Process -FilePath $installerPath -ArgumentList $installArgs -Wait -PassThru

        if ($process.ExitCode -eq 0) {
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Green
            Write-Host "  ✓ Visual Studio Build Tools 安装成功！" -ForegroundColor Green
            Write-Host "========================================" -ForegroundColor Green
        } elseif ($process.ExitCode -eq 3010) {
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Yellow
            Write-Host "  ✓ 安装完成，需要重启系统" -ForegroundColor Yellow
            Write-Host "========================================" -ForegroundColor Yellow
        } else {
            Write-Host ""
            Write-Host "警告: 安装退出代码为 $($process.ExitCode)" -ForegroundColor Yellow
            Write-Host "请检查是否已成功安装" -ForegroundColor Yellow
        }
    } catch {
        Write-Host ""
        Write-Host "× 安装过程中出错: $_" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "下一步操作：" -ForegroundColor Cyan
Write-Host "  1. 重启电脑（推荐）" -ForegroundColor White
Write-Host "  2. 打开新的命令提示符窗口" -ForegroundColor White
Write-Host "  3. 验证安装:" -ForegroundColor White
Write-Host "     node-gyp configure" -ForegroundColor Gray
Write-Host "  4. 重新安装项目依赖:" -ForegroundColor White
Write-Host "     cd desktop-app-vue" -ForegroundColor Gray
Write-Host "     npm install" -ForegroundColor Gray
Write-Host ""

# 清理临时文件（可选）
$cleanup = Read-Host "是否删除安装程序？ (y/n, 默认 y)"
if ($cleanup -ne "n") {
    Write-Host "正在清理临时文件..." -ForegroundColor Green
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "✓ 清理完成" -ForegroundColor Green
}

Write-Host ""
Write-Host "安装完成！" -ForegroundColor Green
Read-Host "按任意键退出"
