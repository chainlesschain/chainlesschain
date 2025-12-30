/**
 * 修复加密数据库中的模板 prompt_template 字段
 * 此脚本使用数据库适配器来处理加密数据库
 */

const path = require('path');
const fs = require('fs').promises;

async function fixEncryptedDatabaseTemplates() {
  console.log('=== 修复加密数据库中的模板问题 ===\n');

  try {
    // 1. 导入数据库模块
    const { createDatabaseAdapter } = require('./src/main/database/index');
    const app = require('electron').app || { getPath: () => require('os').tmpdir() };

    // 2. 确定数据库路径
    const dbPath = path.join(__dirname, 'data/test-password.encrypted.db');

    // 检查文件是否存在
    try {
      await fs.access(dbPath);
      console.log(`✓ 找到加密数据库: ${dbPath}\n`);
    } catch (e) {
      console.error('❌ 数据库文件不存在:', dbPath);
      return;
    }

    // 3. 提示输入密码
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const password = await new Promise((resolve) => {
      rl.question('请输入数据库密码: ', (answer) => {
        rl.close();
        resolve(answer);
      });
    });

    if (!password || password.trim() === '') {
      console.error('❌ 密码不能为空');
      return;
    }

    console.log('\n正在连接加密数据库...');

    // 4. 创建数据库适配器
    const adapter = await createDatabaseAdapter({
      dbPath: dbPath,
      encryptionEnabled: true,
      password: password.trim(),
      autoMigrate: false,
      configPath: path.join(__dirname, 'data/db-key-config.json')
    });

    const db = await adapter.createDatabase();
    console.log('✓ 数据库连接成功\n');

    // 5. 检查当前模板状态
    const checkStmt = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN prompt_template IS NULL OR prompt_template = '' THEN 1 ELSE 0 END) as missing
      FROM project_templates
      WHERE deleted = 0
    `);
    const stats = checkStmt.get();
    checkStmt.finalize();

    console.log(`数据库中共有 ${stats.total} 个模板`);
    console.log(`其中 ${stats.missing} 个模板的 prompt_template 为空\n`);

    if (stats.missing === 0) {
      console.log('✓ 所有模板都有 prompt_template，无需修复');
      db.close();
      return;
    }

    // 6. 从 JSON 文件重新加载模板
    console.log('开始从 JSON 文件重新加载模板...\n');

    const templatesDir = path.join(__dirname, 'src/main/templates');
    const categories = [
      'writing', 'ppt', 'excel', 'web', 'design', 'podcast',
      'resume', 'research', 'marketing', 'education', 'lifestyle', 'travel'
    ];

    let updatedCount = 0;
    let errorCount = 0;

    for (const category of categories) {
      const categoryPath = path.join(templatesDir, category);

      try {
        const files = await fs.readdir(categoryPath);

        for (const file of files) {
          if (file.endsWith('.json')) {
            try {
              const filePath = path.join(categoryPath, file);
              const content = await fs.readFile(filePath, 'utf8');
              const templateData = JSON.parse(content);

              // 验证模板数据
              if (!templateData.id) {
                console.warn(`⚠️  跳过 ${category}/${file}: 缺少 id 字段`);
                continue;
              }

              if (!templateData.prompt_template || templateData.prompt_template.trim() === '') {
                console.warn(`⚠️  跳过 ${category}/${file}: JSON 文件本身也缺少 prompt_template`);
                errorCount++;
                continue;
              }

              // 检查数据库中是否存在该模板
              const existsStmt = db.prepare('SELECT id FROM project_templates WHERE id = ?');
              const exists = existsStmt.get(templateData.id);
              existsStmt.finalize();

              if (exists) {
                // 更新现有模板
                const updateStmt = db.prepare(`
                  UPDATE project_templates
                  SET prompt_template = ?,
                      variables_schema = ?,
                      updated_at = ?
                  WHERE id = ?
                `);

                updateStmt.run(
                  templateData.prompt_template,
                  JSON.stringify(templateData.variables_schema || []),
                  Date.now(),
                  templateData.id
                );
                updateStmt.finalize();

                console.log(`✓ 更新模板: ${templateData.display_name || templateData.name} (${templateData.id})`);
                updatedCount++;
              } else {
                // 插入新模板
                const now = Date.now();
                const insertStmt = db.prepare(`
                  INSERT INTO project_templates (
                    id, name, display_name, description, icon, cover_image,
                    category, subcategory, tags,
                    project_type, prompt_template, variables_schema, file_structure, default_files,
                    is_builtin, author, version, usage_count, rating, rating_count,
                    created_at, updated_at, sync_status, deleted
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                insertStmt.run(
                  templateData.id,
                  templateData.name,
                  templateData.display_name,
                  templateData.description || '',
                  templateData.icon || '',
                  templateData.cover_image || '',
                  templateData.category,
                  templateData.subcategory || '',
                  JSON.stringify(templateData.tags || []),
                  templateData.project_type,
                  templateData.prompt_template,
                  JSON.stringify(templateData.variables_schema || []),
                  JSON.stringify(templateData.file_structure || {}),
                  JSON.stringify(templateData.default_files || []),
                  templateData.is_builtin ? 1 : 0,
                  templateData.author || '',
                  templateData.version || '1.0.0',
                  0,
                  0,
                  0,
                  now,
                  now,
                  'synced',
                  0
                );
                insertStmt.finalize();

                console.log(`✓ 插入新模板: ${templateData.display_name || templateData.name} (${templateData.id})`);
                updatedCount++;
              }

            } catch (err) {
              console.error(`❌ 处理模板失败 ${category}/${file}:`, err.message);
              errorCount++;
            }
          }
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`❌ 读取 ${category} 目录失败:`, err.message);
        }
      }
    }

    // 7. 关闭数据库（会自动保存）
    console.log('\n正在保存并关闭数据库...');
    db.close();

    // 8. 验证修复结果
    console.log('验证修复结果...\n');
    const adapter2 = await createDatabaseAdapter({
      dbPath: dbPath,
      encryptionEnabled: true,
      password: password.trim(),
      autoMigrate: false,
      configPath: path.join(__dirname, 'data/db-key-config.json')
    });
    const db2 = await adapter2.createDatabase();

    const verifyStmt = db2.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN prompt_template IS NULL OR prompt_template = '' THEN 1 ELSE 0 END) as missing
      FROM project_templates
      WHERE deleted = 0
    `);
    const finalStats = verifyStmt.get();
    verifyStmt.finalize();
    db2.close();

    // 9. 输出结果
    console.log('=== 修复完成 ===');
    console.log(`✓ 成功更新/插入 ${updatedCount} 个模板`);
    if (errorCount > 0) {
      console.log(`⚠️  ${errorCount} 个模板处理失败`);
    }
    console.log(`\n最终统计:`);
    console.log(`  - 总模板数: ${finalStats.total}`);
    console.log(`  - 缺失 prompt_template: ${finalStats.missing}`);

    if (finalStats.missing === 0) {
      console.log('\n🎉 所有模板都已正确加载 prompt_template！');
      console.log('\n下一步: 重新启动桌面应用即可使用修复后的模板');
    } else {
      console.log('\n⚠️  仍有模板缺失 prompt_template，请检查 JSON 文件或联系支持');
    }

  } catch (error) {
    console.error('\n❌ 修复失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行修复
fixEncryptedDatabaseTemplates().catch(error => {
  console.error('脚本执行失败:', error);
  process.exit(1);
});
