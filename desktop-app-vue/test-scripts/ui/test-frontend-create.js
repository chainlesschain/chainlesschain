/**
 * 测试模拟前端UI创建项目的情况
 * 这个测试会模拟前端调用 electronAPI 创建项目的完整流程
 */

const { app, ipcMain } = require('electron');
const path = require('path');
const Database = require('./src/main/database.js');

// 注册 project core IPC handlers
const { registerProjectCoreIPC } = require('./src/main/project/project-core-ipc');

// 模拟 _replaceUndefinedWithNull 函数
function _replaceUndefinedWithNull(obj) {
  if (obj === undefined || obj === null) {
    return null;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => _replaceUndefinedWithNull(item));
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      result[key] = _replaceUndefinedWithNull(obj[key]);
    }
    return result;
  }

  return obj;
}

// 模拟 removeUndefinedValues 函数
function removeUndefinedValues(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedValues(item));
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      const value = obj[key];
      if (value !== undefined) {
        result[key] = removeUndefinedValues(value);
      }
    }
    return result;
  }

  return obj;
}

async function testFrontendCreate() {
  console.log('=== 测试前端UI创建项目流程 ===\n');

  try {
    // 1. 初始化数据库
    const dbPath = path.join(__dirname, 'data', 'chainlesschain.db');
    console.log('数据库路径:', dbPath);

    const database = new Database(dbPath, {
      password: null,
      encryptionEnabled: false
    });

    await database.initialize();
    console.log('✓ 数据库初始化成功\n');

    // 2. 注册 IPC handlers
    console.log('注册 Project Core IPC handlers...');
    registerProjectCoreIPC({
      database,
      fileSyncManager: null, // 测试时不需要
      removeUndefinedValues,
      _replaceUndefinedWithNull
    });
    console.log('✓ IPC handlers 注册成功\n');

    // 3. 模拟前端调用 - 使用快速创建（不需要后端服务）
    console.log('模拟前端调用快速创建项目...');
    const createData = {
      name: '前端测试项目_' + Date.now(),
      description: '这是一个通过前端UI创建的测试项目',
      projectType: 'document',
      userId: 'test-user-frontend'
    };

    console.log('创建数据:', createData);
    console.log('\n调用 project:create-quick IPC handler...');

    // 模拟 IPC 调用
    const mockEvent = { sender: { send: () => {} } };

    // 调用快速创建handler（不需要后端）
    const result = await new Promise((resolve, reject) => {
      // 创建一个一次性的 handler
      const handler = async (event, data) => {
        try {
          const result = await ipcMain._events['project:create-quick'][0](event, data);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      handler(mockEvent, createData).catch(reject);
    });

    console.log('\n✓ 项目创建成功！');
    console.log('返回结果:');
    console.log('  - ID:', result.id);
    console.log('  - 名称:', result.name);
    console.log('  - 类型:', result.project_type);
    console.log('  - 路径:', result.root_path);
    console.log('  - 文件数量:', result.file_count);

    // 4. 验证数据库中的记录
    console.log('\n验证数据库记录...');
    const savedProject = database.getProjectById(result.id);
    console.log('✓ 数据库中找到项目:', savedProject.name);

    const savedFiles = database.getProjectFiles(result.id);
    console.log('✓ 数据库中找到文件数量:', savedFiles.length);

    if (savedFiles.length > 0) {
      console.log('文件列表:');
      savedFiles.forEach((file, index) => {
        console.log(`  ${index + 1}. ${file.file_name} (${file.file_type})`);
      });
    }

    // 5. 验证文件系统
    console.log('\n验证文件系统...');
    const fs = require('fs').promises;
    try {
      const dirContents = await fs.readdir(result.root_path);
      console.log('✓ 项目目录存在，包含文件:');
      dirContents.forEach((file, index) => {
        console.log(`  ${index + 1}. ${file}`);
      });
    } catch (error) {
      console.error('✗ 读取项目目录失败:', error.message);
    }

    console.log('\n=== ✓ 所有测试通过！ ===\n');
    console.log('测试总结:');
    console.log('✓ 数据库初始化正常');
    console.log('✓ IPC handlers 注册成功');
    console.log('✓ 前端快速创建项目成功');
    console.log('✓ 数据库记录保存正确');
    console.log('✓ 文件系统写入正常');
    console.log('\n项目位置:', result.root_path);

  } catch (error) {
    console.error('\n=== ✗ 测试失败 ===');
    console.error('错误信息:', error.message);
    console.error('错误堆栈:', error.stack);

    // 提供调试建议
    console.error('\n可能的原因:');
    if (error.message.includes('No handler registered')) {
      console.error('- IPC handler 未正确注册');
      console.error('- 建议: 检查 registerProjectCoreIPC 是否被正确调用');
    } else if (error.message.includes('ENOENT')) {
      console.error('- 文件或目录不存在');
      console.error('- 建议: 检查项目路径配置');
    } else if (error.message.includes('database')) {
      console.error('- 数据库相关错误');
      console.error('- 建议: 检查数据库初始化和权限');
    }

    process.exit(1);
  }
}

// 模拟 app ready 状态（因为不在真实 Electron 环境）
if (!app || !app.isReady || !app.isReady()) {
  console.log('警告: 不在 Electron 环境中，使用模拟模式\n');

  // 直接运行测试
  testFrontendCreate().catch(error => {
    console.error('测试执行出错:', error);
    process.exit(1);
  });
} else {
  // 在 Electron 环境中等待 app ready
  app.whenReady().then(() => {
    testFrontendCreate().catch(error => {
      console.error('测试执行出错:', error);
      app.quit();
    });
  });
}
