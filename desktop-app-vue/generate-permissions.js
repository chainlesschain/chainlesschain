/**
 * 自动生成工具permissions
 * 基于工具类别、风险级别和功能描述智能生成权限定义
 */

const fs = require('fs');
const report = require('./missing-fields-report.json');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  批量生成Permissions                                    ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 权限映射规则：根据类别和功能生成权限
const categoryPermissions = {
  // 文件和存储
  file: ['file:read', 'file:write'],
  storage: ['storage:read', 'storage:write'],
  database: ['database:read', 'database:write'],

  // 网络和通信
  network: ['network:request'],
  web: ['network:request'],
  api: ['network:request'],
  email: ['network:request', 'email:send'],

  // 代码和开发
  code: ['code:execute', 'code:analyze'],
  devops: ['system:control', 'code:execute'],
  'version-control': ['file:read', 'file:write', 'network:request'],

  // 系统和硬件
  system: ['system:control'],
  hardware: ['hardware:access'],

  // 安全
  security: ['security:manage'],
  encryption: ['security:manage'],

  // 数据处理
  data: ['data:read', 'data:write'],
  text: ['data:read'],
  format: ['data:read'],
  encoding: ['data:read'],

  // AI和分析
  ai: ['ai:inference', 'data:read'],
  analysis: ['data:read', 'data:analyze'],
  nlp: ['ai:inference', 'data:read'],
  'machine-learning': ['ai:inference', 'data:read'],

  // 媒体
  image: ['media:process', 'file:read'],
  audio: ['media:process', 'file:read'],
  video: ['media:process', 'file:read'],
  media: ['media:process', 'file:read'],

  // 办公和文档
  office: ['file:read', 'file:write'],
  document: ['file:read', 'file:write'],
  pdf: ['file:read', 'file:write'],

  // 自动化和管理
  automation: ['system:control', 'task:manage'],
  workflow: ['task:manage'],
  management: ['data:read', 'data:write'],
  config: ['config:read', 'config:write'],

  // 业务功能
  crm: ['data:read', 'data:write', 'network:request'],
  hr: ['data:read', 'data:write'],
  finance: ['data:read', 'data:write', 'security:manage'],
  blockchain: ['network:request', 'security:manage'],
  trading: ['network:request', 'data:read'],

  // 其他
  utility: ['data:read'],
  template: ['data:read'],
  location: ['network:request', 'data:read'],
  event: ['data:read'],
  procurement: ['data:read', 'data:write']
};

// 基于风险级别添加额外权限
function addRiskBasedPermissions(permissions, riskLevel) {
  if (riskLevel >= 3) {
    // 中高风险工具需要用户确认
    if (!permissions.includes('user:confirm')) {
      permissions.push('user:confirm');
    }
  }
  if (riskLevel >= 4) {
    // 高风险工具需要管理员权限
    if (!permissions.includes('admin:approve')) {
      permissions.push('admin:approve');
    }
  }
  return permissions;
}

// 基于工具名称和描述推断额外权限
function inferPermissionsFromTool(tool) {
  const extraPerms = [];
  const name = tool.name.toLowerCase();
  const desc = (tool.description || '').toLowerCase();

  // 写入操作
  if (name.includes('write') || name.includes('create') || name.includes('update') ||
      name.includes('delete') || name.includes('generate') || name.includes('save')) {
    if (name.includes('file') || desc.includes('文件')) {
      extraPerms.push('file:write');
    }
    if (name.includes('data') || desc.includes('数据')) {
      extraPerms.push('data:write');
    }
  }

  // 读取操作
  if (name.includes('read') || name.includes('load') || name.includes('parse') ||
      name.includes('analyze') || name.includes('query')) {
    if (name.includes('file') || desc.includes('文件')) {
      extraPerms.push('file:read');
    }
    if (name.includes('data') || desc.includes('数据')) {
      extraPerms.push('data:read');
    }
  }

  // 网络请求
  if (name.includes('fetch') || name.includes('request') || name.includes('api') ||
      name.includes('http') || desc.includes('网络') || desc.includes('请求')) {
    extraPerms.push('network:request');
  }

  // 执行操作
  if (name.includes('execute') || name.includes('run') || name.includes('call') ||
      desc.includes('执行') || desc.includes('运行')) {
    extraPerms.push('code:execute');
  }

  return extraPerms;
}

// 生成工具的permissions
function generatePermissions(tool) {
  let permissions = [];

  // 1. 基于类别的基础权限
  const categoryPerms = categoryPermissions[tool.category] || ['data:read'];
  permissions.push(...categoryPerms);

  // 2. 基于工具名称和描述推断的权限
  const inferredPerms = inferPermissionsFromTool(tool);
  inferredPerms.forEach(perm => {
    if (!permissions.includes(perm)) {
      permissions.push(perm);
    }
  });

  // 3. 基于风险级别添加权限
  permissions = addRiskBasedPermissions(permissions, tool.riskLevel || 1);

  // 去重并排序
  permissions = [...new Set(permissions)].sort();

  return permissions;
}

const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const toolsMap = new Map(tools.map(t => [t.id, t]));

const generatedPermissions = {};

report.missingPermissions.forEach(toolInfo => {
  const tool = toolsMap.get(toolInfo.id);
  if (!tool) return;

  const permissions = generatePermissions(tool);
  generatedPermissions[toolInfo.id] = permissions;
});

console.log(`✅ 已为 ${Object.keys(generatedPermissions).length} 个工具生成permissions`);

// 按类别统计
const byCategory = {};
Object.keys(generatedPermissions).forEach(id => {
  const tool = toolsMap.get(id);
  const cat = tool?.category || 'unknown';
  byCategory[cat] = (byCategory[cat] || 0) + 1;
});

console.log('\n按类别统计:');
Object.entries(byCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
  console.log(`  ${cat}: ${count}个`);
});

// 保存到文件
fs.writeFileSync('./generated-permissions.json', JSON.stringify(generatedPermissions, null, 2));
console.log('\n📄 已保存到: generated-permissions.json');

// 显示几个示例
console.log('\n示例预览:');
const sampleIds = Object.keys(generatedPermissions).slice(0, 5);
sampleIds.forEach(id => {
  const tool = toolsMap.get(id);
  console.log(`\n${id} (${tool?.category}, risk=${tool?.risk_level || 1}):`);
  console.log(JSON.stringify(generatedPermissions[id], null, 2));
});

// 统计生成的权限类型
const permissionTypes = {};
Object.values(generatedPermissions).forEach(perms => {
  perms.forEach(perm => {
    permissionTypes[perm] = (permissionTypes[perm] || 0) + 1;
  });
});

console.log('\n权限类型统计:');
Object.entries(permissionTypes)
  .sort((a, b) => b[1] - a[1])
  .forEach(([perm, count]) => {
    console.log(`  ${perm}: ${count}个工具使用`);
  });
