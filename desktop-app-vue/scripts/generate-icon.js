const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 使用 ImageMagick convert 或 PowerShell 来转换图标
const generateIcons = async () => {
  const logoPath = path.join(__dirname, '../logo.png');
  const buildDir = path.join(__dirname, '../build');
  const iconPath = path.join(buildDir, 'icon.ico');

  // 创建 build 目录
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  console.log('Generating Windows icon from logo.png...');

  try {
    // 尝试使用 PowerShell 和 .NET 来转换
    const psScript = `
      Add-Type -AssemblyName System.Drawing
      $img = [System.Drawing.Image]::FromFile("${logoPath.replace(/\\/g, '\\\\')}")
      $sizes = @(16, 32, 48, 64, 128, 256)
      $icon = New-Object System.Drawing.Icon([System.Drawing.Bitmap]::new($img, 256, 256), 256, 256)
      $stream = [System.IO.File]::Create("${iconPath.replace(/\\/g, '\\\\')}")
      $icon.Save($stream)
      $stream.Close()
      Write-Host "Icon generated successfully!"
    `;

    // 写入临时 PowerShell 脚本
    const tempScript = path.join(buildDir, 'convert-icon.ps1');
    fs.writeFileSync(tempScript, psScript);

    // 执行 PowerShell 脚本
    execSync(`powershell -ExecutionPolicy Bypass -File "${tempScript}"`, {
      stdio: 'inherit',
      cwd: buildDir
    });

    // 清理临时脚本
    fs.unlinkSync(tempScript);

    console.log(`✓ Icon generated: ${iconPath}`);
    return iconPath;
  } catch (error) {
    console.error('PowerShell conversion failed, trying alternative method...');

    // 备选方案：直接复制 PNG 到 build 目录
    // Electron 支持 PNG 格式
    const pngPath = path.join(buildDir, 'icon.png');
    fs.copyFileSync(logoPath, pngPath);
    console.log(`✓ Copied PNG icon: ${pngPath}`);

    return pngPath;
  }
};

generateIcons().catch(console.error);
