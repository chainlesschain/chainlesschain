/**
 * 自动修复运行器
 * 分析测试失败原因并尝试自动修复
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class AutoFixRunner {
  constructor() {
    this.fixStrategies = this.initFixStrategies();
    this.fixAttempts = [];
  }

  /**
   * 初始化修复策略
   */
  initFixStrategies() {
    return {
      // 依赖问题
      DEPENDENCY_ERROR: async (error) => {
        console.log('[Auto-Fix] Attempting to fix dependency issues...');
        try {
          await execPromise('npm install');
          return { success: true, message: 'Dependencies reinstalled' };
        } catch (e) {
          return { success: false, message: e.message };
        }
      },

      // 类型错误
      TYPE_ERROR: async (error) => {
        console.log('[Auto-Fix] Running TypeScript compilation...');
        try {
          await execPromise('npm run build:main');
          return { success: true, message: 'TypeScript compiled successfully' };
        } catch (e) {
          return { success: false, message: e.message };
        }
      },

      // 数据库锁定
      DATABASE_LOCKED: async (error) => {
        console.log('[Auto-Fix] Attempting to unlock database...');
        try {
          // 删除临时数据库文件
          const dbPath = path.join(process.cwd(), '../data/chainlesschain.db');
          const walPath = dbPath + '-wal';
          const shmPath = dbPath + '-shm';

          try {
            await fs.access(walPath);
            await fs.unlink(walPath);
            console.log('  Removed WAL file');
          } catch (e) {
            // WAL file may not exist
          }

          try {
            await fs.access(shmPath);
            await fs.unlink(shmPath);
            console.log('  Removed SHM file');
          } catch (e) {
            // SHM file may not exist
          }

          return { success: true, message: 'Database lock files removed' };
        } catch (e) {
          return { success: false, message: e.message };
        }
      },

      // 端口占用
      PORT_IN_USE: async (error) => {
        console.log('[Auto-Fix] Attempting to free up ports...');
        try {
          const ports = [5173, 11434, 6333, 5432, 6379];

          for (const port of ports) {
            try {
              if (process.platform === 'win32') {
                const { stdout } = await execPromise(`netstat -ano | findstr :${port}`);
                if (stdout) {
                  console.log(`  Port ${port} is in use, attempting to kill process...`);
                  // Extract PID and kill
                  const lines = stdout.split('\n');
                  for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && !isNaN(pid)) {
                      await execPromise(`taskkill /F /PID ${pid}`);
                    }
                  }
                }
              } else {
                await execPromise(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`);
              }
            } catch (e) {
              // Port may not be in use
            }
          }

          return { success: true, message: 'Ports freed' };
        } catch (e) {
          return { success: false, message: e.message };
        }
      },

      // 缺少环境变量
      MISSING_ENV_VAR: async (error) => {
        console.log('[Auto-Fix] Checking environment variables...');
        try {
          const envExample = path.join(process.cwd(), '../.env.example');
          const envFile = path.join(process.cwd(), '../.env');

          // 如果.env不存在,从.env.example复制
          try {
            await fs.access(envFile);
          } catch (e) {
            const content = await fs.readFile(envExample, 'utf-8');
            await fs.writeFile(envFile, content);
            return { success: true, message: '.env file created from example' };
          }

          return { success: true, message: '.env file exists' };
        } catch (e) {
          return { success: false, message: e.message };
        }
      },

      // Docker服务未运行
      DOCKER_NOT_RUNNING: async (error) => {
        console.log('[Auto-Fix] Attempting to start Docker services...');
        try {
          await execPromise('docker-compose up -d', {
            cwd: path.join(process.cwd(), '..')
          });

          // 等待服务启动
          await this.sleep(10000);

          return { success: true, message: 'Docker services started' };
        } catch (e) {
          return { success: false, message: e.message };
        }
      },

      // ESLint错误
      LINT_ERROR: async (error) => {
        console.log('[Auto-Fix] Attempting to fix linting errors...');
        try {
          await execPromise('npm run lint -- --fix');
          return { success: true, message: 'Linting errors fixed' };
        } catch (e) {
          return { success: false, message: e.message };
        }
      },

      // 缓存问题
      CACHE_ERROR: async (error) => {
        console.log('[Auto-Fix] Clearing caches...');
        try {
          // 清除npm缓存
          await execPromise('npm cache clean --force');

          // 清除node_modules
          const nodeModules = path.join(process.cwd(), 'node_modules');
          try {
            await fs.rm(nodeModules, { recursive: true, force: true });
            await execPromise('npm install');
          } catch (e) {
            console.log('  Could not remove node_modules:', e.message);
          }

          return { success: true, message: 'Caches cleared' };
        } catch (e) {
          return { success: false, message: e.message };
        }
      }
    };
  }

  /**
   * 分析测试失败
   */
  async analyzeFailures() {
    console.log('\n[Auto-Fix] Analyzing test failures...\n');

    try {
      // 读取测试报告
      const reportPath = path.join(process.cwd(), 'test-results/test-report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));

      const failures = Object.values(report.results)
        .filter(r => r && !r.passed);

      if (failures.length === 0) {
        console.log('No failures found.');
        return [];
      }

      console.log(`Found ${failures.length} failed test suite(s):`);
      failures.forEach(f => {
        console.log(`  - ${f.name}: ${f.error || 'Unknown error'}`);
      });

      return failures;
    } catch (error) {
      console.log('Could not read test report:', error.message);
      return [];
    }
  }

  /**
   * 识别错误类型
   */
  identifyErrorType(failure) {
    const errorText = (failure.error || '').toLowerCase();

    if (errorText.includes('cannot find module') || errorText.includes('module not found')) {
      return 'DEPENDENCY_ERROR';
    }
    if (errorText.includes('type error') || errorText.includes('typescript')) {
      return 'TYPE_ERROR';
    }
    if (errorText.includes('sqlite_busy') || errorText.includes('database is locked')) {
      return 'DATABASE_LOCKED';
    }
    if (errorText.includes('eaddrinuse') || errorText.includes('address already in use')) {
      return 'PORT_IN_USE';
    }
    if (errorText.includes('missing env') || errorText.includes('undefined env')) {
      return 'MISSING_ENV_VAR';
    }
    if (errorText.includes('docker') || errorText.includes('econnrefused')) {
      return 'DOCKER_NOT_RUNNING';
    }
    if (errorText.includes('eslint') || errorText.includes('lint')) {
      return 'LINT_ERROR';
    }
    if (errorText.includes('cache') || errorText.includes('eintegrity')) {
      return 'CACHE_ERROR';
    }

    return 'UNKNOWN';
  }

  /**
   * 尝试修复
   */
  async attemptFix(failure) {
    const errorType = this.identifyErrorType(failure);

    console.log(`\n[Auto-Fix] Identified error type: ${errorType}`);

    if (errorType === 'UNKNOWN') {
      console.log('[Auto-Fix] No automatic fix available for this error type.');
      return { success: false, message: 'Unknown error type' };
    }

    const fixStrategy = this.fixStrategies[errorType];
    if (!fixStrategy) {
      return { success: false, message: 'No fix strategy found' };
    }

    try {
      const result = await fixStrategy(failure);
      this.fixAttempts.push({
        failure: failure.name,
        errorType,
        result,
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * 运行自动修复
   */
  async run() {
    console.log('\n' + '█'.repeat(60));
    console.log('自动修复运行器');
    console.log('█'.repeat(60));

    const failures = await this.analyzeFailures();

    if (failures.length === 0) {
      console.log('\n✓ No failures to fix.\n');
      return;
    }

    console.log(`\n[Auto-Fix] Attempting to fix ${failures.length} failure(s)...\n`);

    let successCount = 0;
    let failCount = 0;

    for (const failure of failures) {
      console.log(`[Auto-Fix] Fixing: ${failure.name}...`);
      const result = await this.attemptFix(failure);

      if (result.success) {
        console.log(`✓ Successfully fixed: ${result.message}`);
        successCount++;
      } else {
        console.log(`✗ Failed to fix: ${result.message}`);
        failCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Auto-Fix Summary');
    console.log('='.repeat(60));
    console.log(`Total fixes attempted: ${failures.length}`);
    console.log(`Successful: ${successCount} ✓`);
    console.log(`Failed: ${failCount} ✗`);
    console.log('='.repeat(60) + '\n');

    // 保存修复报告
    await this.saveReport();

    // 如果有成功的修复,建议重新运行测试
    if (successCount > 0) {
      console.log('💡 Some issues were fixed. Please run tests again:\n');
      console.log('   npm run test:all\n');
    }
  }

  /**
   * 保存修复报告
   */
  async saveReport() {
    try {
      const reportPath = path.join(process.cwd(), 'test-results');
      await fs.mkdir(reportPath, { recursive: true });

      const report = {
        timestamp: new Date().toISOString(),
        attempts: this.fixAttempts,
        summary: {
          total: this.fixAttempts.length,
          successful: this.fixAttempts.filter(a => a.result.success).length,
          failed: this.fixAttempts.filter(a => !a.result.success).length
        }
      };

      const reportFile = path.join(reportPath, 'auto-fix-report.json');
      await fs.writeFile(reportFile, JSON.stringify(report, null, 2));

      console.log(`[Auto-Fix] Report saved to: ${reportFile}`);
    } catch (error) {
      console.error('Failed to save auto-fix report:', error);
    }
  }

  /**
   * 工具函数: 睡眠
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 主函数
async function main() {
  const fixer = new AutoFixRunner();
  await fixer.run();
}

// 运行
if (require.main === module) {
  main().catch(error => {
    console.error('Auto-fix runner failed:', error);
    process.exit(1);
  });
}

module.exports = AutoFixRunner;
