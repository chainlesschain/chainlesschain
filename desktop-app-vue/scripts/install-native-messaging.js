#!/usr/bin/env node

/**
 * ChainlessChain Native Messaging Host 安装脚本
 * 在系统中注册 Native Messaging Host，使浏览器扩展能够与桌面应用通信
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

// Host 配置
const HOST_NAME = 'com.chainlesschain.clipper';
const HOST_DESCRIPTION = 'ChainlessChain Web Clipper Native Messaging Host';

// 路径
const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOST_SCRIPT = path.join(PROJECT_ROOT, 'src', 'main', 'native-messaging', 'native-host.js');

/**
 * 创建 Host Manifest 文件
 */
function createManifest(hostPath) {
  const manifest = {
    name: HOST_NAME,
    description: HOST_DESCRIPTION,
    path: hostPath,
    type: 'stdio',
    allowed_origins: [
      // Chrome 扩展 ID (需要在打包后更新)
      'chrome-extension://EXTENSION_ID/',
    ],
  };

  return JSON.stringify(manifest, null, 2);
}

/**
 * Windows 安装
 */
async function installWindows() {
  console.log('在 Windows 上安装 Native Messaging Host...');

  // 创建 Host 脚本包装器 (bat 文件)
  const batPath = path.join(PROJECT_ROOT, 'native-host.bat');
  const batContent = `@echo off
node "${HOST_SCRIPT}" %*
`;

  fs.writeFileSync(batPath, batContent, 'utf8');
  console.log('✓ 创建 Host 脚本包装器:', batPath);

  // 创建 Manifest 文件
  const manifestPath = path.join(PROJECT_ROOT, 'native-host-manifest.json');
  const manifestContent = createManifest(batPath);
  fs.writeFileSync(manifestPath, manifestContent, 'utf8');
  console.log('✓ 创建 Manifest 文件:', manifestPath);

  // 注册到 Windows 注册表
  const regKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  const regCommand = `reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`;

  return new Promise((resolve, reject) => {
    exec(regCommand, (error, stdout, stderr) => {
      if (error) {
        console.error('✗ 注册失败:', error);
        reject(error);
        return;
      }

      console.log('✓ 已注册到 Chrome 注册表');

      // 同时注册到 Edge
      const edgeRegKey = `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`;
      const edgeRegCommand = `reg add "${edgeRegKey}" /ve /t REG_SZ /d "${manifestPath}" /f`;

      exec(edgeRegCommand, (error, stdout, stderr) => {
        if (error) {
          console.warn('⚠ Edge 注册失败 (可能未安装 Edge)');
        } else {
          console.log('✓ 已注册到 Edge 注册表');
        }

        resolve();
      });
    });
  });
}

/**
 * macOS 安装
 */
async function installMacOS() {
  console.log('在 macOS 上安装 Native Messaging Host...');

  // 创建 Manifest 文件
  const manifestDir = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);

  // 确保目录存在
  if (!fs.existsSync(manifestDir)) {
    fs.mkdirSync(manifestDir, { recursive: true });
  }

  // 创建 Host 脚本包装器
  const wrapperPath = path.join(PROJECT_ROOT, 'native-host.sh');
  const wrapperContent = `#!/bin/bash
node "${HOST_SCRIPT}" "$@"
`;

  fs.writeFileSync(wrapperPath, wrapperContent, { mode: 0o755 });
  console.log('✓ 创建 Host 脚本包装器:', wrapperPath);

  // 创建 Manifest
  const manifestContent = createManifest(wrapperPath);
  fs.writeFileSync(manifestPath, manifestContent, 'utf8');
  console.log('✓ 创建 Manifest 文件:', manifestPath);

  // 同时为 Chromium 创建
  const chromiumManifestDir = path.join(os.homedir(), 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts');
  if (!fs.existsSync(chromiumManifestDir)) {
    fs.mkdirSync(chromiumManifestDir, { recursive: true });
  }

  const chromiumManifestPath = path.join(chromiumManifestDir, `${HOST_NAME}.json`);
  fs.writeFileSync(chromiumManifestPath, manifestContent, 'utf8');
  console.log('✓ 已注册到 Chromium');

  console.log('✓ macOS 安装完成');
}

/**
 * Linux 安装
 */
async function installLinux() {
  console.log('在 Linux 上安装 Native Messaging Host...');

  // 创建 Manifest 文件
  const manifestDir = path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts');
  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);

  // 确保目录存在
  if (!fs.existsSync(manifestDir)) {
    fs.mkdirSync(manifestDir, { recursive: true });
  }

  // 创建 Host 脚本包装器
  const wrapperPath = path.join(PROJECT_ROOT, 'native-host.sh');
  const wrapperContent = `#!/bin/bash
node "${HOST_SCRIPT}" "$@"
`;

  fs.writeFileSync(wrapperPath, wrapperContent, { mode: 0o755 });
  console.log('✓ 创建 Host 脚本包装器:', wrapperPath);

  // 创建 Manifest
  const manifestContent = createManifest(wrapperPath);
  fs.writeFileSync(manifestPath, manifestContent, 'utf8');
  console.log('✓ 创建 Manifest 文件:', manifestPath);

  // 同时为 Chromium 创建
  const chromiumManifestDir = path.join(os.homedir(), '.config', 'chromium', 'NativeMessagingHosts');
  if (!fs.existsSync(chromiumManifestDir)) {
    fs.mkdirSync(chromiumManifestDir, { recursive: true });
  }

  const chromiumManifestPath = path.join(chromiumManifestDir, `${HOST_NAME}.json`);
  fs.writeFileSync(chromiumManifestPath, manifestContent, 'utf8');
  console.log('✓ 已注册到 Chromium');

  console.log('✓ Linux 安装完成');
}

/**
 * 主函数
 */
async function main() {
  console.log('='.repeat(60));
  console.log('ChainlessChain Native Messaging Host 安装程序');
  console.log('='.repeat(60));
  console.log();

  // 检查 Host 脚本是否存在
  if (!fs.existsSync(HOST_SCRIPT)) {
    console.error('✗ 错误: Host 脚本不存在:', HOST_SCRIPT);
    process.exit(1);
  }

  try {
    const platform = os.platform();

    if (platform === 'win32') {
      await installWindows();
    } else if (platform === 'darwin') {
      await installMacOS();
    } else if (platform === 'linux') {
      await installLinux();
    } else {
      console.error('✗ 不支持的操作系统:', platform);
      process.exit(1);
    }

    console.log();
    console.log('='.repeat(60));
    console.log('✓ 安装成功！');
    console.log('='.repeat(60));
    console.log();
    console.log('下一步:');
    console.log('1. 在浏览器中加载扩展 (browser-extension 目录)');
    console.log('2. 启动 ChainlessChain 桌面应用');
    console.log('3. 点击扩展图标测试连接');
    console.log();

  } catch (error) {
    console.error('✗ 安装失败:', error.message);
    process.exit(1);
  }
}

// 运行
main();
