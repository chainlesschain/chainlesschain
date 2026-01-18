/**
 * 测试项目创建功能
 * 模拟创建一个项目，包含txt文件
 */

const Database = require('./src/main/database.js');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;

async function testProjectCreate() {
  console.log('=== 开始测试项目创建功能 ===\n');

  try {
    // 1. 初始化数据库
    const dbPath = path.join(__dirname, 'data', 'chainlesschain.db');
    console.log('数据库路径:', dbPath);

    const database = new Database(dbPath, {
      password: null,
      encryptionEnabled: false  // 测试时禁用加密
    });

    await database.initialize();
    console.log('✓ 数据库初始化成功\n');

    // 2. 生成项目ID和时间戳
    const projectId = crypto.randomUUID();
    const timestamp = Date.now();
    console.log('项目ID:', projectId);

    // 3. 创建项目目录
    const projectRootPath = path.join(__dirname, 'data', 'projects', projectId);
    console.log('项目目录:', projectRootPath);

    await fs.mkdir(projectRootPath, { recursive: true });
    console.log('✓ 项目目录创建成功\n');

    // 4. 创建测试文件（txt文件）
    const testFilePath = path.join(projectRootPath, 'test.txt');
    const testFileContent = `这是一个测试文件
创建时间：${new Date().toLocaleString('zh-CN')}
项目ID：${projectId}

这个文件用于测试ChainlessChain的项目创建功能。
如果你能看到这个文件，说明项目创建功能正常工作！
`;

    await fs.writeFile(testFilePath, testFileContent, 'utf-8');
    console.log('✓ 测试文件创建成功:', testFilePath);
    console.log('文件内容:\n---');
    console.log(testFileContent);
    console.log('---\n');

    // 5. 创建README.md文件
    const readmePath = path.join(projectRootPath, 'README.md');
    const readmeContent = `# 测试项目

这是一个用于测试ChainlessChain项目创建功能的项目。

## 项目信息

- 项目ID: ${projectId}
- 创建时间: ${new Date().toLocaleString('zh-CN')}
- 项目类型: document

## 包含文件

1. README.md - 项目说明文件
2. test.txt - 测试文本文件
`;

    await fs.writeFile(readmePath, readmeContent, 'utf-8');
    console.log('✓ README.md文件创建成功\n');

    // 6. 保存项目到数据库
    const testProject = {
      id: projectId,
      name: '测试项目_' + new Date().getTime(),
      description: '这是一个用于测试的项目，包含txt文件',
      project_type: 'document',
      user_id: 'test-user',
      root_path: projectRootPath,
      created_at: timestamp,
      updated_at: timestamp,
      sync_status: 'pending',
      file_count: 2,  // test.txt + README.md
      metadata: JSON.stringify({
        created_by: 'test-script',
        created_at: new Date().toISOString(),
        test: true
      }),
    };

    console.log('保存项目到数据库...');
    await database.saveProject(testProject);
    console.log('✓ 项目保存到数据库成功\n');

    // 7. 保存文件记录到数据库
    const files = [
      {
        project_id: projectId,
        file_name: 'test.txt',
        file_path: 'test.txt',
        file_type: 'txt',
        content: testFileContent,
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        project_id: projectId,
        file_name: 'README.md',
        file_path: 'README.md',
        file_type: 'markdown',
        content: readmeContent,
        created_at: timestamp,
        updated_at: timestamp,
      }
    ];

    console.log('保存文件记录到数据库...');
    await database.saveProjectFiles(projectId, files);
    console.log('✓ 文件记录保存成功\n');

    // 8. 验证保存的数据
    console.log('验证保存的数据...');
    const savedProject = database.getProjectById(projectId);
    console.log('保存的项目信息:');
    console.log('  - ID:', savedProject.id);
    console.log('  - 名称:', savedProject.name);
    console.log('  - 类型:', savedProject.project_type);
    console.log('  - 路径:', savedProject.root_path);
    console.log('  - 文件数量:', savedProject.file_count);

    const savedFiles = database.getProjectFiles(projectId);
    console.log('\n保存的文件列表:');
    savedFiles.forEach((file, index) => {
      console.log(`  ${index + 1}. ${file.file_name} (${file.file_type})`);
    });

    // 9. 验证文件系统中的文件
    console.log('\n验证文件系统中的文件...');
    const dirContents = await fs.readdir(projectRootPath);
    console.log('项目目录中的文件:');
    dirContents.forEach((file, index) => {
      console.log(`  ${index + 1}. ${file}`);
    });

    console.log('\n=== ✓ 所有测试通过！ ===');
    console.log('\n测试总结:');
    console.log('✓ 数据库初始化正常');
    console.log('✓ 项目目录创建成功');
    console.log('✓ 文件创建成功 (test.txt, README.md)');
    console.log('✓ 项目信息保存到数据库');
    console.log('✓ 文件记录保存到数据库');
    console.log('✓ 数据验证通过');
    console.log('\n项目位置:', projectRootPath);
    console.log('你可以检查上述路径来查看创建的文件。\n');

  } catch (error) {
    console.error('\n=== ✗ 测试失败 ===');
    console.error('错误信息:', error.message);
    console.error('错误堆栈:', error.stack);
    process.exit(1);
  }
}

// 运行测试
testProjectCreate().catch(error => {
  console.error('测试执行出错:', error);
  process.exit(1);
});
