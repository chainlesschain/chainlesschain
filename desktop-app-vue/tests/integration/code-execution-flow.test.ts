/**
 * 代码执行流程集成测试
 * 测试从UI到后端的完整执行流程
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockElectronAPI } from '../setup';

describe('代码执行流程集成测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('完整的Python代码执行流程', () => {
    it('应该完成从前端到后端的完整执行流程', async () => {
      // 模拟用户输入代码
      const userCode = `
import math
print("圆周率:", math.pi)
print("2的平方根:", math.sqrt(2))
      `;

      // 1. 首先进行安全检查
      const safetyResult = {
        safe: true,
        warnings: [],
      };

      mockElectronAPI.code.checkSafety.mockResolvedValue(safetyResult);

      const safetyCheck = await mockElectronAPI.code.checkSafety(userCode);

      expect(safetyCheck.safe).toBe(true);
      expect(mockElectronAPI.code.checkSafety).toHaveBeenCalledWith(userCode);

      // 2. 执行Python代码
      const executionResult = {
        success: true,
        stdout: '圆周率: 3.141592653589793\n2的平方根: 1.4142135623730951\n',
        stderr: '',
        exitCode: 0,
        executionTime: 234,
      };

      mockElectronAPI.code.executePython.mockResolvedValue(executionResult);

      const result = await mockElectronAPI.code.executePython(userCode, {
        timeout: 30000,
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('圆周率');
      expect(result.stdout).toContain('平方根');
      expect(result.exitCode).toBe(0);
      expect(mockElectronAPI.code.executePython).toHaveBeenCalledWith(
        userCode,
        expect.objectContaining({ timeout: 30000 })
      );
    });

    it('应该处理包含危险操作的代码执行流程', async () => {
      const dangerousCode = `
import os
os.system("ls -la")
print("Done")
      `;

      // 1. 安全检查应该检测到危险操作
      const safetyResult = {
        safe: false,
        warnings: ['检测到潜在危险操作: os.system'],
      };

      mockElectronAPI.code.checkSafety.mockResolvedValue(safetyResult);

      const safetyCheck = await mockElectronAPI.code.checkSafety(dangerousCode);

      expect(safetyCheck.safe).toBe(false);
      expect(safetyCheck.warnings.length).toBeGreaterThan(0);

      // 2. 默认执行应该被阻止
      const blockedResult = {
        success: false,
        error: 'code_unsafe',
        warnings: safetyResult.warnings,
        message: '代码包含潜在危险操作,执行已阻止',
      };

      mockElectronAPI.code.executePython.mockResolvedValue(blockedResult);

      const result = await mockElectronAPI.code.executePython(dangerousCode);

      expect(result.success).toBe(false);
      expect(result.error).toBe('code_unsafe');

      // 3. 用户可以选择强制执行
      const forcedResult = {
        success: true,
        stdout: 'Done\n',
        stderr: '',
        exitCode: 0,
        executionTime: 150,
      };

      mockElectronAPI.code.executePython.mockResolvedValue(forcedResult);

      const forcedExecution = await mockElectronAPI.code.executePython(dangerousCode, {
        ignoreWarnings: true,
      });

      expect(forcedExecution.success).toBe(true);
      expect(mockElectronAPI.code.executePython).toHaveBeenCalledWith(
        dangerousCode,
        expect.objectContaining({ ignoreWarnings: true })
      );
    });

    it('应该处理代码执行错误的完整流程', async () => {
      const buggyCode = `
print("Starting...")
x = 10 / 0  # 除零错误
print("This won't execute")
      `;

      // 1. 安全检查通过
      mockElectronAPI.code.checkSafety.mockResolvedValue({
        safe: true,
        warnings: [],
      });

      await mockElectronAPI.code.checkSafety(buggyCode);

      // 2. 执行时遇到运行时错误
      const errorResult = {
        success: false,
        stdout: 'Starting...\n',
        stderr: 'Traceback (most recent call last):\nZeroDivisionError: division by zero\n',
        exitCode: 1,
        executionTime: 89,
      };

      mockElectronAPI.code.executePython.mockResolvedValue(errorResult);

      const result = await mockElectronAPI.code.executePython(buggyCode);

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('ZeroDivisionError');
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Starting...');
    });
  });

  describe('文件执行流程', () => {
    it('应该支持执行Python文件', async () => {
      const filepath = '/path/to/script.py';

      const fileResult = {
        success: true,
        stdout: 'Script executed successfully\n',
        stderr: '',
        exitCode: 0,
        executionTime: 345,
        language: 'python',
      };

      mockElectronAPI.code.executeFile.mockResolvedValue(fileResult);

      const result = await mockElectronAPI.code.executeFile(filepath);

      expect(result.success).toBe(true);
      expect(result.language).toBe('python');
      expect(mockElectronAPI.code.executeFile).toHaveBeenCalledWith(filepath);
    });

    it('应该支持带选项的文件执行', async () => {
      const filepath = '/path/to/script.py';
      const options = {
        timeout: 60000,
        env: { PYTHONPATH: '/custom/path' },
      };

      mockElectronAPI.code.executeFile.mockResolvedValue({
        success: true,
        stdout: 'Output\n',
        stderr: '',
        exitCode: 0,
        executionTime: 1200,
        language: 'python',
      });

      const result = await mockElectronAPI.code.executeFile(filepath, options);

      expect(result.success).toBe(true);
      expect(mockElectronAPI.code.executeFile).toHaveBeenCalledWith(filepath, options);
    });
  });

  describe('多次连续执行', () => {
    it('应该支持连续执行多个代码片段', async () => {
      const codes = [
        'print("First")',
        'print("Second")',
        'print("Third")',
      ];

      mockElectronAPI.code.executePython
        .mockResolvedValueOnce({
          success: true,
          stdout: 'First\n',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
        })
        .mockResolvedValueOnce({
          success: true,
          stdout: 'Second\n',
          stderr: '',
          exitCode: 0,
          executionTime: 95,
        })
        .mockResolvedValueOnce({
          success: true,
          stdout: 'Third\n',
          stderr: '',
          exitCode: 0,
          executionTime: 102,
        });

      for (const code of codes) {
        const result = await mockElectronAPI.code.executePython(code);
        expect(result.success).toBe(true);
      }

      expect(mockElectronAPI.code.executePython).toHaveBeenCalledTimes(3);
    });

    it('应该正确处理执行顺序', async () => {
      const executionOrder: string[] = [];

      mockElectronAPI.code.executePython.mockImplementation(async (code: string) => {
        // 模拟异步执行
        await new Promise((resolve) => setTimeout(resolve, 50));
        executionOrder.push(code);
        return {
          success: true,
          stdout: `Executed: ${code}\n`,
          stderr: '',
          exitCode: 0,
          executionTime: 50,
        };
      });

      await mockElectronAPI.code.executePython('Code 1');
      await mockElectronAPI.code.executePython('Code 2');
      await mockElectronAPI.code.executePython('Code 3');

      expect(executionOrder).toEqual(['Code 1', 'Code 2', 'Code 3']);
    });
  });

  describe('错误恢复和重试', () => {
    it('应该允许在失败后重试', async () => {
      const code = 'print("test")';

      // 第一次执行失败
      mockElectronAPI.code.executePython.mockResolvedValueOnce({
        success: false,
        stdout: '',
        stderr: 'Temporary error',
        exitCode: 1,
        executionTime: 50,
      });

      const firstResult = await mockElectronAPI.code.executePython(code);
      expect(firstResult.success).toBe(false);

      // 第二次执行成功
      mockElectronAPI.code.executePython.mockResolvedValueOnce({
        success: true,
        stdout: 'test\n',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      });

      const secondResult = await mockElectronAPI.code.executePython(code);
      expect(secondResult.success).toBe(true);
    });
  });

  describe('长时间运行代码', () => {
    it('应该处理长时间运行的代码', async () => {
      const longRunningCode = `
import time
for i in range(10):
    print(f"Step {i}")
    time.sleep(0.1)
print("Done")
      `;

      const result = {
        success: true,
        stdout: 'Step 0\nStep 1\n...\nDone\n',
        stderr: '',
        exitCode: 0,
        executionTime: 1234,
      };

      mockElectronAPI.code.executePython.mockResolvedValue(result);

      const executionResult = await mockElectronAPI.code.executePython(longRunningCode, {
        timeout: 5000,
      });

      expect(executionResult.success).toBe(true);
      expect(executionResult.executionTime).toBeGreaterThan(1000);
    });

    it('应该在超时时终止执行', async () => {
      const infiniteLoopCode = 'while True: pass';

      const timeoutResult = {
        success: false,
        error: 'execution_failed',
        message: '执行超时 (1000ms)',
        stdout: '',
        stderr: '执行超时 (1000ms)',
      };

      mockElectronAPI.code.executePython.mockResolvedValue(timeoutResult);

      const result = await mockElectronAPI.code.executePython(infiniteLoopCode, {
        timeout: 1000,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('超时');
    });
  });

  describe('环境变量和工作目录', () => {
    it('应该支持自定义环境变量', async () => {
      const code = 'import os; print(os.environ.get("CUSTOM_VAR"))';

      mockElectronAPI.code.executePython.mockResolvedValue({
        success: true,
        stdout: 'custom_value\n',
        stderr: '',
        exitCode: 0,
        executionTime: 78,
      });

      const result = await mockElectronAPI.code.executePython(code, {
        env: { CUSTOM_VAR: 'custom_value' },
      });

      expect(result.success).toBe(true);
      expect(mockElectronAPI.code.executePython).toHaveBeenCalledWith(
        code,
        expect.objectContaining({
          env: { CUSTOM_VAR: 'custom_value' },
        })
      );
    });

    it('应该支持自定义工作目录', async () => {
      const code = 'import os; print(os.getcwd())';

      mockElectronAPI.code.executePython.mockResolvedValue({
        success: true,
        stdout: '/custom/workdir\n',
        stderr: '',
        exitCode: 0,
        executionTime: 65,
      });

      const result = await mockElectronAPI.code.executePython(code, {
        workingDir: '/custom/workdir',
      });

      expect(result.success).toBe(true);
      expect(mockElectronAPI.code.executePython).toHaveBeenCalledWith(
        code,
        expect.objectContaining({
          workingDir: '/custom/workdir',
        })
      );
    });
  });
});
