/**
 * 菜单集成测试脚本
 * 验证MenuManager和AdvancedFeaturesIPC是否正确集成
 */

const path = require('path');
const fs = require('fs');

console.log('====================================');
console.log('菜单集成测试');
console.log('====================================\n');

let passCount = 0;
let failCount = 0;

function test(description, testFn) {
  try {
    const result = testFn();
    if (result) {
      console.log(`✓ ${description}`);
      passCount++;
    } else {
      console.log(`✗ ${description}`);
      failCount++;
    }
  } catch (error) {
    console.log(`✗ ${description}`);
    console.log(`  错误: ${error.message}`);
    failCount++;
  }
}

// 测试1: 检查MenuManager文件存在
test('MenuManager文件存在', () => {
  const menuManagerPath = path.join(__dirname, 'src', 'main', 'menu-manager.js');
  return fs.existsSync(menuManagerPath);
});

// 测试2: 检查AdvancedFeaturesIPC文件存在
test('AdvancedFeaturesIPC文件存在', () => {
  const ipcPath = path.join(__dirname, 'src', 'main', 'advanced-features-ipc.js');
  return fs.existsSync(ipcPath);
});

// 测试3: 检查控制面板API文件存在
test('控制面板API文件存在', () => {
  const apiPath = path.join(__dirname, 'control-panel-api.js');
  return fs.existsSync(apiPath);
});

// 测试4: 检查控制面板HTML文件存在
test('控制面板HTML文件存在', () => {
  const htmlPath = path.join(__dirname, 'control-panel.html');
  return fs.existsSync(htmlPath);
});

// 测试5: 检查配置文件存在
test('高级特性配置文件存在', () => {
  const configPath = path.join(__dirname, 'config', 'advanced-features.json');
  return fs.existsSync(configPath);
});

// 测试6: 检查index.js中是否导入了MenuManager
test('index.js已导入MenuManager', () => {
  const indexPath = path.join(__dirname, 'src', 'main', 'index.js');
  const content = fs.readFileSync(indexPath, 'utf8');
  return content.includes("require('./menu-manager')");
});

// 测试7: 检查index.js中是否导入了AdvancedFeaturesIPC
test('index.js已导入AdvancedFeaturesIPC', () => {
  const indexPath = path.join(__dirname, 'src', 'main', 'index.js');
  const content = fs.readFileSync(indexPath, 'utf8');
  return content.includes("require('./advanced-features-ipc')");
});

// 测试8: 检查index.js中是否初始化了MenuManager
test('index.js已初始化MenuManager', () => {
  const indexPath = path.join(__dirname, 'src', 'main', 'index.js');
  const content = fs.readFileSync(indexPath, 'utf8');
  return content.includes('new MenuManager(this.mainWindow)') &&
         content.includes('this.menuManager.createMenu()');
});

// 测试9: 检查index.js中是否初始化了AdvancedFeaturesIPC
test('index.js已初始化AdvancedFeaturesIPC', () => {
  const indexPath = path.join(__dirname, 'src', 'main', 'index.js');
  const content = fs.readFileSync(indexPath, 'utf8');
  return content.includes('new AdvancedFeaturesIPC(this.mainWindow)');
});

// 测试10: 检查index.js中是否添加了cleanup代码
test('index.js已添加cleanup代码', () => {
  const indexPath = path.join(__dirname, 'src', 'main', 'index.js');
  const content = fs.readFileSync(indexPath, 'utf8');
  return content.includes('this.menuManager.destroy()');
});

// 测试11: 检查MenuManager是否定义了所有关键方法
test('MenuManager包含所有关键方法', () => {
  const MenuManager = require('./src/main/menu-manager');
  const instance = new MenuManager(null);
  return typeof instance.createMenu === 'function' &&
         typeof instance.openControlPanel === 'function' &&
         typeof instance.openControlPanelTab === 'function' &&
         typeof instance.checkControlPanelRunning === 'function' &&
         typeof instance.startControlPanelAPI === 'function' &&
         typeof instance.destroy === 'function';
});

// 测试12: 检查AdvancedFeaturesIPC类定义
test('AdvancedFeaturesIPC类定义正确', () => {
  const AdvancedFeaturesIPC = require('./src/main/advanced-features-ipc');
  // 读取文件内容检查方法定义（避免实例化需要ipcMain）
  const ipcPath = path.join(__dirname, 'src', 'main', 'advanced-features-ipc.js');
  const content = fs.readFileSync(ipcPath, 'utf8');
  return content.includes('setupHandlers()') &&
         content.includes('executeScript(') &&
         content.includes('getOverviewData(') &&
         typeof AdvancedFeaturesIPC === 'function';
});

// 测试13: 检查配置文件格式
test('配置文件格式正确', () => {
  const configPath = path.join(__dirname, 'config', 'advanced-features.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return config.adaptiveThreshold &&
         config.onlineLearning &&
         config.advancedOptimizer &&
         config.logging;
});

// 测试14: 检查启动脚本存在
test('启动脚本存在', () => {
  const batPath = path.join(__dirname, 'start-control-panel.bat');
  return fs.existsSync(batPath);
});

// 测试15: 检查文档存在
test('集成文档存在', () => {
  const docPath = path.join(__dirname, 'MENU_INTEGRATION_COMPLETE.md');
  return fs.existsSync(docPath);
});

// 显示测试结果
console.log('\n====================================');
console.log('测试结果');
console.log('====================================');
console.log(`✓ 通过: ${passCount} 个测试`);
console.log(`✗ 失败: ${failCount} 个测试`);
console.log(`总计: ${passCount + failCount} 个测试`);

if (failCount === 0) {
  console.log('\n🎉 所有测试通过！菜单集成成功完成。');
  console.log('\n下一步:');
  console.log('1. 运行 npm run dev 启动应用');
  console.log('2. 查看菜单栏中的"工具"菜单');
  console.log('3. 使用 Ctrl+Shift+A 打开控制面板');
  console.log('4. 或运行 start-control-panel.bat 独立启动控制面板');
  process.exit(0);
} else {
  console.log('\n⚠️ 有测试失败，请检查上述错误。');
  process.exit(1);
}
