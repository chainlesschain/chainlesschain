#!/usr/bin/env node

/**
 * 插件安装脚本
 * 用于将示例插件导入到 ChainlessChain 系统中
 *
 * 使用方法:
 *   node install-plugins.js [plugin-name]
 *
 * 示例:
 *   node install-plugins.js                    # 安装所有示例插件
 *   node install-plugins.js weather-query      # 仅安装天气查询插件
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 示例插件列表
const EXAMPLE_PLUGINS = [
  {
    id: 'weather-query',
    name: '天气查询插件',
    directory: 'weather-query'
  },
  {
    id: 'translator',
    name: '多语言翻译插件',
    directory: 'translator'
  },
  {
    id: 'markdown-exporter',
    name: 'Markdown增强导出插件',
    directory: 'markdown-exporter'
  }
];

/**
 * 复制目录
 */
function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 验证插件manifest
 */
function validatePlugin(pluginPath) {
  const manifestPath = path.join(pluginPath, 'plugin.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error('插件目录中未找到 plugin.json');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  if (!manifest.id || !manifest.name || !manifest.version) {
    throw new Error('plugin.json 缺少必需字段 (id, name, version)');
  }

  return manifest;
}

/**
 * 安装单个插件
 */
function installPlugin(pluginInfo) {
  console.log(`\n📦 安装插件: ${pluginInfo.name}`);

  try {
    // 源路径
    const sourcePath = path.join(__dirname, pluginInfo.directory);

    if (!fs.existsSync(sourcePath)) {
      console.error(`   ❌ 错误: 插件目录不存在 - ${sourcePath}`);
      return false;
    }

    // 验证插件
    console.log('   🔍 验证插件配置...');
    const manifest = validatePlugin(sourcePath);
    console.log(`   ✓ 插件ID: ${manifest.id}`);
    console.log(`   ✓ 版本: ${manifest.version}`);

    // 目标路径（用户数据目录）
    let targetPath;

    // 检查是否在 Electron 环境中
    if (typeof app !== 'undefined' && app.getPath) {
      targetPath = path.join(app.getPath('userData'), 'plugins', 'custom', manifest.id);
    } else {
      // 如果不在 Electron 环境中，使用相对路径（开发模式）
      const projectRoot = path.resolve(__dirname, '../../..');
      targetPath = path.join(projectRoot, 'data', 'plugins', 'custom', manifest.id);
    }

    // 创建目标目录
    console.log('   📁 创建目标目录...');
    console.log(`   路径: ${targetPath}`);

    if (fs.existsSync(targetPath)) {
      console.log('   ⚠️  目标目录已存在，将被覆盖');
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    // 复制插件文件
    console.log('   📋 复制插件文件...');
    copyDirectory(sourcePath, targetPath);

    console.log(`   ✅ ${pluginInfo.name} 安装成功!`);
    console.log(`   📍 安装位置: ${targetPath}`);

    return true;
  } catch (error) {
    console.error(`   ❌ 安装失败: ${error.message}`);
    return false;
  }
}

/**
 * 主函数
 */
function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   ChainlessChain 示例插件安装工具                ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  // 解析命令行参数
  const args = process.argv.slice(2);
  const targetPlugin = args[0];

  let pluginsToInstall = EXAMPLE_PLUGINS;

  // 如果指定了插件名称，只安装该插件
  if (targetPlugin) {
    const plugin = EXAMPLE_PLUGINS.find(p => p.id === targetPlugin || p.directory === targetPlugin);

    if (!plugin) {
      console.error(`\n❌ 未找到插件: ${targetPlugin}`);
      console.log('\n可用的示例插件:');
      EXAMPLE_PLUGINS.forEach(p => {
        console.log(`  - ${p.id} (${p.name})`);
      });
      process.exit(1);
    }

    pluginsToInstall = [plugin];
  }

  console.log(`\n将安装 ${pluginsToInstall.length} 个插件...\n`);

  // 安装插件
  let successCount = 0;
  let failureCount = 0;

  for (const plugin of pluginsToInstall) {
    const success = installPlugin(plugin);
    if (success) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  // 显示总结
  console.log('\n' + '═'.repeat(55));
  console.log('📊 安装总结:');
  console.log(`   ✅ 成功: ${successCount} 个`);
  console.log(`   ❌ 失败: ${failureCount} 个`);
  console.log('═'.repeat(55));

  if (successCount > 0) {
    console.log('\n💡 提示:');
    console.log('   1. 重启 ChainlessChain 应用以加载新插件');
    console.log('   2. 在 设置 > 插件管理 中启用插件');
    console.log('   3. 查看各插件的 README.md 了解使用方法');
  }

  process.exit(failureCount > 0 ? 1 : 0);
}

// 运行主函数
if (require.main === module) {
  main();
}

module.exports = { installPlugin };
