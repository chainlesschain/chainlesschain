/**
 * CodeExecutor 单元测试
 *
 * 注意：由于code-executor.js使用CommonJS模块系统，
 * 部分测试依赖真实的系统环境（fs、spawn）。
 * 这些测试更接近集成测试的性质。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { spawn: nativeSpawn } = require("child_process");
const spawnWithoutBrokerMetadata = (command, args, options = {}) => {
  const nativeOptions = { ...options };
  delete nativeOptions.origin;
  return nativeSpawn(command, args, nativeOptions);
};

// Import the CommonJS module
const {
  CodeExecutor,
  getCodeExecutor,
  sanitizeChildEnv,
  BLOCKED_CHILD_ENV_KEYS,
} = require("../../../src/main/engines/code-executor.js");

describe("CodeExecutor", () => {
  let codeExecutor;

  beforeEach(() => {
    // 创建新实例
    codeExecutor = new CodeExecutor({
      spawnProcess: spawnWithoutBrokerMetadata,
    });
  });

  describe("detectLanguage", () => {
    it("应该正确检测Python", () => {
      const lang = codeExecutor.detectLanguage(".py");
      expect(lang).toBe("python");
    });

    it("应该正确检测JavaScript", () => {
      const lang = codeExecutor.detectLanguage(".js");
      expect(lang).toBe("javascript");
    });

    it("应该正确检测Bash", () => {
      const lang = codeExecutor.detectLanguage(".sh");
      expect(lang).toBe("bash");
    });

    it("应该返回null对于未知类型", () => {
      const lang = codeExecutor.detectLanguage(".xyz");
      expect(lang).toBeNull();
    });
  });

  describe("checkSafety", () => {
    it("应该检测到 os.system 危险操作", () => {
      const code = 'import os\nos.system("rm -rf /")';
      const result = codeExecutor.checkSafety(code);

      expect(result.safe).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("os");
      expect(result.warnings[0]).toContain("system");
    });

    it("应该检测到 eval 危险操作", () => {
      const code = "eval(\"__import__('os').system('ls')\")";
      const result = codeExecutor.checkSafety(code);

      expect(result.safe).toBe(false);
      expect(result.warnings.some((w) => w.includes("eval"))).toBe(true);
    });

    it("应该检测到 subprocess 危险操作", () => {
      const code = 'import subprocess\nsubprocess.call(["ls", "-la"])';
      const result = codeExecutor.checkSafety(code);

      expect(result.safe).toBe(false);
      expect(result.warnings.some((w) => w.includes("subprocess"))).toBe(true);
    });

    it("应该检测到文件写入操作", () => {
      const code = 'open("/etc/passwd", "w").write("malicious")';
      const result = codeExecutor.checkSafety(code);

      expect(result.safe).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("应该通过安全代码检查", () => {
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

    it("应该检测多个危险操作", () => {
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

  describe("基本属性", () => {
    it("应该有正确的初始状态", () => {
      expect(codeExecutor.initialized).toBe(false);
      expect(codeExecutor.pythonPath).toBeNull();
      expect(codeExecutor.timeout).toBe(30000);
    });

    it("应该有正确的支持语言配置", () => {
      expect(codeExecutor.supportedLanguages).toHaveProperty("python");
      expect(codeExecutor.supportedLanguages).toHaveProperty("javascript");
      expect(codeExecutor.supportedLanguages).toHaveProperty("bash");
    });

    it("应该有正确的临时目录路径", () => {
      expect(codeExecutor.tempDir).toContain("chainlesschain-code-exec");
    });
  });

  describe("getCodeExecutor 单例", () => {
    it("应该返回单例实例", () => {
      const instance1 = getCodeExecutor();
      const instance2 = getCodeExecutor();

      expect(instance1).toBe(instance2);
    });
  });

  describe("runCommand shell-injection 加固", () => {
    it("不对 args 做 shell 解释（杜绝命令注入）", async () => {
      // 回归：runCommand 曾用 `shell: process.platform === "win32"`，于是在
      // Windows 上 args 会被 shell 解释——一个含 `&` 的 arg（如渲染进程传入的
      // filepath）能注入命令。shell:false 后，元字符只是 node 的字面量 argv。
      // shell:true 下 cmd 会跑 `node -e ... & echo INJECTED` → 输出含 INJECTED；
      // shell:false 下 `&`/`echo`/`INJECTED` 仅作为 node 的多余参数被忽略。
      const result = await codeExecutor.runCommand("node", [
        "-e",
        'process.stdout.write("clean")',
        "&",
        "echo",
        "INJECTED",
      ]);

      expect(result.stdout).toContain("clean");
      expect(result.stdout).not.toContain("INJECTED");
    }, 15000);
  });

  // 以下测试依赖真实环境，标记为集成测试
  describe.skip("集成测试 (需要真实Python环境)", () => {
    describe("初始化", () => {
      it("应该成功初始化并检测Python", async () => {
        await codeExecutor.initialize();

        expect(codeExecutor.initialized).toBe(true);
        // Python路径可能存在也可能不存在，取决于环境
      }, 10000);
    });

    describe("executePython", () => {
      beforeEach(async () => {
        await codeExecutor.initialize();
      });

      it("应该成功执行简单的Python代码", async () => {
        if (!codeExecutor.pythonPath) {
          console.log("跳过：Python未安装");
          return;
        }

        const code = 'print("Hello, World!")';
        const result = await codeExecutor.executePython(code);

        expect(result.success).toBe(true);
        expect(result.stdout).toContain("Hello, World!");
        expect(result.exitCode).toBe(0);
      }, 10000);

      it("应该处理Python执行错误", async () => {
        if (!codeExecutor.pythonPath) {
          console.log("跳过：Python未安装");
          return;
        }

        const code = 'print("Hello'; // 语法错误
        const result = await codeExecutor.executePython(code);

        expect(result.success).toBe(false);
        expect(result.exitCode).not.toBe(0);
      }, 10000);
    });

    describe("executeFile", () => {
      it("应该检测不支持的文件类型", async () => {
        const filepath = "/path/to/unknown.xyz";

        await expect(codeExecutor.executeFile(filepath)).rejects.toThrow(
          /不支持的文件类型/,
        );
      });
    });
  });

  // ─── env-PATH hijack hardening ───────────────────────────────────────────
  describe("sanitizeChildEnv", () => {
    it("drops PATH / PATHEXT so a caller can't redirect the interpreter", () => {
      const { safe, dropped } = sanitizeChildEnv({
        PATH: "/tmp/evil",
        PATHEXT: ".EVIL",
      });
      expect(safe.PATH).toBeUndefined();
      expect(safe.PATHEXT).toBeUndefined();
      expect(dropped).toContain("PATH");
      expect(dropped).toContain("PATHEXT");
    });

    it("drops loader / interpreter-startup injection vars", () => {
      const injected = {
        LD_PRELOAD: "/tmp/evil.so",
        DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
        NODE_OPTIONS: "--require /tmp/evil.js",
        NODE_PATH: "/tmp/evil",
        PYTHONSTARTUP: "/tmp/evil.py",
        PYTHONPATH: "/tmp/evil",
        BASH_ENV: "/tmp/evil.sh",
        ELECTRON_RUN_AS_NODE: "1",
      };
      const { safe, dropped } = sanitizeChildEnv(injected);
      for (const key of Object.keys(injected)) {
        expect(safe[key]).toBeUndefined();
        expect(dropped).toContain(key);
      }
    });

    it("blocks case-insensitively (Windows env names)", () => {
      const { safe, dropped } = sanitizeChildEnv({
        Path: "/tmp/evil",
        path: "/tmp/evil2",
        Node_Options: "--require /evil",
      });
      expect(safe.Path).toBeUndefined();
      expect(safe.path).toBeUndefined();
      expect(safe.Node_Options).toBeUndefined();
      expect(dropped).toEqual(
        expect.arrayContaining(["Path", "path", "Node_Options"]),
      );
    });

    it("keeps ordinary custom env vars", () => {
      const { safe, dropped } = sanitizeChildEnv({
        MY_APP_TOKEN: "abc",
        CUSTOM_FLAG: "1",
      });
      expect(safe.MY_APP_TOKEN).toBe("abc");
      expect(safe.CUSTOM_FLAG).toBe("1");
      expect(dropped).toEqual([]);
    });

    it("handles null / undefined / non-object input and never mutates input", () => {
      expect(sanitizeChildEnv(null)).toEqual({ safe: {}, dropped: [] });
      expect(sanitizeChildEnv(undefined)).toEqual({ safe: {}, dropped: [] });
      const input = { PATH: "/tmp/evil", KEEP: "1" };
      sanitizeChildEnv(input);
      expect(input).toEqual({ PATH: "/tmp/evil", KEEP: "1" });
    });

    it("BLOCKED_CHILD_ENV_KEYS covers PATH and the loader vars", () => {
      expect(BLOCKED_CHILD_ENV_KEYS.has("PATH")).toBe(true);
      expect(BLOCKED_CHILD_ENV_KEYS.has("LD_PRELOAD")).toBe(true);
      expect(BLOCKED_CHILD_ENV_KEYS.has("NODE_OPTIONS")).toBe(true);
    });
  });

  describe("runCommand env hardening (end-to-end via node child)", () => {
    it("a caller-injected LD_PRELOAD does not reach the child, but a safe var does", async () => {
      const script =
        "process.stdout.write(JSON.stringify({" +
        "pre: process.env.LD_PRELOAD || null, safe: process.env.CC_TEST_SAFE || null}))";
      const result = await codeExecutor.runCommand("node", ["-e", script], {
        env: { LD_PRELOAD: "/tmp/evil.so", CC_TEST_SAFE: "kept" },
        timeout: 10000,
      });
      const parsed = JSON.parse(result.stdout);
      // The injected loader var was stripped (never equals the attacker value).
      expect(parsed.pre).not.toBe("/tmp/evil.so");
      // A non-sensitive custom var still passes through.
      expect(parsed.safe).toBe("kept");
    }, 15000);
  });
});
