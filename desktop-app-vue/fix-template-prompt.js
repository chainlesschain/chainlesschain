/**
 * 修复模板 prompt_template 字段为空的问题
 *
 * 问题原因：修改数据库密码后，模板数据可能没有正确迁移，导致 prompt_template 字段为空
 * 解决方案：强制重新从 JSON 文件加载所有模板到数据库
 */

const path = require('path');
const fs = require('fs').promises;

async function fixTemplatePrompt() {
  console.log('=== 开始修复模板 prompt_template 问题 ===\n');

  try {
    // 动态导入 sql.js
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();

    // 1. 确定数据库路径
    const possibleDbPaths = [
      path.join(__dirname, 'data/chainlesschain.db'),
      path.join(__dirname, 'data/test-password.encrypted.db')
    ];

    let dbPath = null;
    for (const p of possibleDbPaths) {
      try {
        await fs.access(p);
        dbPath = p;
        console.log(`✓ 找到数据库文件: ${dbPath}`);
        break;
      } catch (e) {
        // 文件不存在，继续尝试下一个
      }
    }

    if (!dbPath) {
      console.error('❌ 未找到数据库文件，请先运行应用初始化数据库');
      console.log('\n可能的解决方案：');
      console.log('1. 启动桌面应用，让系统自动创建数据库');
      console.log('2. 或删除 test-password.encrypted.db，使用默认数据库');
      return;
    }

    // 2. 打开数据库
    console.log('\n正在打开数据库...');
    const buffer = await fs.readFile(dbPath);
    const db = new SQL.Database(buffer);

    // 3. 检查当前模板状态
    const checkStmt = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN prompt_template IS NULL OR prompt_template = '' THEN 1 ELSE 0 END) as missing
      FROM project_templates
      WHERE deleted = 0
    `);
    const stats = checkStmt.getAsObject();
    checkStmt.free();

    console.log(`数据库中共有 ${stats.total} 个模板`);
    console.log(`其中 ${stats.missing} 个模板的 prompt_template 为空\n`);

    if (stats.missing === 0) {
      console.log('✓ 所有模板都有 prompt_template，无需修复');
      db.close();
      return;
    }

    // 4. 从 JSON 文件重新加载模板
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
                continue;
              }

              // 检查数据库中是否存在该模板
              const existsStmt = db.prepare('SELECT id FROM project_templates WHERE id = ?');
              const exists = existsStmt.getAsObject([templateData.id]);
              existsStmt.free();

              if (exists.id) {
                // 更新现有模板
                const updateStmt = db.prepare(`
                  UPDATE project_templates
                  SET prompt_template = ?,
                      variables_schema = ?,
                      updated_at = ?
                  WHERE id = ?
                `);

                updateStmt.run([
                  templateData.prompt_template,
                  JSON.stringify(templateData.variables_schema || []),
                  Date.now(),
                  templateData.id
                ]);
                updateStmt.free();

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

                insertStmt.run([
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
                  templateData.usage_count || 0,
                  templateData.rating || 0,
                  templateData.rating_count || 0,
                  now,
                  now,
                  'synced',
                  0
                ]);
                insertStmt.free();

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

    // 5. 保存数据库
    console.log('\n正在保存数据库...');
    const data = db.export();
    await fs.writeFile(dbPath, Buffer.from(data));
    db.close();

    // 6. 验证修复结果
    console.log('\n验证修复结果...');
    const buffer2 = await fs.readFile(dbPath);
    const db2 = new SQL.Database(buffer2);

    const verifyStmt = db2.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN prompt_template IS NULL OR prompt_template = '' THEN 1 ELSE 0 END) as missing
      FROM project_templates
      WHERE deleted = 0
    `);
    const finalStats = verifyStmt.getAsObject();
    verifyStmt.free();
    db2.close();

    // 7. 输出结果
    console.log('\n=== 修复完成 ===');
    console.log(`✓ 成功更新/插入 ${updatedCount} 个模板`);
    if (errorCount > 0) {
      console.log(`⚠️  ${errorCount} 个模板处理失败`);
    }
    console.log(`\n最终统计:`);
    console.log(`  - 总模板数: ${finalStats.total}`);
    console.log(`  - 缺失 prompt_template: ${finalStats.missing}`);

    if (finalStats.missing === 0) {
      console.log('\n🎉 所有模板都已正确加载 prompt_template！');
    } else {
      console.log('\n⚠️  仍有模板缺失 prompt_template，可能需要手动检查 JSON 文件');
    }

  } catch (error) {
    console.error('\n❌ 修复失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行修复
fixTemplatePrompt().catch(error => {
  console.error('脚本执行失败:', error);
  process.exit(1);
});
