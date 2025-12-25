/**
 * CodeExecutor 单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs module (CommonJS style used by code-executor.js)
vi.mock('fs', () => ({
  default: {
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi.fn().mockResolvedValue({}),
    }
  },
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({}),
  }
}));

// 动态导入 CodeExecutor (在 mock 之后)
let CodeExecutor, getCodeExecutor, fs;

describe('CodeExecutor', () => {
  let codeExecutor;

  beforeEach(async () => {
    // 清除模块缓存
    vi.resetModules();

    // 动态导入 fs 和 CodeExecutor
    const fsModule = await import('fs');
    fs = fsModule.promises;

    const module = await import('../../src/main/engines/code-executor.js');
    CodeExecutor = module.CodeExecutor;
    getCodeExecutor = module.getCodeExecutor;

    codeExecutor = new CodeExecutor();

    // 重置所有 mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初始化', () => {
    it('应该成功初始化', async () => {
      // Mock Python 版本检测
      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            // 模拟成功退出
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: vi.fn(),
      };

      spawn.mockReturnValue(mockProcess);

      // 模拟 stdout 数据
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('Python 3.9.0')), 5);
        }
      });

      mockProcess.stderr.on.mockImplementation(() => {});

      await codeExecutor.initialize();

      expect(codeExecutor.initialized).toBe(true);
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('chainlesschain-code-exec'),
        { recursive: true }
      );
    });

    it('即使没有Python也应该初始化', async () => {
      // Mock 所有 Python 命令都失败
      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 10); // 失败退出码
          }
        }),
        kill: vi.fn(),
      };

      spawn.mockReturnValue(mockProcess);
      mockProcess.stdout.on.mockImplementation(() => {});
      mockProcess.stderr.on.mockImplementation(() => {});

      await codeExecutor.initialize();

      // 即使检测失败,也应该初始化
      expect(codeExecutor.initialized).toBe(true);
    });
  });

  describe('executePython', () => {
    beforeEach(async () => {
      // 初始化并设置 Python 路径
      codeExecutor.initialized = true;
      codeExecutor.pythonPath = 'python3';
    });

    it('应该成功执行Python代码', async () => {
      const mockProcess = {
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10); // 成功退出码
          }
        }),
        kill: vi.fn(),
      };

      spawn.mockReturnValue(mockProcess);

      // 模拟成功输出
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('Hello, World!')), 5);
        }
      });

      mockProcess.stderr.on.mockImplementation(() => {});

      const code = 'print("Hello, World!")';
      const result = await codeExecutor.executePython(code);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Hello, World!');
      expect(result.exitCode).toBe(0);
      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.unlink).toHaveBeenCalled();
    });

    it('应该处理执行错误', async () => {
      const mockProcess = {
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 10); // 错误退出码
          }
        }),
        kill: vi.fn(),
      };

      spawn.mockReturnValue(mockProcess);

      mockProcess.stdout.on.mockImplementation(() => {});

      // 模拟错误输出
      mockProcess.stderr.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('SyntaxError: invalid syntax')), 5);
        }
      });

      const code = 'print("Hello';
      const result = await codeExecutor.executePython(code);

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('SyntaxError');
      expect(result.exitCode).toBe(1);
    });

    it('应该支持超时设置', async () => {
      const mockProcess = {
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };

      spawn.mockReturnValue(mockProcess);
      mockProcess.stdout.on.mockImplementation(() => {});
      mockProcess.stderr.on.mockImplementation(() => {});

      const code = 'import time; time.sleep(100)';

      // 设置很短的超时时间
      const promise = codeExecutor.executePython(code, { timeout: 100 });

      await expect(promise).rejects.toThrow(/超时/);
      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it('应该在没有Python时抛出错误', async () => {
      codeExecutor.pythonPath = null;

      const code = 'print("test")';

      await expect(codeExecutor.executePython(code)).rejects.toThrow(/Python环境未配置/);
    });
  });

  describe('executeFile', () => {
    beforeEach(() => {
      codeExecutor.initialized = true;
      codeExecutor.pythonPath = 'python3';
    });

    it('应该成功执行Python文件', async () => {
      const mockProcess = {
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: vi.fn(),
      };

      spawn.mockReturnValue(mockProcess);

      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('File executed')), 5);
        }
      });

      mockProcess.stderr.on.mockImplementation(() => {});

      const filepath = '/path/to/script.py';
      const result = await codeExecutor.executeFile(filepath);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('File executed');
      expect(result.language).toBe('python');
    });

    it('应该检测不支持的文件类型', async () => {
      const filepath = '/path/to/unknown.xyz';

      await expect(codeExecutor.executeFile(filepath)).rejects.toThrow(/不支持的文件类型/);
    });
  });

  describe('checkSafety', () => {
    it('应该检测到 os.system 危险操作', () => {
      const code = 'import os\nos.system("rm -rf /")';
      const result = codeExecutor.checkSafety(code);

      expect(result.safe).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('os');
      expect(result.warnings[0]).toContain('system');
    });

    it('应该检测到 eval 危险操作', () => {
      const code = 'eval("__import__(\'os\').system(\'ls\')")';
      const result = codeExecutor.checkSafety(code);

      expect(result.safe).toBe(false);
      expect(result.warnings.some((w) => w.includes('eval'))).toBe(true);
    });

    it('应该检测到 subprocess 危险操作', () => {
      const code = 'import subprocess\nsubprocess.call(["ls", "-la"])';
      const result = codeExecutor.checkSafety(code);

      expect(result.safe).toBe(false);
      expect(result.warnings.some((w) => w.includes('subprocess'))).toBe(true);
    });

    it('应该检测到文件写入操作', () => {
      const code = 'open("/etc/passwd", "w").write("malicious")';
      const result = codeExecutor.checkSafety(code);

      expect(result.safe).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('应该通过安全代码检查', () => {
      const code = `
import math
print(math.pi)
x = [1, 2, 3]
print(sum(x))
      `;
      const result = codeExecutor.checkSafety(code);

      expect(result.safe).toBe(true);
      expect(result.warnings.length).toBe(0);
    });

    it('应该检测多个危险操作', () => {
      const code = `
import os
import subprocess
os.system("ls")
subprocess.call(["cat", "/etc/passwd"])
eval("1+1")
      `;
      const result = codeExecutor.checkSafety(code);

      expect(result.safe).toBe(false);
      expect(result.warnings.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('detectLanguage', () => {
    it('应该正确检测Python', () => {
      const lang = codeExecutor.detectLanguage('.py');
      expect(lang).toBe('python');
    });

    it('应该正确检测JavaScript', () => {
      const lang = codeExecutor.detectLanguage('.js');
      expect(lang).toBe('javascript');
    });

    it('应该正确检测Bash', () => {
      const lang = codeExecutor.detectLanguage('.sh');
      expect(lang).toBe('bash');
    });

    it('应该返回null对于未知类型', () => {
      const lang = codeExecutor.detectLanguage('.xyz');
      expect(lang).toBeNull();
    });
  });

  describe('runCommand', () => {
    it('应该成功运行命令', async () => {
      const mockProcess = {
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: vi.fn(),
      };

      spawn.mockReturnValue(mockProcess);

      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('command output')), 5);
        }
      });

      mockProcess.stderr.on.mockImplementation(() => {});

      const result = await codeExecutor.runCommand('echo', ['test']);

      expect(result.stdout).toContain('command output');
      expect(result.exitCode).toBe(0);
      expect(result.executionTime).toBeGreaterThan(0);
    });

    it('应该处理命令错误', async () => {
      const mockProcess = {
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Command not found')), 5);
          }
        }),
        kill: vi.fn(),
      };

      spawn.mockReturnValue(mockProcess);

      await expect(codeExecutor.runCommand('nonexistent', [])).rejects.toThrow(/执行失败/);
    });

    it('应该支持输入数据', async () => {
      const mockProcess = {
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: vi.fn(),
      };

      spawn.mockReturnValue(mockProcess);
      mockProcess.stdout.on.mockImplementation(() => {});
      mockProcess.stderr.on.mockImplementation(() => {});

      await codeExecutor.runCommand('cat', [], { input: 'test input' });

      expect(mockProcess.stdin.write).toHaveBeenCalledWith('test input');
      expect(mockProcess.stdin.end).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('应该清理过期的临时文件', async () => {
      const now = Date.now();
      const oldFile = { mtimeMs: now - 7200000 }; // 2小时前
      const newFile = { mtimeMs: now - 1800000 }; // 30分钟前

      fs.readdir.mockResolvedValue(['old.py', 'new.py']);
      fs.stat.mockImplementation((filepath) => {
        if (filepath.includes('old.py')) {
          return Promise.resolve(oldFile);
        }
        return Promise.resolve(newFile);
      });

      await codeExecutor.cleanup();

      // 应该删除旧文件
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('old.py'));
      // 不应该删除新文件
      expect(fs.unlink).not.toHaveBeenCalledWith(expect.stringContaining('new.py'));
    });

    it('应该处理清理错误', async () => {
      fs.readdir.mockRejectedValue(new Error('Permission denied'));

      // 不应该抛出错误
      await expect(codeExecutor.cleanup()).resolves.not.toThrow();
    });
  });

  describe('getCodeExecutor 单例', () => {
    it('应该返回单例实例', () => {
      const instance1 = getCodeExecutor();
      const instance2 = getCodeExecutor();

      expect(instance1).toBe(instance2);
    });
  });
});
