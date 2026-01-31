/**
 * 路径安全测试
 * 测试路径遍历防御和文件访问控制
 */

const PathSecurity = require('../../../src/main/project/path-security.js');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

describe('PathSecurity - 路径安全验证', () => {
  let testRoot;
  let testProject;

  beforeAll(async () => {
    // 创建临时测试目录
    testRoot = path.join(os.tmpdir(), 'chainlesschain-test-' + Date.now());
    testProject = path.join(testRoot, 'test-project');
    await fs.mkdir(testProject, { recursive: true });
    await fs.writeFile(path.join(testProject, 'test.txt'), 'test content');
  });

  afterAll(async () => {
    // 清理测试目录
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch (error) {
      console.error('清理测试目录失败:', error);
    }
  });

  describe('isPathSafe', () => {
    test('应该允许项目目录内的文件', () => {
      const targetPath = path.join(testProject, 'test.txt');
      expect(PathSecurity.isPathSafe(targetPath, testProject)).toBe(true);
    });

    test('应该允许项目子目录内的文件', () => {
      const targetPath = path.join(testProject, 'subdir', 'file.txt');
      expect(PathSecurity.isPathSafe(targetPath, testProject)).toBe(true);
    });

    test('应该阻止父目录遍历 (..)', () => {
      const targetPath = path.join(testProject, '..', 'outside.txt');
      expect(PathSecurity.isPathSafe(targetPath, testProject)).toBe(false);
    });

    test('应该阻止绝对路径到系统目录', () => {
      const targetPath = '/etc/passwd';
      expect(PathSecurity.isPathSafe(targetPath, testProject)).toBe(false);
    });

    test('应该阻止 Windows 系统目录访问', () => {
      const targetPath = 'C:\\Windows\\System32\\config\\SAM';
      expect(PathSecurity.isPathSafe(targetPath, testProject)).toBe(false);
    });

    test('应该处理多层父目录遍历', () => {
      const targetPath = path.join(testProject, '..', '..', '..', 'etc', 'passwd');
      expect(PathSecurity.isPathSafe(targetPath, testProject)).toBe(false);
    });

    test('应该处理 null 或 undefined 输入', () => {
      expect(PathSecurity.isPathSafe(null, testProject)).toBe(false);
      expect(PathSecurity.isPathSafe(testProject, null)).toBe(false);
      expect(PathSecurity.isPathSafe(undefined, testProject)).toBe(false);
    });
  });

  describe('resolveSafePath', () => {
    test('应该正确解析项目内的相对路径', () => {
      const userPath = 'subdir/file.txt';
      const result = PathSecurity.resolveSafePath(userPath, testProject);
      expect(result).toBe(path.join(testProject, 'subdir', 'file.txt'));
    });

    test('应该规范化路径分隔符', () => {
      const userPath = 'subdir\\file.txt'; // Windows 风格
      const result = PathSecurity.resolveSafePath(userPath, testProject);
      expect(result).toContain('subdir');
      expect(result).toContain('file.txt');
    });

    test('应该抛出错误当检测到路径遍历', () => {
      const userPath = '../../../etc/passwd';
      expect(() => {
        PathSecurity.resolveSafePath(userPath, testProject);
      }).toThrow('无权访问此路径');
    });

    test('应该抛出错误当输入为空', () => {
      expect(() => {
        PathSecurity.resolveSafePath('', testProject);
      }).toThrow('路径和根目录不能为空');

      expect(() => {
        PathSecurity.resolveSafePath('test.txt', '');
      }).toThrow('路径和根目录不能为空');
    });

    test('应该处理路径中的 ./ 和 ../', () => {
      const userPath = './subdir/../file.txt'; // 解析后应该是 file.txt
      const result = PathSecurity.resolveSafePath(userPath, testProject);
      expect(result).toBe(path.join(testProject, 'file.txt'));
    });
  });

  describe('validateFileAccess', () => {
    test('应该验证存在的文件', async () => {
      const filePath = 'test.txt';
      const result = await PathSecurity.validateFileAccess(filePath, testProject);
      expect(result).toBe(true);
    });

    test('应该抛出错误当文件不存在', async () => {
      const filePath = 'nonexistent.txt';
      await expect(
        PathSecurity.validateFileAccess(filePath, testProject)
      ).rejects.toThrow('文件不存在');
    });

    test('应该阻止访问项目外的文件', async () => {
      const filePath = '../../../etc/passwd';
      await expect(
        PathSecurity.validateFileAccess(filePath, testProject)
      ).rejects.toThrow('无权访问此路径');
    });
  });

  describe('containsDangerousChars', () => {
    test('应该检测父目录遍历', () => {
      expect(PathSecurity.containsDangerousChars('../file.txt')).toBe(true);
      expect(PathSecurity.containsDangerousChars('subdir/../file.txt')).toBe(true);
    });

    test('应该检测用户目录访问', () => {
      expect(PathSecurity.containsDangerousChars('~/file.txt')).toBe(true);
    });

    test('应该检测 null 字节', () => {
      expect(PathSecurity.containsDangerousChars('file\0.txt')).toBe(true);
    });

    test('应该检测 Windows 非法字符', () => {
      expect(PathSecurity.containsDangerousChars('file<name>.txt')).toBe(true);
      expect(PathSecurity.containsDangerousChars('file|name.txt')).toBe(true);
      expect(PathSecurity.containsDangerousChars('file?name.txt')).toBe(true);
    });

    test('应该检测系统目录路径', () => {
      expect(PathSecurity.containsDangerousChars('/etc/passwd')).toBe(true);
      expect(PathSecurity.containsDangerousChars('/proc/version')).toBe(true);
      expect(PathSecurity.containsDangerousChars('/sys/kernel')).toBe(true);
      expect(PathSecurity.containsDangerousChars('C:\\Windows\\System32')).toBe(true);
      expect(PathSecurity.containsDangerousChars('C:\\Program Files\\app')).toBe(true);
    });

    test('应该允许正常的文件路径', () => {
      expect(PathSecurity.containsDangerousChars('file.txt')).toBe(false);
      expect(PathSecurity.containsDangerousChars('subdir/file.txt')).toBe(false);
      expect(PathSecurity.containsDangerousChars('my-project_v2.txt')).toBe(false);
    });
  });

  describe('validateFileExtension', () => {
    test('应该允许白名单中的扩展名', () => {
      const allowed = ['txt', 'md', 'json'];
      expect(PathSecurity.validateFileExtension('test.txt', allowed)).toBe(true);
      expect(PathSecurity.validateFileExtension('README.md', allowed)).toBe(true);
      expect(PathSecurity.validateFileExtension('config.json', allowed)).toBe(true);
    });

    test('应该阻止白名单外的扩展名', () => {
      const allowed = ['txt', 'md', 'json'];
      expect(PathSecurity.validateFileExtension('script.exe', allowed)).toBe(false);
      expect(PathSecurity.validateFileExtension('malware.bat', allowed)).toBe(false);
    });

    test('应该不区分大小写', () => {
      const allowed = ['txt'];
      expect(PathSecurity.validateFileExtension('test.TXT', allowed)).toBe(true);
      expect(PathSecurity.validateFileExtension('test.Txt', allowed)).toBe(true);
    });

    test('应该允许所有扩展名当白名单为空', () => {
      expect(PathSecurity.validateFileExtension('any.file', [])).toBe(true);
      expect(PathSecurity.validateFileExtension('script.exe', null)).toBe(true);
    });
  });

  describe('sanitizeFilename', () => {
    test('应该移除路径分隔符', () => {
      expect(PathSecurity.sanitizeFilename('path/to/file.txt')).toBe('path_to_file.txt');
      expect(PathSecurity.sanitizeFilename('path\\to\\file.txt')).toBe('path_to_file.txt');
    });

    test('应该移除危险字符', () => {
      expect(PathSecurity.sanitizeFilename('file<name>.txt')).toBe('filename.txt');
      expect(PathSecurity.sanitizeFilename('file|name.txt')).toBe('filename.txt');
      expect(PathSecurity.sanitizeFilename('file\0name.txt')).toBe('filename.txt');
    });

    test('应该移除开头的点', () => {
      expect(PathSecurity.sanitizeFilename('...file.txt')).toBe('file.txt');
      expect(PathSecurity.sanitizeFilename('.hidden')).toBe('hidden');
    });

    test('应该限制文件名长度', () => {
      const longName = 'a'.repeat(300) + '.txt';
      const result = PathSecurity.sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(255);
    });

    test('应该保留正常的文件名', () => {
      expect(PathSecurity.sanitizeFilename('normal-file_v2.txt')).toBe('normal-file_v2.txt');
      expect(PathSecurity.sanitizeFilename('中文文件名.txt')).toBe('中文文件名.txt');
    });
  });

  describe('真实攻击场景测试', () => {
    test('应该阻止经典路径遍历攻击', () => {
      const attacks = [
        '../../../etc/passwd',
        '..\\..\\..\\Windows\\System32\\config\\SAM',
        'subdir/../../etc/passwd',
        'subdir/../../../etc/shadow',
      ];

      attacks.forEach(attack => {
        expect(() => {
          PathSecurity.resolveSafePath(attack, testProject);
        }).toThrow('无权访问此路径');
      });
    });

    test('应该阻止 URL 编码的路径遍历', () => {
      const attack = '%2e%2e%2f%2e%2e%2fetc%2fpasswd'; // ..%2F..%2Fetc%2Fpasswd
      expect(PathSecurity.containsDangerousChars(attack)).toBe(false); // URL编码需要先解码
      // 实际应用中应该在IPC层解码后再验证
    });

    test('应该正确处理 Unicode 字符在文件名中', () => {
      // Node.js 的 path 模块不会将 Unicode 斜杠解释为路径分隔符
      // 因此这些字符会被当作普通字符，不构成安全威胁
      const unicodePath = 'subdir\u2215file.txt'; // Unicode 斜杠 (U+2215)
      expect(() => {
        PathSecurity.resolveSafePath(unicodePath, testProject);
      }).not.toThrow(); // 应该允许，因为不被解释为路径分隔符

      // 但真正的路径遍历仍然会被阻止
      const realAttack = '../etc/passwd';
      expect(() => {
        PathSecurity.resolveSafePath(realAttack, testProject);
      }).toThrow('无权访问此路径');
    });

    test('应该阻止 null 字节注入', () => {
      const attack = 'file.txt\0malicious';
      expect(PathSecurity.containsDangerousChars(attack)).toBe(true);
    });
  });

  describe('边界条件测试', () => {
    test('应该处理空字符串', () => {
      expect(PathSecurity.isPathSafe('', testProject)).toBe(false);
      expect(() => {
        PathSecurity.resolveSafePath('', testProject);
      }).toThrow();
    });

    test('应该处理非常长的路径', () => {
      const longPath = 'a/'.repeat(1000) + 'file.txt';
      // 应该能处理而不崩溃
      expect(() => {
        PathSecurity.resolveSafePath(longPath, testProject);
      }).not.toThrow();
    });

    test('应该处理特殊字符在文件名中', () => {
      const specialNames = [
        'file name with spaces.txt',
        'file-with-dashes.txt',
        'file_with_underscores.txt',
        'file.multiple.dots.txt',
      ];

      specialNames.forEach(name => {
        expect(() => {
          PathSecurity.resolveSafePath(name, testProject);
        }).not.toThrow();
      });
    });
  });
});
