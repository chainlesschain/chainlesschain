#!/usr/bin/env node

/**
 * SQL 注入批量修复工具
 *
 * 自动修复常见的 SQL 注入模式
 */

const fs = require('fs');
const path = require('path');

class BatchSQLFixer {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.join(__dirname, '..');
    this.srcDir = path.join(this.rootDir, 'src');
    this.dryRun = options.dryRun !== false;
    this.fixedFiles = [];
    this.errors = [];
    this.stats = {
      filesScanned: 0,
      filesFixed: 0,
      issuesFixed: 0
    };
  }

  async fix() {
    console.log('🔧 SQL 注入批量修复工具');
    console.log(`模式: ${this.dryRun ? 'DRY RUN（预览）' : 'LIVE（实际修复）'}\n`);

    const jsFiles = this.getAllFiles(this.srcDir, '.js');
    console.log(`📁 找到 ${jsFiles.length} 个 JS 文件\n`);

    for (const file of jsFiles) {
      await this.fixFile(file);
    }

    this.printSummary();
    return this.stats.issuesFixed > 0 ? 0 : 1;
  }

  async fixFile(filePath) {
    try {
      this.stats.filesScanned++;

      const content = fs.readFileSync(filePath, 'utf-8');
      let modified = content;
      let fileChanges = 0;

      // 修复模式: db.exec('SELECT ...', [params])
      const pattern1 = /(\w+)\.exec\s*\(\s*(['"`])([^'"`]*SELECT[^'"`]*)(['"`])\s*,\s*(\[.*?\])\s*\)/gi;
      modified = modified.replace(pattern1, (match, dbVar, q1, sql, q2, params) => {
        if (match.trim().startsWith('//')) return match;
        fileChanges++;
        if (sql.includes('LIMIT 1')) {
          return `${dbVar}.prepare(${q1}${sql}${q2}).get(${params})`;
        }
        return `${dbVar}.prepare(${q1}${sql}${q2}).all(${params})`;
      });

      // 修复模式: db.exec('INSERT/UPDATE/DELETE ...', [params])
      const pattern2 = /(\w+)\.exec\s*\(\s*(['"`])([^'"`]*(?:INSERT|UPDATE|DELETE)[^'"`]*)(['"`])\s*,\s*(\[.*?\])\s*\)/gi;
      modified = modified.replace(pattern2, (match, dbVar, q1, sql, q2, params) => {
        if (match.trim().startsWith('//')) return match;
        fileChanges++;
        return `${dbVar}.prepare(${q1}${sql}${q2}).run(${params})`;
      });

      if (fileChanges > 0) {
        const relativePath = path.relative(this.rootDir, filePath);
        console.log(`✏️  ${relativePath}: ${fileChanges} 处修改`);

        this.stats.filesFixed++;
        this.stats.issuesFixed += fileChanges;

        if (!this.dryRun) {
          fs.writeFileSync(filePath + '.bak', content);
          fs.writeFileSync(filePath, modified);
          this.fixedFiles.push({ path: relativePath, changes: fileChanges });
        }
      }
    } catch (error) {
      this.errors.push({ file: path.relative(this.rootDir, filePath), error: error.message });
    }
  }

  getAllFiles(dir, ext) {
    const files = [];
    if (!fs.existsSync(dir)) return files;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (['node_modules', '.git', 'dist', 'out'].includes(entry.name)) continue;
      
      if (entry.isDirectory()) {
        files.push(...this.getAllFiles(fullPath, ext));
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  printSummary() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 批量修复总结');
    console.log('='.repeat(80));
    console.log(`📁 扫描文件: ${this.stats.filesScanned}`);
    console.log(`✅ 修复文件: ${this.stats.filesFixed}`);
    console.log(`🔧 修复问题: ${this.stats.issuesFixed}`);

    if (this.dryRun) {
      console.log('\n💡 这是预览模式，没有实际修改文件');
      console.log('   运行 `node scripts/batch-fix-sql-injection.js --apply` 执行修复');
    } else if (this.fixedFiles.length > 0) {
      console.log('\n✅ 文件已修复！备份保存为 .bak 文件');
      console.log('\n⚠️  重要提示:');
      console.log('  1. 运行测试: npm run test:db');
      console.log('  2. 手动检查复杂的 SQL 语句');
      console.log('  3. 运行验证器: npm run validate:rules');
    }
    console.log('='.repeat(80) + '\n');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const fixer = new BatchSQLFixer({ dryRun });
  await fixer.fix();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ 批量修复工具运行失败:', error);
    process.exit(1);
  });
}

module.exports = BatchSQLFixer;
