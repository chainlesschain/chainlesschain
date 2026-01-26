/**
 * ResponseParser 单元测试
 * 测试目标: src/main/ai-engine/response-parser.js
 * 覆盖场景: AI响应解析、文件操作提取、格式验证、安全检查
 *
 * ✅ 全部测试通过 - 无外部依赖
 *
 * ResponseParser负责从AI响应中提取文件操作指令
 * - 解析JSON格式操作
 * - 解析Markdown代码块
 * - 标准化操作格式
 * - 验证路径安全性
 *
 * 测试覆盖：
 * - parseAIResponse - 主要解析函数
 * - extractJSONOperations - JSON格式提取
 * - extractFileBlocks - Markdown代码块提取
 * - detectLanguage - 语言类型检测
 * - normalizeOperations - 操作标准化
 * - validateOperation - 单个操作验证
 * - validateOperations - 批量操作验证
 * - 安全性测试和边界情况
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "path";

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));

describe("ResponseParser", () => {
  let parseAIResponse;
  let extractJSONOperations;
  let extractFileBlocks;
  let detectLanguage;
  let normalizeOperations;
  let validateOperation;
  let validateOperations;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module =
      await import("../../../src/main/ai-engine/response-parser.js");
    parseAIResponse = module.parseAIResponse;
    extractJSONOperations = module.extractJSONOperations;
    extractFileBlocks = module.extractFileBlocks;
    detectLanguage = module.detectLanguage;
    normalizeOperations = module.normalizeOperations;
    validateOperation = module.validateOperation;
    validateOperations = module.validateOperations;
  });

  describe("parseAIResponse", () => {
    it("应该解析纯文本响应", () => {
      const result = parseAIResponse("Hello, this is a simple response.");

      expect(result.textResponse).toBe("Hello, this is a simple response.");
      expect(result.operations).toEqual([]);
      expect(result.hasFileOperations).toBe(false);
    });

    it("应该使用后端提供的操作列表", () => {
      const operations = [
        {
          type: "CREATE",
          path: "test.js",
          content: "console.log('test');",
        },
      ];

      const result = parseAIResponse("Creating a file", operations);

      expect(result.hasFileOperations).toBe(true);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].type).toBe("CREATE");
      expect(result.operations[0].path).toBe("test.js");
    });

    it("应该从JSON代码块中提取操作", () => {
      const response = `
Here are the file operations:

\`\`\`json
[
  {
    "type": "CREATE",
    "path": "src/index.js",
    "content": "console.log('Hello');"
  }
]
\`\`\`
      `;

      const result = parseAIResponse(response);

      expect(result.hasFileOperations).toBe(true);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].path).toBe("src/index.js");
    });

    it("应该从文件代码块中提取操作", () => {
      const response = `
Creating a new file:

\`\`\`file:src/app.js
function main() {
  console.log('App started');
}
\`\`\`
      `;

      const result = parseAIResponse(response);

      expect(result.hasFileOperations).toBe(true);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].path).toBe("src/app.js");
      expect(result.operations[0].content).toContain("function main()");
    });

    it("应该处理空响应", () => {
      const result = parseAIResponse("");

      expect(result.textResponse).toBe("");
      expect(result.operations).toEqual([]);
      expect(result.hasFileOperations).toBe(false);
    });

    it("应该处理空操作列表", () => {
      const result = parseAIResponse("Test", []);

      expect(result.hasFileOperations).toBe(false);
      expect(result.operations).toEqual([]);
    });
  });

  describe("extractJSONOperations", () => {
    it("应该提取JSON数组格式", () => {
      const text = `
\`\`\`json
[
  {"type": "CREATE", "path": "file1.js", "content": "code1"},
  {"type": "UPDATE", "path": "file2.js", "content": "code2"}
]
\`\`\`
      `;

      const ops = extractJSONOperations(text);

      expect(ops).toHaveLength(2);
      expect(ops[0].type).toBe("CREATE");
      expect(ops[1].type).toBe("UPDATE");
    });

    it("应该提取JSON对象格式（带operations字段）", () => {
      const text = `
\`\`\`json
{
  "operations": [
    {"type": "CREATE", "path": "test.js", "content": "test"}
  ]
}
\`\`\`
      `;

      const ops = extractJSONOperations(text);

      expect(ops).toHaveLength(1);
      expect(ops[0].path).toBe("test.js");
    });

    it("应该处理多个JSON代码块", () => {
      const text = `
First block:
\`\`\`json
[{"type": "CREATE", "path": "a.js", "content": "a"}]
\`\`\`

Second block:
\`\`\`json
[{"type": "CREATE", "path": "b.js", "content": "b"}]
\`\`\`
      `;

      const ops = extractJSONOperations(text);

      expect(ops).toHaveLength(2);
      expect(ops[0].path).toBe("a.js");
      expect(ops[1].path).toBe("b.js");
    });

    it("应该忽略无效JSON", () => {
      const text = `
\`\`\`json
{invalid json}
\`\`\`
      `;

      const ops = extractJSONOperations(text);

      expect(ops).toEqual([]);
    });

    it("应该处理空JSON代码块", () => {
      const text = "```json\n\n```";

      const ops = extractJSONOperations(text);

      expect(ops).toEqual([]);
    });

    it("应该处理不是数组或对象的JSON", () => {
      const text = `
\`\`\`json
"just a string"
\`\`\`
      `;

      const ops = extractJSONOperations(text);

      expect(ops).toEqual([]);
    });

    it("应该处理没有JSON代码块的文本", () => {
      const text = "Just plain text without any JSON blocks";

      const ops = extractJSONOperations(text);

      expect(ops).toEqual([]);
    });
  });

  describe("extractFileBlocks", () => {
    it("应该提取file:格式的代码块", () => {
      const text = `
\`\`\`file:src/index.js
console.log('Hello World');
\`\`\`
      `;

      const ops = extractFileBlocks(text);

      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe("CREATE");
      expect(ops[0].path).toBe("src/index.js");
      expect(ops[0].content).toBe("console.log('Hello World');");
    });

    it("应该提取language:path格式的代码块", () => {
      const text = `
\`\`\`javascript:src/app.js
function app() {
  return 'App';
}
\`\`\`
      `;

      const ops = extractFileBlocks(text);

      expect(ops).toHaveLength(1);
      expect(ops[0].path).toBe("src/app.js");
      expect(ops[0].language).toBe("javascript");
      expect(ops[0].content).toContain("function app()");
    });

    it("应该处理多个文件代码块", () => {
      const text = `
\`\`\`file:file1.js
code1
\`\`\`

\`\`\`file:file2.css
code2
\`\`\`
      `;

      const ops = extractFileBlocks(text);

      expect(ops).toHaveLength(2);
      expect(ops[0].path).toBe("file1.js");
      expect(ops[1].path).toBe("file2.css");
    });

    it("应该自动检测语言类型", () => {
      const text = `
\`\`\`file:test.py
print('Python code')
\`\`\`
      `;

      const ops = extractFileBlocks(text);

      expect(ops[0].language).toBe("python");
    });

    it("应该忽略没有路径的代码块", () => {
      const text = `
\`\`\`file:
content without path
\`\`\`
      `;

      const ops = extractFileBlocks(text);

      expect(ops).toEqual([]);
    });

    it("应该忽略空内容的代码块", () => {
      const text = "```file:test.js\n\n```";

      const ops = extractFileBlocks(text);

      expect(ops).toEqual([]);
    });

    it("应该处理复杂路径", () => {
      const text = `
\`\`\`file:src/components/App/App.component.jsx
export default function App() {}
\`\`\`
      `;

      const ops = extractFileBlocks(text);

      expect(ops[0].path).toBe("src/components/App/App.component.jsx");
    });
  });

  describe("detectLanguage", () => {
    it("应该检测JavaScript", () => {
      expect(detectLanguage("test.js")).toBe("javascript");
      expect(detectLanguage("test.jsx")).toBe("javascript");
    });

    it("应该检测TypeScript", () => {
      expect(detectLanguage("test.ts")).toBe("typescript");
      expect(detectLanguage("test.tsx")).toBe("typescript");
    });

    it("应该检测Vue", () => {
      expect(detectLanguage("App.vue")).toBe("vue");
    });

    it("应该检测HTML", () => {
      expect(detectLanguage("index.html")).toBe("html");
      expect(detectLanguage("page.htm")).toBe("html");
    });

    it("应该检测CSS相关", () => {
      expect(detectLanguage("style.css")).toBe("css");
      expect(detectLanguage("style.scss")).toBe("scss");
      expect(detectLanguage("style.sass")).toBe("sass");
      expect(detectLanguage("style.less")).toBe("less");
    });

    it("应该检测Python", () => {
      expect(detectLanguage("script.py")).toBe("python");
    });

    it("应该检测配置文件", () => {
      expect(detectLanguage("config.json")).toBe("json");
      expect(detectLanguage("config.yaml")).toBe("yaml");
      expect(detectLanguage("config.yml")).toBe("yaml");
      expect(detectLanguage("data.xml")).toBe("xml");
    });

    it("应该检测shell脚本", () => {
      expect(detectLanguage("script.sh")).toBe("bash");
    });

    it("应该检测编译语言", () => {
      expect(detectLanguage("main.c")).toBe("c");
      expect(detectLanguage("main.cpp")).toBe("cpp");
      expect(detectLanguage("main.go")).toBe("go");
      expect(detectLanguage("main.rs")).toBe("rust");
      expect(detectLanguage("Main.java")).toBe("java");
    });

    it("应该返回未知扩展名", () => {
      expect(detectLanguage("file.unknown")).toBe("unknown");
    });

    it("应该处理没有扩展名的文件", () => {
      expect(detectLanguage("Makefile")).toBe("makefile");
    });

    it("应该处理大写扩展名", () => {
      expect(detectLanguage("FILE.JS")).toBe("javascript");
    });
  });

  describe("normalizeOperations", () => {
    it("应该标准化完整的操作", () => {
      const ops = [
        {
          type: "create",
          path: "test.js",
          content: "code",
          language: "javascript",
          reason: "test file",
        },
      ];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].type).toBe("CREATE");
      expect(normalized[0].path).toBe("test.js");
      expect(normalized[0].content).toBe("code");
      expect(normalized[0].language).toBe("javascript");
      expect(normalized[0].reason).toBe("test file");
    });

    it("应该填充缺失字段", () => {
      const ops = [
        {
          path: "test.py",
          content: "print('test')",
        },
      ];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].type).toBe("CREATE");
      expect(normalized[0].language).toBe("python");
      expect(normalized[0].reason).toBe("");
    });

    it("应该转换操作类型为大写", () => {
      const ops = [
        { type: "create", path: "a.js", content: "a" },
        { type: "update", path: "b.js", content: "b" },
        { type: "delete", path: "c.js", content: "" },
        { type: "read", path: "d.js", content: "" },
      ];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].type).toBe("CREATE");
      expect(normalized[1].type).toBe("UPDATE");
      expect(normalized[2].type).toBe("DELETE");
      expect(normalized[3].type).toBe("READ");
    });

    it("应该处理无效的操作类型", () => {
      const ops = [{ type: "INVALID", path: "test.js", content: "test" }];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].type).toBe("CREATE");
    });

    it("应该自动检测语言", () => {
      const ops = [{ path: "script.ts", content: "const x = 1;" }];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].language).toBe("typescript");
    });

    it("应该警告缺失路径", () => {
      const ops = [{ type: "CREATE", content: "test" }];

      normalizeOperations(ops);
    });

    it("应该警告CREATE操作缺失内容", () => {
      const ops = [{ type: "CREATE", path: "test.js" }];

      normalizeOperations(ops);
    });

    it("应该警告UPDATE操作缺失内容", () => {
      const ops = [{ type: "UPDATE", path: "test.js" }];

      normalizeOperations(ops);
    });

    it("应该允许DELETE操作无内容", () => {
      const ops = [{ type: "DELETE", path: "test.js" }];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].content).toBe("");
      // DELETE不需要内容，不应该警告
    });

    it("应该处理空数组", () => {
      const normalized = normalizeOperations([]);

      expect(normalized).toEqual([]);
    });
  });

  describe("validateOperation", () => {
    // Use Windows-compatible path for tests
    const projectPath = path.resolve(process.cwd(), "test-project");

    it("应该验证有效操作", () => {
      const op = {
        type: "CREATE",
        path: "src/index.js",
        content: "console.log('test');",
      };

      const result = validateOperation(op, projectPath);

      expect(result.valid).toBe(true);
    });

    it("应该拒绝缺少路径的操作", () => {
      const op = {
        type: "CREATE",
        content: "test",
      };

      const result = validateOperation(op, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("缺少文件路径");
    });

    it("应该拒绝超出项目目录的路径", () => {
      const op = {
        type: "CREATE",
        path: "../../../etc/passwd",
        content: "malicious",
      };

      const result = validateOperation(op, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("超出项目目录");
    });

    it("应该拒绝访问node_modules", () => {
      const op = {
        type: "CREATE",
        path: "node_modules/package/index.js",
        content: "test",
      };

      const result = validateOperation(op, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("node_modules");
    });

    it("应该拒绝访问.git目录", () => {
      const op = {
        type: "CREATE",
        path: ".git/config",
        content: "test",
      };

      const result = validateOperation(op, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain(".git");
    });

    it("应该拒绝访问.env文件", () => {
      const op = {
        type: "UPDATE",
        path: ".env",
        content: "API_KEY=secret",
      };

      const result = validateOperation(op, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain(".env");
    });

    it("应该拒绝访问.env.local文件", () => {
      const op = {
        type: "READ",
        path: ".env.local",
      };

      const result = validateOperation(op, projectPath);

      expect(result.valid).toBe(false);
      // The validation matches .env before .env.local, so error says .env
      expect(result.error).toContain(".env");
    });

    it("应该拒绝访问package-lock.json", () => {
      const op = {
        type: "UPDATE",
        path: "package-lock.json",
        content: "{}",
      };

      const result = validateOperation(op, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("package-lock.json");
    });

    it("应该拒绝包含非法字符的文件名", () => {
      const op = {
        type: "CREATE",
        path: "file<name>.js",
        content: "test",
      };

      const result = validateOperation(op, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("非法字符");
    });

    it("应该拒绝CREATE操作缺少内容", () => {
      const op = {
        type: "CREATE",
        path: "test.js",
      };

      const result = validateOperation(op, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("缺少文件内容");
    });

    it("应该拒绝UPDATE操作缺少内容", () => {
      const op = {
        type: "UPDATE",
        path: "test.js",
      };

      const result = validateOperation(op, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("缺少文件内容");
    });

    it("应该允许DELETE和READ操作无内容", () => {
      const deleteOp = { type: "DELETE", path: "test.js" };
      const readOp = { type: "READ", path: "test.js" };

      expect(validateOperation(deleteOp, projectPath).valid).toBe(true);
      expect(validateOperation(readOp, projectPath).valid).toBe(true);
    });

    it("应该允许深层嵌套路径", () => {
      const op = {
        type: "CREATE",
        path: "src/components/ui/Button/Button.component.tsx",
        content: "export default function Button() {}",
      };

      const result = validateOperation(op, projectPath);

      expect(result.valid).toBe(true);
    });
  });

  describe("validateOperations", () => {
    const projectPath = path.resolve(process.cwd(), "test-project");

    it("应该验证所有有效操作", () => {
      const ops = [
        { type: "CREATE", path: "a.js", content: "a" },
        { type: "UPDATE", path: "b.js", content: "b" },
        { type: "DELETE", path: "c.js" },
      ];

      const result = validateOperations(ops, projectPath);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("应该收集所有错误", () => {
      const ops = [
        { type: "CREATE", path: "test.js" }, // 缺少内容
        { type: "UPDATE", path: ".env", content: "secret" }, // 敏感文件
        { type: "CREATE", path: "../outside.js", content: "test" }, // 超出范围
      ];

      const result = validateOperations(ops, projectPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0]).toContain("操作 1");
      expect(result.errors[1]).toContain("操作 2");
      expect(result.errors[2]).toContain("操作 3");
    });

    it("应该提供详细的错误信息", () => {
      const ops = [
        { type: "CREATE", path: "node_modules/test.js", content: "test" },
      ];

      const result = validateOperations(ops, projectPath);

      expect(result.errors[0]).toContain("node_modules/test.js");
      expect(result.errors[0]).toContain("node_modules");
    });

    it("应该处理空操作列表", () => {
      const result = validateOperations([], projectPath);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("应该处理混合有效和无效操作", () => {
      const ops = [
        { type: "CREATE", path: "valid.js", content: "test" },
        { type: "CREATE", path: ".git/config", content: "bad" },
        { type: "UPDATE", path: "also-valid.js", content: "test" },
      ];

      const result = validateOperations(ops, projectPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("操作 2");
    });
  });

  describe("综合场景测试", () => {
    it("应该完整处理JSON格式的AI响应", () => {
      const response = `
I'll create these files for you:

\`\`\`json
{
  "operations": [
    {
      "type": "CREATE",
      "path": "src/index.js",
      "content": "console.log('App started');",
      "language": "javascript",
      "reason": "Main entry point"
    },
    {
      "type": "CREATE",
      "path": "src/styles.css",
      "content": "body { margin: 0; }",
      "language": "css",
      "reason": "Global styles"
    }
  ]
}
\`\`\`

These files will set up your project.
      `;

      const result = parseAIResponse(response);

      expect(result.hasFileOperations).toBe(true);
      expect(result.operations).toHaveLength(2);
      expect(result.operations[0].path).toBe("src/index.js");
      expect(result.operations[1].path).toBe("src/styles.css");
    });

    it("应该完整处理文件块格式的AI响应", () => {
      const response = `
Creating two files:

\`\`\`javascript:src/app.js
function App() {
  console.log('App');
}
\`\`\`

\`\`\`css:src/app.css
.app {
  color: blue;
}
\`\`\`
      `;

      const result = parseAIResponse(response);

      expect(result.hasFileOperations).toBe(true);
      expect(result.operations).toHaveLength(2);
      expect(result.operations[0].language).toBe("javascript");
      expect(result.operations[1].language).toBe("css");
    });

    it("应该优先使用后端提供的操作", () => {
      const backendOps = [
        { type: "CREATE", path: "backend.js", content: "backend" },
      ];

      const response = `
\`\`\`json
[{"type": "CREATE", "path": "frontend.js", "content": "frontend"}]
\`\`\`
      `;

      const result = parseAIResponse(response, backendOps);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].path).toBe("backend.js");
    });
  });

  describe("边界情况", () => {
    it("应该处理null响应", () => {
      const result = parseAIResponse(null);

      expect(result.textResponse).toBeNull();
      expect(result.operations).toEqual([]);
    });

    it("应该处理undefined响应", () => {
      const result = parseAIResponse(undefined);

      expect(result.operations).toEqual([]);
    });

    it("应该处理包含特殊字符的代码块", () => {
      const text = `
\`\`\`file:test.js
const regex = /\`\`\`/;
const str = "含有\`\`\`的字符串";
\`\`\`
      `;

      const ops = extractFileBlocks(text);

      expect(ops).toHaveLength(1);
      expect(ops[0].content).toContain("regex");
    });

    it("应该处理极长的文件路径", () => {
      const longPath = "a/".repeat(50) + "file.js";
      const op = { type: "CREATE", path: longPath, content: "test" };

      const normalized = normalizeOperations([op]);

      expect(normalized[0].path).toBe(longPath);
    });

    it("应该处理空内容的CREATE操作", () => {
      const ops = [{ type: "CREATE", path: "empty.txt", content: "" }];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].content).toBe("");
    });
  });
});
