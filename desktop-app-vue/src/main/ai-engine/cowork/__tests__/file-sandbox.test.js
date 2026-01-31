/**
 * FileSandbox 单元测试
 */

const { FileSandbox, Permission } = require('../file-sandbox');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

describe('FileSandbox', () => {
  let sandbox;
  let testDir;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), 'file-sandbox-test-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });

    sandbox = new FileSandbox({
      strictMode: true,
      auditEnabled: true,
    });
  });

  afterEach(async () => {
    // 清理测试目录
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }

    sandbox.reset();
  });

  // ==========================================
  // grantAccess 测试
  // ==========================================

  describe('grantAccess', () => {
    test('应该成功授予访问权限', async () => {
      await sandbox.grantAccess('team-1', testDir, [Permission.READ, Permission.WRITE]);

      const paths = sandbox.getAllowedPaths('team-1');
      expect(paths.length).toBe(1);
      expect(paths[0].path).toBe(testDir);
      expect(paths[0].permissions).toContain(Permission.READ);
      expect(paths[0].permissions).toContain(Permission.WRITE);
    });

    test('应该限制最大路径数', async () => {
      const smallSandbox = new FileSandbox({ maxAllowedPaths: 2 });

      await smallSandbox.grantAccess('team-1', '/path/1', [Permission.READ]);
      await smallSandbox.grantAccess('team-1', '/path/2', [Permission.READ]);

      await expect(
        smallSandbox.grantAccess('team-1', '/path/3', [Permission.READ])
      ).rejects.toThrow('已达到最大允许路径数限制');
    });
  });

  // ==========================================
  // revokeAccess 测试
  // ==========================================

  describe('revokeAccess', () => {
    test('应该成功撤销访问权限', async () => {
      await sandbox.grantAccess('team-1', testDir, [Permission.READ]);
      expect(sandbox.hasPermission('team-1', testDir, Permission.READ)).toBe(true);

      await sandbox.revokeAccess('team-1', testDir);
      expect(sandbox.hasPermission('team-1', testDir, Permission.READ)).toBe(false);
    });
  });

  // ==========================================
  // hasPermission 测试
  // ==========================================

  describe('hasPermission', () => {
    beforeEach(async () => {
      await sandbox.grantAccess('team-1', testDir, [Permission.READ, Permission.WRITE]);
    });

    test('应该检查权限', () => {
      expect(sandbox.hasPermission('team-1', testDir, Permission.READ)).toBe(true);
      expect(sandbox.hasPermission('team-1', testDir, Permission.WRITE)).toBe(true);
      expect(sandbox.hasPermission('team-1', testDir, Permission.EXECUTE)).toBe(false);
    });

    test('应该检查子路径权限', () => {
      const subPath = path.join(testDir, 'subdir', 'file.txt');
      expect(sandbox.hasPermission('team-1', subPath, Permission.READ)).toBe(true);
    });

    test('应该拒绝未授权的团队', () => {
      expect(sandbox.hasPermission('team-2', testDir, Permission.READ)).toBe(false);
    });
  });

  // ==========================================
  // checkPathSafety 测试
  // ==========================================

  describe('checkPathSafety', () => {
    test('应该检测路径遍历攻击', () => {
      const dangerousPath = path.join(testDir, '..', '..', 'etc', 'passwd');
      const result = sandbox.checkPathSafety(dangerousPath);

      expect(result.safe).toBe(false);
      expect(result.reason).toBe('path_traversal');
    });

    test('应该检测敏感文件', () => {
      const envPath = path.join(testDir, '.env');
      const result = sandbox.checkPathSafety(envPath);

      expect(result.safe).toBe(false);
      expect(result.reason).toBe('sensitive_file');
    });

    test('应该允许安全路径', () => {
      const safePath = path.join(testDir, 'data.json');
      const result = sandbox.checkPathSafety(safePath);

      expect(result.safe).toBe(true);
    });
  });

  // ==========================================
  // isSensitivePath 测试
  // ==========================================

  describe('isSensitivePath', () => {
    test('应该检测 .env 文件', () => {
      expect(sandbox.isSensitivePath('/path/.env')).toBe(true);
      expect(sandbox.isSensitivePath('/path/.env.local')).toBe(true);
      expect(sandbox.isSensitivePath('/path/.env.production')).toBe(true);
    });

    test('应该检测凭证文件', () => {
      expect(sandbox.isSensitivePath('/path/credentials.json')).toBe(true);
      expect(sandbox.isSensitivePath('/path/secrets.json')).toBe(true);
    });

    test('应该检测 SSH 密钥', () => {
      expect(sandbox.isSensitivePath('/home/user/.ssh/id_rsa')).toBe(true);
      expect(sandbox.isSensitivePath('/.ssh/config')).toBe(true);
    });

    test('应该检测证书文件', () => {
      expect(sandbox.isSensitivePath('/path/cert.pem')).toBe(true);
      expect(sandbox.isSensitivePath('/path/private.key')).toBe(true);
    });

    test('应该允许普通文件', () => {
      expect(sandbox.isSensitivePath('/path/data.json')).toBe(false);
      expect(sandbox.isSensitivePath('/path/readme.md')).toBe(false);
    });
  });

  // ==========================================
  // validateAccess 测试
  // ==========================================

  describe('validateAccess', () => {
    beforeEach(async () => {
      await sandbox.grantAccess('team-1', testDir, [Permission.READ, Permission.WRITE]);
    });

    test('应该验证合法访问', async () => {
      const filePath = path.join(testDir, 'test.txt');
      const result = await sandbox.validateAccess('team-1', filePath, Permission.READ);

      expect(result.allowed).toBe(true);
    });

    test('应该拒绝不安全的路径', async () => {
      const dangerousPath = path.join(testDir, '..', 'dangerous.txt');
      const result = await sandbox.validateAccess('team-1', dangerousPath, Permission.READ);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('path_traversal');
    });

    test('应该拒绝权限不足', async () => {
      const filePath = path.join(testDir, 'test.txt');
      const result = await sandbox.validateAccess('team-1', filePath, Permission.EXECUTE);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('insufficient_permission');
    });

    test('应该拒绝敏感文件', async () => {
      const envPath = path.join(testDir, '.env');
      const result = await sandbox.validateAccess('team-1', envPath, Permission.READ);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('sensitive_file');
    });
  });

  // ==========================================
  // readFile 测试
  // ==========================================

  describe('readFile', () => {
    let testFilePath;

    beforeEach(async () => {
      testFilePath = path.join(testDir, 'test.txt');
      await fs.writeFile(testFilePath, 'Hello Cowork!', 'utf-8');
      await sandbox.grantAccess('team-1', testDir, [Permission.READ]);
    });

    test('应该成功读取文件', async () => {
      const content = await sandbox.readFile('team-1', 'agent-1', testFilePath);

      expect(content).toBe('Hello Cowork!');
    });

    test('应该拒绝未授权的读取', async () => {
      await expect(
        sandbox.readFile('team-2', 'agent-1', testFilePath)
      ).rejects.toThrow('文件访问被拒绝');
    });

    test('应该记录审计日志', async () => {
      await sandbox.readFile('team-1', 'agent-1', testFilePath);

      const logs = sandbox.getAuditLog({ teamId: 'team-1', operation: 'read' });
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].operation).toBe('read');
      expect(logs[0].success).toBe(1);
    });
  });

  // ==========================================
  // writeFile 测试
  // ==========================================

  describe('writeFile', () => {
    let testFilePath;

    beforeEach(async () => {
      testFilePath = path.join(testDir, 'output.txt');
      await sandbox.grantAccess('team-1', testDir, [Permission.WRITE]);
    });

    test('应该成功写入文件', async () => {
      await sandbox.writeFile('team-1', 'agent-1', testFilePath, 'Test content');

      const content = await fs.readFile(testFilePath, 'utf-8');
      expect(content).toBe('Test content');
    });

    test('应该拒绝未授权的写入', async () => {
      await expect(
        sandbox.writeFile('team-2', 'agent-1', testFilePath, 'content')
      ).rejects.toThrow('文件写入被拒绝');
    });

    test('应该拒绝写入敏感文件', async () => {
      const envPath = path.join(testDir, '.env');

      await expect(
        sandbox.writeFile('team-1', 'agent-1', envPath, 'SECRET=123')
      ).rejects.toThrow('文件写入被拒绝');
    });
  });

  // ==========================================
  // deleteFile 测试
  // ==========================================

  describe('deleteFile', () => {
    let testFilePath;

    beforeEach(async () => {
      testFilePath = path.join(testDir, 'delete-me.txt');
      await fs.writeFile(testFilePath, 'To be deleted', 'utf-8');
      await sandbox.grantAccess('team-1', testDir, [Permission.WRITE]);
    });

    test('应该成功删除文件', async () => {
      await sandbox.deleteFile('team-1', 'agent-1', testFilePath);

      await expect(fs.access(testFilePath)).rejects.toThrow();
    });

    test('应该拒绝删除敏感文件', async () => {
      const envPath = path.join(testDir, '.env');
      await fs.writeFile(envPath, 'SECRET=123', 'utf-8');

      await expect(
        sandbox.deleteFile('team-1', 'agent-1', envPath)
      ).rejects.toThrow('禁止删除敏感文件');
    });
  });

  // ==========================================
  // listDirectory 测试
  // ==========================================

  describe('listDirectory', () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(testDir, 'file1.txt'), 'content1', 'utf-8');
      await fs.writeFile(path.join(testDir, 'file2.txt'), 'content2', 'utf-8');
      await fs.writeFile(path.join(testDir, '.env'), 'SECRET=123', 'utf-8'); // 敏感文件
      await fs.mkdir(path.join(testDir, 'subdir'));
      await sandbox.grantAccess('team-1', testDir, [Permission.READ]);
    });

    test('应该列出目录内容', async () => {
      const files = await sandbox.listDirectory('team-1', 'agent-1', testDir);

      expect(files.length).toBeGreaterThanOrEqual(2);

      const fileNames = files.map(f => f.name);
      expect(fileNames).toContain('file1.txt');
      expect(fileNames).toContain('file2.txt');
      expect(fileNames).toContain('subdir');
    });

    test('应该过滤敏感文件', async () => {
      const files = await sandbox.listDirectory('team-1', 'agent-1', testDir);

      const fileNames = files.map(f => f.name);
      expect(fileNames).not.toContain('.env');
    });

    test('应该区分文件和目录', async () => {
      const files = await sandbox.listDirectory('team-1', 'agent-1', testDir);

      const file1 = files.find(f => f.name === 'file1.txt');
      const subdir = files.find(f => f.name === 'subdir');

      expect(file1.isFile).toBe(true);
      expect(file1.isDirectory).toBe(false);
      expect(subdir.isDirectory).toBe(true);
      expect(subdir.isFile).toBe(false);
    });
  });

  // ==========================================
  // getAuditLog 测试
  // ==========================================

  describe('getAuditLog', () => {
    beforeEach(async () => {
      const testFilePath = path.join(testDir, 'test.txt');
      await fs.writeFile(testFilePath, 'content', 'utf-8');
      await sandbox.grantAccess('team-1', testDir, [Permission.READ, Permission.WRITE]);

      // 生成一些操作记录
      await sandbox.readFile('team-1', 'agent-1', testFilePath);
      await sandbox.writeFile('team-1', 'agent-2', testFilePath, 'new content');
    });

    test('应该返回审计日志', () => {
      const logs = sandbox.getAuditLog();

      expect(logs.length).toBeGreaterThanOrEqual(2);
    });

    test('应该按团队过滤', () => {
      const logs = sandbox.getAuditLog({ teamId: 'team-1' });

      expect(logs.length).toBeGreaterThanOrEqual(2);
      logs.forEach(log => {
        expect(log.teamId).toBe('team-1');
      });
    });

    test('应该按代理过滤', () => {
      const logs = sandbox.getAuditLog({ agentId: 'agent-1' });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      logs.forEach(log => {
        expect(log.agentId).toBe('agent-1');
      });
    });

    test('应该按操作类型过滤', () => {
      const logs = sandbox.getAuditLog({ operation: 'read' });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      logs.forEach(log => {
        expect(log.operation).toBe('read');
      });
    });

    test('应该按成功状态过滤', () => {
      const logs = sandbox.getAuditLog({ success: true });

      logs.forEach(log => {
        expect(log.success).toBe(1);
      });
    });
  });

  // ==========================================
  // getStats 测试
  // ==========================================

  describe('getStats', () => {
    test('应该返回统计信息', async () => {
      await sandbox.grantAccess('team-1', '/path/1', [Permission.READ]);
      await sandbox.grantAccess('team-2', '/path/2', [Permission.WRITE]);

      const stats = sandbox.getStats();

      expect(stats.totalAllowedPaths).toBe(2);
      expect(stats.totalTeams).toBe(2);
      expect(stats.totalAuditLogs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================
  // isDangerousOperation 测试
  // ==========================================

  describe('isDangerousOperation', () => {
    test('应该检测危险操作', () => {
      expect(sandbox.isDangerousOperation('rm -rf /')).toBe(true);
      expect(sandbox.isDangerousOperation('format c:')).toBe(true);
      expect(sandbox.isDangerousOperation('delete all files')).toBe(true);
      expect(sandbox.isDangerousOperation('drop table users')).toBe(true);
    });

    test('应该允许安全操作', () => {
      expect(sandbox.isDangerousOperation('read file.txt')).toBe(false);
      expect(sandbox.isDangerousOperation('copy file1.txt file2.txt')).toBe(false);
    });
  });
});
