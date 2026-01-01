/**
 * 生产部署配置管理脚本
 * 用于在P0/P1/P2三个阶段之间切换配置
 *
 * Usage:
 *   node deploy-config.js p0    # Phase 1: 仅启用P0优化
 *   node deploy-config.js p1    # Phase 2: 启用P0+P1优化
 *   node deploy-config.js p2    # Phase 3: 启用P0+P1+P2全部优化
 *   node deploy-config.js check # 检查当前配置状态
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'src/main/ai-engine/ai-engine-config.js');

// 部署配置模板
const DEPLOYMENT_CONFIGS = {
  p0: {
    name: 'Phase 1: P0 优化（基础稳定性）',
    description: '启用槽位填充、工具沙箱、性能监控',
    config: {
      // P0 优化 - 全部启用
      enableSlotFilling: true,
      enableToolSandbox: true,
      enablePerformanceMonitor: true,

      // P1 优化 - 暂时禁用
      enableMultiIntent: false,
      enableDynamicFewShot: false,
      enableHierarchicalPlanning: false,
      enableCheckpointValidation: false,
      enableSelfCorrection: false,

      // P2 优化 - 暂时禁用
      enableIntentFusion: false,
      enableKnowledgeDistillation: false,
      enableStreamingResponse: false
    }
  },

  p1: {
    name: 'Phase 2: P0+P1 优化（智能增强）',
    description: '启用P0全部功能 + 多意图、Few-shot学习、任务规划、检查点、自我修正',
    config: {
      // P0 优化
      enableSlotFilling: true,
      enableToolSandbox: true,
      enablePerformanceMonitor: true,

      // P1 优化 - 全部启用
      enableMultiIntent: true,
      enableDynamicFewShot: true,
      enableHierarchicalPlanning: true,
      enableCheckpointValidation: true,
      enableSelfCorrection: true,

      // P2 优化 - 暂时禁用
      enableIntentFusion: false,
      enableKnowledgeDistillation: false,
      enableStreamingResponse: false
    }
  },

  p2: {
    name: 'Phase 3: P0+P1+P2 完整优化',
    description: '启用全部优化功能，最大化性能',
    config: {
      // 全部启用
      enableSlotFilling: true,
      enableToolSandbox: true,
      enablePerformanceMonitor: true,
      enableMultiIntent: true,
      enableDynamicFewShot: true,
      enableHierarchicalPlanning: true,
      enableCheckpointValidation: true,
      enableSelfCorrection: true,
      enableIntentFusion: true,
      enableKnowledgeDistillation: true,
      enableStreamingResponse: true
    }
  }
};

/**
 * 读取当前配置文件
 */
function readConfigFile() {
  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return content;
  } catch (error) {
    console.error('❌ 读取配置文件失败:', error.message);
    process.exit(1);
  }
}

/**
 * 更新配置文件中的布尔值
 */
function updateConfig(phase) {
  const deployment = DEPLOYMENT_CONFIGS[phase];
  if (!deployment) {
    console.error(`❌ 未知的部署阶段: ${phase}`);
    console.log('可用选项: p0, p1, p2, check');
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  ${deployment.name.padEnd(54)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`📋 ${deployment.description}\n`);

  let content = readConfigFile();

  // 备份原配置
  const backupFile = `${CONFIG_FILE}.backup.${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.writeFileSync(backupFile, content);
  console.log(`💾 原配置已备份到: ${path.basename(backupFile)}\n`);

  // 更新每个配置项
  console.log('🔧 更新配置项:');
  for (const [key, value] of Object.entries(deployment.config)) {
    const regex = new RegExp(`(${key}:\\s*)(true|false)`, 'g');
    const newValue = value.toString();

    content = content.replace(regex, (match, prefix, oldValue) => {
      const changed = oldValue !== newValue;
      const status = changed ? '✅' : '  ';
      console.log(`${status} ${key}: ${oldValue} → ${newValue}`);
      return `${prefix}${newValue}`;
    });
  }

  // 写入更新后的配置
  fs.writeFileSync(CONFIG_FILE, content);
  console.log(`\n✅ 配置文件已更新: ${path.basename(CONFIG_FILE)}`);
  console.log('\n🚀 下一步:');
  console.log('   1. 运行测试: npm test');
  console.log('   2. 构建应用: npm run build');
  console.log('   3. 启动应用: npm run dev\n');
}

/**
 * 检查当前配置状态
 */
function checkCurrentConfig() {
  const content = readConfigFile();

  console.log('\n📊 当前配置状态:\n');

  const configs = {
    'P0 优化': [
      'enableSlotFilling',
      'enableToolSandbox',
      'enablePerformanceMonitor'
    ],
    'P1 优化': [
      'enableMultiIntent',
      'enableDynamicFewShot',
      'enableHierarchicalPlanning',
      'enableCheckpointValidation',
      'enableSelfCorrection'
    ],
    'P2 优化': [
      'enableIntentFusion',
      'enableKnowledgeDistillation',
      'enableStreamingResponse'
    ]
  };

  for (const [category, keys] of Object.entries(configs)) {
    console.log(`\n${category}:`);
    keys.forEach(key => {
      const regex = new RegExp(`${key}:\\s*(true|false)`, 'g');
      const match = regex.exec(content);
      if (match) {
        const enabled = match[1] === 'true';
        const status = enabled ? '✅' : '❌';
        console.log(`  ${status} ${key}: ${match[1]}`);
      }
    });
  }

  console.log('\n');
}

/**
 * 主函数
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'check';

  if (command === 'check') {
    checkCurrentConfig();
  } else {
    updateConfig(command);
  }
}

main();
