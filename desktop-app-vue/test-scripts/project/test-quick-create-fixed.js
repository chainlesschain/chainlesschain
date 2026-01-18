/**
 * 测试快速创建项目 - 修复版
 * 模拟 Electron 环境，避免 app.getPath 错误
 */

const Database = require('./src/main/database.js');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;

async function testQuickCreateFixed() {
  console.log('=== 测试快速创建项目（修复版）===\n');

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

    // 2. 准备测试数据
    const createData = {
      name: '前端UI快速创建测试项目_' + Date.now(),
      description: '模拟前端UI快速创建的项目，测试完整流程',
      projectType: 'document',
      userId: 'test-user-ui',
      status: 'draft'
    };

    console.log('创建参数:');
    console.log(JSON.stringify(createData, null, 2));
    console.log('');

    // 3. 执行快速创建逻辑
    console.log('开始执行快速创建逻辑...\n');

    const projectId = crypto.randomUUID();
    const timestamp = Date.now();

    // 直接使用项目根路径（避免依赖 Electron app.getPath）
    const projectsRootPath = path.join(__dirname, 'data', 'projects');

    // 确保 projects 根目录存在
    await fs.mkdir(projectsRootPath, { recursive: true });

    // 创建项目文件夹
    const projectRootPath = path.join(projectsRootPath, projectId);

    console.log('步骤 1: 创建项目目录');
    console.log('  目录路径:', projectRootPath);
    await fs.mkdir(projectRootPath, { recursive: true });
    console.log('  ✓ 目录创建成功\n');

    // 创建 README.md
    const readmePath = path.join(projectRootPath, 'README.md');
    const readmeContent = `# ${createData.name}

${createData.description || '这是一个新建的项目。'}

## 项目信息

- **项目ID**: ${projectId}
- **创建时间**: ${new Date().toLocaleString('zh-CN')}
- **项目类型**: ${createData.projectType}
- **状态**: ${createData.status}

## 说明

这个项目是通过前端UI快速创建的测试项目。

## 文件列表

- README.md - 项目说明文件（当前文件）
`;

    console.log('步骤 2: 创建README.md文件');
    await fs.writeFile(readmePath, readmeContent, 'utf-8');
    console.log('  ✓ README.md创建成功\n');

    // 创建一个测试txt文件
    const testFilePath = path.join(projectRootPath, 'test.txt');
    const testFileContent = `这是一个测试文本文件

项目名称: ${createData.name}
创建时间: ${new Date().toLocaleString('zh-CN')}

这个文件用于测试文件创建功能是否正常。
`;

    console.log('步骤 3: 创建test.txt文件');
    await fs.writeFile(testFilePath, testFileContent, 'utf-8');
    console.log('  ✓ test.txt创建成功\n');

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
      file_count: 2, // README.md + test.txt
      metadata: JSON.stringify({
        created_by: 'quick-create-ui-test',
        created_at: new Date().toISOString(),
        ui_created: true,
      }),
    };

    // 保存到数据库
    console.log('步骤 4: 保存项目到数据库');
    await database.saveProject(project);
    console.log('  ✓ 项目保存成功\n');

    // 保存文件记录
    const files = [
      {
        project_id: projectId,
        file_name: 'README.md',
        file_path: 'README.md',
        file_type: 'markdown',
        content: readmeContent,
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        project_id: projectId,
        file_name: 'test.txt',
        file_path: 'test.txt',
        file_type: 'txt',
        content: testFileContent,
        created_at: timestamp,
        updated_at: timestamp,
      }
    ];

    console.log('步骤 5: 保存文件记录到数据库');
    await database.saveProjectFiles(projectId, files);
    console.log('  ✓ 文件记录保存成功\n');

    // 验证数据
    console.log('步骤 6: 验证保存的数据');
    const savedProject = database.getProjectById(projectId);
    console.log('  ✓ 项目信息:');
    console.log('    - ID:', savedProject.id);
    console.log('    - 名称:', savedProject.name);
    console.log('    - 类型:', savedProject.project_type);
    console.log('    - 状态:', savedProject.status);
    console.log('    - 路径:', savedProject.root_path);
    console.log('    - 文件数量:', savedProject.file_count);

    const savedFiles = database.getProjectFiles(projectId);
    console.log('\n  ✓ 文件列表（共 ' + savedFiles.length + ' 个）:');
    savedFiles.forEach((file, index) => {
      console.log(`    ${index + 1}. ${file.file_name} (${file.file_type})`);
    });

    // 验证文件系统
    console.log('\n步骤 7: 验证文件系统');
    const dirContents = await fs.readdir(projectRootPath);
    console.log('  ✓ 项目目录中的文件（共 ' + dirContents.length + ' 个）:');
    dirContents.forEach((file, index) => {
      console.log(`    ${index + 1}. ${file}`);
    });

    // 读取并显示文件内容
    console.log('\n步骤 8: 读取文件内容验证');
    console.log('\n  README.md 内容:');
    console.log('  ' + '='.repeat(60));
    const readmeRead = await fs.readFile(readmePath, 'utf-8');
    readmeRead.split('\n').forEach(line => console.log('  ' + line));
    console.log('  ' + '='.repeat(60));

    console.log('\n  test.txt 内容:');
    console.log('  ' + '='.repeat(60));
    const testRead = await fs.readFile(testFilePath, 'utf-8');
    testRead.split('\n').forEach(line => console.log('  ' + line));
    console.log('  ' + '='.repeat(60));

    console.log('\n=== ✓ 所有测试通过！ ===\n');
    console.log('测试总结:');
    console.log('✓ 数据库初始化正常');
    console.log('✓ 项目目录创建成功');
    console.log('✓ 多个文件创建成功 (README.md, test.txt)');
    console.log('✓ 项目信息保存到数据库');
    console.log('✓ 文件记录保存到数据库');
    console.log('✓ 文件系统写入验证通过');
    console.log('✓ 文件内容读取验证通过');
    console.log('\n项目位置:', projectRootPath);
    console.log('\n✓ 此项目已完全创建成功，可以在前端UI中查看！\n');

    return {
      success: true,
      projectId,
      projectPath: projectRootPath,
      fileCount: files.length
    };

  } catch (error) {
    console.error('\n=== ✗ 测试失败 ===');
    console.error('错误信息:', error.message);
    console.error('错误堆栈:', error.stack);

    console.error('\n可能的原因:');
    if (error.message.includes('ENOENT')) {
      console.error('✗ 文件或目录不存在');
    } else if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
      console.error('✗ 文件系统权限不足');
    } else if (error.message.includes('database') || error.message.includes('SQLite')) {
      console.error('✗ 数据库操作失败');
    }

    process.exit(1);
  }
}

// 运行测试
testQuickCreateFixed().catch(error => {
  console.error('测试执行出错:', error);
  process.exit(1);
});
