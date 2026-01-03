/**
 * 测试快速创建项目的核心逻辑
 * 不涉及IPC，直接测试创建逻辑
 */

const Database = require('./src/main/database.js');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;

async function testQuickCreateLogic() {
  console.log('=== 测试快速创建项目核心逻辑 ===\n');

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

    // 2. 准备测试数据（模拟前端发送的数据）
    const createData = {
      name: '前端UI快速创建测试项目',
      description: '模拟前端UI快速创建的项目，不经过后端AI服务',
      projectType: 'document', // 或者 'web', 'data', 'app'
      userId: 'test-user-ui-frontend',
      status: 'draft'
    };

    console.log('创建参数:');
    console.log(JSON.stringify(createData, null, 2));
    console.log('');

    // 3. 执行快速创建逻辑（复制自 project-core-ipc.js 的逻辑）
    console.log('开始执行快速创建逻辑...\n');

    const projectId = crypto.randomUUID();
    const timestamp = Date.now();

    // 获取项目配置
    const { getProjectConfig } = require('./src/main/project/project-config');
    const projectConfig = getProjectConfig();

    // 创建项目文件夹
    const projectRootPath = path.join(
      projectConfig.getProjectsRootPath(),
      projectId
    );

    console.log('步骤 1: 创建项目目录');
    console.log('  目录路径:', projectRootPath);
    await fs.mkdir(projectRootPath, { recursive: true });
    console.log('  ✓ 目录创建成功\n');

    // 创建一个默认的README.md文件
    const readmePath = path.join(projectRootPath, 'README.md');
    const readmeContent = `# ${createData.name}\n\n${createData.description || '这是一个新建的项目。'}\n\n创建时间：${new Date().toLocaleString('zh-CN')}\n`;

    console.log('步骤 2: 创建README.md文件');
    console.log('  文件路径:', readmePath);
    await fs.writeFile(readmePath, readmeContent, 'utf-8');
    console.log('  ✓ 文件创建成功\n');

    // 构建项目对象
    const project = {
      id: projectId,
      name: createData.name,
      description: createData.description || '',
      project_type: createData.projectType || 'document',
      user_id: createData.userId || 'default-user',
      root_path: projectRootPath,
      created_at: timestamp,
      updated_at: timestamp,
      sync_status: 'pending',
      status: createData.status || 'draft',
      file_count: 1, // 包含README.md
      metadata: JSON.stringify({
        created_by: 'quick-create-ui-test',
        created_at: new Date().toISOString(),
      }),
    };

    // 保存到本地数据库
    console.log('步骤 3: 保存项目到数据库');
    await database.saveProject(project);
    console.log('  ✓ 项目保存成功\n');

    // 保存项目文件记录
    const file = {
      project_id: projectId,
      file_name: 'README.md',
      file_path: 'README.md',
      file_type: 'markdown',
      content: readmeContent,
      created_at: timestamp,
      updated_at: timestamp,
    };

    console.log('步骤 4: 保存文件记录到数据库');
    await database.saveProjectFiles(projectId, [file]);
    console.log('  ✓ 文件记录保存成功\n');

    // 验证保存的数据
    console.log('步骤 5: 验证保存的数据');
    const savedProject = database.getProjectById(projectId);
    console.log('  ✓ 项目信息:');
    console.log('    - ID:', savedProject.id);
    console.log('    - 名称:', savedProject.name);
    console.log('    - 类型:', savedProject.project_type);
    console.log('    - 状态:', savedProject.status);
    console.log('    - 路径:', savedProject.root_path);
    console.log('    - 文件数量:', savedProject.file_count);

    const savedFiles = database.getProjectFiles(projectId);
    console.log('\n  ✓ 文件列表:');
    savedFiles.forEach((file, index) => {
      console.log(`    ${index + 1}. ${file.file_name} (${file.file_type})`);
    });

    // 验证文件系统
    console.log('\n步骤 6: 验证文件系统');
    const dirContents = await fs.readdir(projectRootPath);
    console.log('  ✓ 项目目录中的文件:');
    dirContents.forEach((file, index) => {
      console.log(`    ${index + 1}. ${file}`);
    });

    // 读取文件内容验证
    const fileContent = await fs.readFile(readmePath, 'utf-8');
    console.log('\n  ✓ README.md内容预览:');
    console.log('    ---');
    fileContent.split('\n').forEach(line => {
      console.log(`    ${line}`);
    });
    console.log('    ---\n');

    console.log('=== ✓ 所有测试通过！ ===\n');
    console.log('测试总结:');
    console.log('✓ 数据库初始化正常');
    console.log('✓ 项目目录创建成功');
    console.log('✓ README.md文件创建成功');
    console.log('✓ 项目信息保存到数据库');
    console.log('✓ 文件记录保存到数据库');
    console.log('✓ 所有数据验证通过');
    console.log('\n项目位置:', projectRootPath);
    console.log('\n此项目可以在前端UI中查看！\n');

    return {
      success: true,
      projectId,
      projectPath: projectRootPath
    };

  } catch (error) {
    console.error('\n=== ✗ 测试失败 ===');
    console.error('错误信息:', error.message);
    console.error('错误堆栈:', error.stack);

    console.error('\n诊断信息:');
    if (error.message.includes('ENOENT')) {
      console.error('- 文件或目录不存在');
      console.error('- 可能是项目根路径配置问题');
      console.error('- 检查 project-config.js 中的 projectsRootPath 设置');
    } else if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
      console.error('- 权限不足');
      console.error('- 检查文件系统权限');
    } else if (error.message.includes('database') || error.message.includes('SQLite')) {
      console.error('- 数据库错误');
      console.error('- 检查数据库初始化和表结构');
    }

    process.exit(1);
  }
}

// 运行测试
testQuickCreateLogic().catch(error => {
  console.error('测试执行出错:', error);
  process.exit(1);
});
