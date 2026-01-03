/**
 * Web IDE 补丁脚本
 * 自动修改必要的文件以集成 Web IDE 功能
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 开始应用 Web IDE 补丁...\n');

// 1. 修改 router/index.js
function patchRouter() {
  console.log('📝 修改 router/index.js...');

  const routerPath = path.join(__dirname, 'src/renderer/router/index.js');
  let content = fs.readFileSync(routerPath, 'utf-8');

  // 检查是否已经添加
  if (content.includes('path: \'webide\'')) {
    console.log('   ✅ Web IDE 路由已存在，跳过\n');
    return;
  }

  // 在 AI对话 路由之后添加 Web IDE 路由
  const webideRoute = `      // Web IDE
      {
        path: 'webide',
        name: 'WebIDE',
        component: () => import('../pages/webide/WebIDEPage.vue'),
        meta: { title: 'Web IDE' },
      },`;

  // 查找插入位置（AI对话路由之后）
  const aiChatPattern = /(\s+\/\/ AI对话[\s\S]*?meta: \{ title: 'AI对话' \},\n)(\s+\],)/;

  if (aiChatPattern.test(content)) {
    content = content.replace(aiChatPattern, `$1${webideRoute}\n$2`);
    fs.writeFileSync(routerPath, content, 'utf-8');
    console.log('   ✅ 路由添加成功\n');
  } else {
    console.log('   ⚠️  未找到插入位置，请手动添加\n');
  }
}

// 2. 修改 preload/index.js
function patchPreload() {
  console.log('📝 修改 preload/index.js...');

  const preloadPath = path.join(__dirname, 'src/preload/index.js');
  let content = fs.readFileSync(preloadPath, 'utf-8');

  // 检查是否已经添加
  if (content.includes('webIDE:')) {
    console.log('   ✅ webIDE API 已存在，跳过\n');
    return;
  }

  const webideAPI = `
  // Web IDE
  webIDE: {
    // 项目管理
    saveProject: (data) => ipcRenderer.invoke('webide:saveProject', removeUndefined(data)),
    loadProject: (projectId) => ipcRenderer.invoke('webide:loadProject', projectId),
    getProjectList: () => ipcRenderer.invoke('webide:getProjectList'),
    deleteProject: (projectId) => ipcRenderer.invoke('webide:deleteProject', projectId),

    // 预览服务器
    startDevServer: (data) => ipcRenderer.invoke('webide:startDevServer', removeUndefined(data)),
    stopDevServer: (port) => ipcRenderer.invoke('webide:stopDevServer', port),
    getServerStatus: () => ipcRenderer.invoke('webide:getServerStatus'),

    // 导出功能
    exportHTML: (data) => ipcRenderer.invoke('webide:exportHTML', removeUndefined(data)),
    exportZIP: (data) => ipcRenderer.invoke('webide:exportZIP', removeUndefined(data)),
    captureScreenshot: (options) => ipcRenderer.invoke('webide:captureScreenshot', removeUndefined(options)),
  },`;

  // 在最后的 }); 之前添加
  const pattern = /(\n\s+\/\/ 数据同步[\s\S]*?onShowConflicts:[\s\S]*?\},\n)(\}\);)/;

  if (pattern.test(content)) {
    content = content.replace(pattern, `$1${webideAPI}\n$2`);
    fs.writeFileSync(preloadPath, content, 'utf-8');
    console.log('   ✅ webIDE API 添加成功\n');
  } else {
    console.log('   ⚠️  未找到插入位置，请手动添加\n');
  }
}

// 3. 修改 main/index.js
function patchMain() {
  console.log('📝 修改 main/index.js...');

  const mainPath = path.join(__dirname, 'src/main/index.js');
  let content = fs.readFileSync(mainPath, 'utf-8');

  // 检查是否已经添加变量声明
  if (content.includes('this.webideManager')) {
    console.log('   ✅ WebIDE 变量已存在，跳过变量声明');
  } else {
    // 添加变量声明
    const varPattern = /(this\.gitAutoCommit = null;)/;
    const varDeclaration = `$1

    // Web IDE
    this.webideManager = null;
    this.webideIPC = null;`;

    if (varPattern.test(content)) {
      content = content.replace(varPattern, varDeclaration);
      console.log('   ✅ 变量声明添加成功');
    }
  }

  // 检查是否已经添加初始化代码
  if (content.includes('new WebIDEManager()')) {
    console.log('   ✅ WebIDE 初始化代码已存在，跳过\n');
    return;
  }

  // 添加初始化代码
  const initCode = `
    // 初始化 Web IDE
    console.log('[Main] 初始化 Web IDE...');
    const WebIDEManager = require('./webide/webide-manager');
    const WebIDEIPC = require('./webide/webide-ipc');
    const PreviewServer = require('./engines/preview-server');

    // 初始化 Preview Server（如果还没有）
    if (!this.previewServer) {
      this.previewServer = new PreviewServer();
    }

    this.webideManager = new WebIDEManager();
    this.webideIPC = new WebIDEIPC(this.webideManager, this.previewServer);
    this.webideIPC.registerHandlers();
    console.log('[Main] Web IDE 管理器初始化完成');
`;

  // 查找引擎初始化位置（在 documentEngine 之后）
  const initPattern = /(this\.documentEngine = new DocumentEngine\(\);)/;

  if (initPattern.test(content)) {
    content = content.replace(initPattern, `$1${initCode}`);
    fs.writeFileSync(mainPath, content, 'utf-8');
    console.log('   ✅ 初始化代码添加成功\n');
  } else {
    console.log('   ⚠️  未找到插入位置，请手动添加初始化代码\n');
  }
}

// 执行补丁
try {
  patchRouter();
  patchPreload();
  patchMain();

  console.log('✨ Web IDE 补丁应用完成！');
  console.log('\n📌 下一步：');
  console.log('   1. 重启开发服务器: npm run dev');
  console.log('   2. 访问: http://localhost:5173/#/webide\n');
} catch (error) {
  console.error('❌ 补丁应用失败:', error.message);
  console.error('\n请手动修改文件，参考之前的说明。');
  process.exit(1);
}
