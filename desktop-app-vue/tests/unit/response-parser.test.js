/**
 * ResponseParser 测试
 * 测试覆盖：
 * 1. AI响应解析
 * 2. JSON操作提取
 * 3. 文件代码块提取
 * 4. 语言检测
 * 5. 操作标准化
 * 6. 操作验证
 * 7. 安全性检查
 * 8. 边缘情况处理
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseAIResponse,
  extractJSONOperations,
  extractFileBlocks,
  detectLanguage,
  normalizeOperations,
  validateOperation,
  validateOperations
} from '../../src/main/ai-engine/response-parser.js';

describe('ResponseParser', () => {
  // ==================== parseAIResponse 测试 ====================
  describe('parseAIResponse', () => {
    it('should parse response with backend operations', () => {
      const operations = [
        { type: 'CREATE', path: 'test.js', content: 'console.log("test")' }
      ];

      const result = parseAIResponse('AI response text', operations);

      expect(result.textResponse).toBe('AI response text');
      expect(result.operations).toHaveLength(1);
      expect(result.hasFileOperations).toBe(true);
      expect(result.operations[0].type).toBe('CREATE');
    });

    it('should parse response with JSON code blocks', () => {
      const responseText = `
Here are the operations:
\`\`\`json
[
  {
    "type": "CREATE",
    "path": "index.html",
    "content": "<html></html>"
  }
]
\`\`\`
      `;

      const result = parseAIResponse(responseText);

      expect(result.hasFileOperations).toBe(true);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].path).toBe('index.html');
    });

    it('should parse response with file code blocks', () => {
      const responseText = `
Creating a new file:
\`\`\`file:src/app.js
function main() {
  console.log("Hello");
}
\`\`\`
      `;

      const result = parseAIResponse(responseText);

      expect(result.hasFileOperations).toBe(true);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].path).toBe('src/app.js');
    });

    it('should return text-only response when no operations found', () => {
      const responseText = 'This is just text with no operations';

      const result = parseAIResponse(responseText);

      expect(result.textResponse).toBe(responseText);
      expect(result.operations).toHaveLength(0);
      expect(result.hasFileOperations).toBe(false);
    });

    it('should prioritize backend operations over parsed operations', () => {
      const backendOps = [
        { type: 'CREATE', path: 'backend.js', content: 'backend code' }
      ];

      const responseText = `
\`\`\`json
[{"type": "CREATE", "path": "ignored.js", "content": "ignored"}]
\`\`\`
      `;

      const result = parseAIResponse(responseText, backendOps);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].path).toBe('backend.js');
    });

    it('should handle empty response text', () => {
      const result = parseAIResponse('');

      expect(result.textResponse).toBe('');
      expect(result.operations).toHaveLength(0);
      expect(result.hasFileOperations).toBe(false);
    });

    it('should handle null operations array', () => {
      const result = parseAIResponse('text', null);

      expect(result.operations).toHaveLength(0);
    });

    it('should handle undefined operations array', () => {
      const result = parseAIResponse('text', undefined);

      expect(result.operations).toHaveLength(0);
    });
  });

  // ==================== extractJSONOperations 测试 ====================
  describe('extractJSONOperations', () => {
    it('should extract JSON array operations', () => {
      const text = `
\`\`\`json
[
  {"type": "CREATE", "path": "file1.js", "content": "code1"},
  {"type": "UPDATE", "path": "file2.js", "content": "code2"}
]
\`\`\`
      `;

      const operations = extractJSONOperations(text);

      expect(operations).toHaveLength(2);
      expect(operations[0].type).toBe('CREATE');
      expect(operations[1].type).toBe('UPDATE');
    });

    it('should extract JSON with operations wrapper', () => {
      const text = `
\`\`\`json
{
  "operations": [
    {"type": "CREATE", "path": "test.js", "content": "test"}
  ]
}
\`\`\`
      `;

      const operations = extractJSONOperations(text);

      expect(operations).toHaveLength(1);
      expect(operations[0].path).toBe('test.js');
    });

    it('should extract multiple JSON blocks', () => {
      const text = `
First block:
\`\`\`json
[{"type": "CREATE", "path": "file1.js", "content": "c1"}]
\`\`\`

Second block:
\`\`\`json
[{"type": "CREATE", "path": "file2.js", "content": "c2"}]
\`\`\`
      `;

      const operations = extractJSONOperations(text);

      expect(operations).toHaveLength(2);
      expect(operations[0].path).toBe('file1.js');
      expect(operations[1].path).toBe('file2.js');
    });

    it('should handle invalid JSON gracefully', () => {
      const text = `
\`\`\`json
{invalid json content}
\`\`\`
      `;

      const operations = extractJSONOperations(text);

      expect(operations).toHaveLength(0);
    });

    it('should handle empty JSON array', () => {
      const text = `
\`\`\`json
[]
\`\`\`
      `;

      const operations = extractJSONOperations(text);

      expect(operations).toHaveLength(0);
    });

    it('should handle JSON with extra whitespace', () => {
      const text = `
\`\`\`json

  [
    {
      "type": "CREATE",
      "path": "test.js",
      "content": "test"
    }
  ]

\`\`\`
      `;

      const operations = extractJSONOperations(text);

      expect(operations).toHaveLength(1);
    });

    it('should ignore non-JSON code blocks', () => {
      const text = `
\`\`\`javascript
const x = 1;
\`\`\`
      `;

      const operations = extractJSONOperations(text);

      expect(operations).toHaveLength(0);
    });
  });

  // ==================== extractFileBlocks 测试 ====================
  describe('extractFileBlocks', () => {
    it('should extract file block with file: prefix', () => {
      const text = `
\`\`\`file:src/index.js
console.log("Hello");
\`\`\`
      `;

      const operations = extractFileBlocks(text);

      expect(operations).toHaveLength(1);
      expect(operations[0].type).toBe('CREATE');
      expect(operations[0].path).toBe('src/index.js');
      expect(operations[0].content).toBe('console.log("Hello");');
    });

    it('should extract file block with language prefix', () => {
      const text = `
\`\`\`javascript:src/app.js
function main() {}
\`\`\`
      `;

      const operations = extractFileBlocks(text);

      expect(operations).toHaveLength(1);
      expect(operations[0].language).toBe('javascript');
      expect(operations[0].path).toBe('src/app.js');
      expect(operations[0].content).toBe('function main() {}');
    });

    it('should extract multiple file blocks', () => {
      const text = `
\`\`\`file:file1.js
code1
\`\`\`

\`\`\`file:file2.css
code2
\`\`\`
      `;

      const operations = extractFileBlocks(text);

      expect(operations).toHaveLength(2);
      expect(operations[0].path).toBe('file1.js');
      expect(operations[1].path).toBe('file2.css');
    });

    it('should detect language from file extension', () => {
      const text = `
\`\`\`file:test.py
print("hello")
\`\`\`
      `;

      const operations = extractFileBlocks(text);

      expect(operations[0].language).toBe('python');
    });

    it('should handle file blocks with empty content', () => {
      const text = `
\`\`\`file:empty.js

\`\`\`
      `;

      const operations = extractFileBlocks(text);

      // Empty content should not create an operation
      expect(operations).toHaveLength(0);
    });

    it('should handle file blocks with multiline content', () => {
      const text = `
\`\`\`file:multi.js
line1
line2
line3
\`\`\`
      `;

      const operations = extractFileBlocks(text);

      expect(operations[0].content).toBe('line1\nline2\nline3');
    });

    it('should ignore blocks without file path', () => {
      const text = `
\`\`\`javascript
const x = 1;
\`\`\`
      `;

      const operations = extractFileBlocks(text);

      expect(operations).toHaveLength(0);
    });
  });

  // ==================== detectLanguage 测试 ====================
  describe('detectLanguage', () => {
    it('should detect JavaScript', () => {
      expect(detectLanguage('test.js')).toBe('javascript');
      expect(detectLanguage('app.jsx')).toBe('javascript');
    });

    it('should detect TypeScript', () => {
      expect(detectLanguage('component.ts')).toBe('typescript');
      expect(detectLanguage('App.tsx')).toBe('typescript');
    });

    it('should detect Vue', () => {
      expect(detectLanguage('Component.vue')).toBe('vue');
    });

    it('should detect HTML', () => {
      expect(detectLanguage('index.html')).toBe('html');
      expect(detectLanguage('page.htm')).toBe('html');
    });

    it('should detect CSS and variants', () => {
      expect(detectLanguage('style.css')).toBe('css');
      expect(detectLanguage('style.scss')).toBe('scss');
      expect(detectLanguage('style.sass')).toBe('sass');
      expect(detectLanguage('style.less')).toBe('less');
    });

    it('should detect JSON', () => {
      expect(detectLanguage('config.json')).toBe('json');
    });

    it('should detect Markdown', () => {
      expect(detectLanguage('README.md')).toBe('markdown');
    });

    it('should detect Python', () => {
      expect(detectLanguage('script.py')).toBe('python');
    });

    it('should detect Java', () => {
      expect(detectLanguage('Main.java')).toBe('java');
    });

    it('should detect C/C++', () => {
      expect(detectLanguage('main.c')).toBe('c');
      expect(detectLanguage('app.cpp')).toBe('cpp');
    });

    it('should detect Go', () => {
      expect(detectLanguage('main.go')).toBe('go');
    });

    it('should detect Rust', () => {
      expect(detectLanguage('main.rs')).toBe('rust');
    });

    it('should detect Shell', () => {
      expect(detectLanguage('script.sh')).toBe('bash');
    });

    it('should detect YAML', () => {
      expect(detectLanguage('config.yaml')).toBe('yaml');
      expect(detectLanguage('config.yml')).toBe('yaml');
    });

    it('should detect XML', () => {
      expect(detectLanguage('config.xml')).toBe('xml');
    });

    it('should detect SQL', () => {
      expect(detectLanguage('query.sql')).toBe('sql');
    });

    it('should return extension for unknown types', () => {
      expect(detectLanguage('file.unknown')).toBe('unknown');
    });

    it('should handle case insensitivity', () => {
      expect(detectLanguage('FILE.JS')).toBe('javascript');
      expect(detectLanguage('Style.CSS')).toBe('css');
    });

    it('should handle files with multiple dots', () => {
      expect(detectLanguage('my.test.js')).toBe('javascript');
    });

    it('should handle path with directories', () => {
      expect(detectLanguage('src/components/App.vue')).toBe('vue');
    });
  });

  // ==================== normalizeOperations 测试 ====================
  describe('normalizeOperations', () => {
    it('should normalize operation types to uppercase', () => {
      const ops = [
        { type: 'create', path: 'file.js', content: 'code' },
        { type: 'update', path: 'file2.js', content: 'code2' }
      ];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].type).toBe('CREATE');
      expect(normalized[1].type).toBe('UPDATE');
    });

    it('should add default type if missing', () => {
      const ops = [{ path: 'file.js', content: 'code' }];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].type).toBe('CREATE');
    });

    it('should detect language from path', () => {
      const ops = [{ type: 'CREATE', path: 'test.py', content: 'code' }];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].language).toBe('python');
    });

    it('should preserve existing language', () => {
      const ops = [
        { type: 'CREATE', path: 'test.js', content: 'code', language: 'typescript' }
      ];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].language).toBe('typescript');
    });

    it('should add empty content for missing content', () => {
      const ops = [{ type: 'CREATE', path: 'file.js' }];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].content).toBe('');
    });

    it('should preserve reason field', () => {
      const ops = [
        { type: 'CREATE', path: 'file.js', content: 'code', reason: 'Test reason' }
      ];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].reason).toBe('Test reason');
    });

    it('should add empty reason if missing', () => {
      const ops = [{ type: 'CREATE', path: 'file.js', content: 'code' }];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].reason).toBe('');
    });

    it('should handle invalid operation types', () => {
      const ops = [{ type: 'INVALID', path: 'file.js', content: 'code' }];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].type).toBe('CREATE');
    });

    it('should warn for CREATE/UPDATE operations without content', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const ops = [{ type: 'CREATE', path: 'file.js' }];
      normalizeOperations(ops);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle operations with empty path', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const ops = [{ type: 'CREATE', content: 'code' }];
      normalizeOperations(ops);

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should handle valid DELETE operation without content', () => {
      const ops = [{ type: 'DELETE', path: 'file.js' }];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].type).toBe('DELETE');
      expect(normalized[0].content).toBe('');
    });

    it('should handle valid READ operation without content', () => {
      const ops = [{ type: 'READ', path: 'file.js' }];

      const normalized = normalizeOperations(ops);

      expect(normalized[0].type).toBe('READ');
      expect(normalized[0].content).toBe('');
    });
  });

  // ==================== validateOperation 测试 ====================
  describe('validateOperation', () => {
    const projectPath = '/project/root';

    it('should validate valid CREATE operation', () => {
      const operation = {
        type: 'CREATE',
        path: 'src/app.js',
        content: 'console.log("test");'
      };

      const result = validateOperation(operation, projectPath);

      expect(result.valid).toBe(true);
    });

    it('should reject operation without path', () => {
      const operation = { type: 'CREATE', content: 'code' };

      const result = validateOperation(operation, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('缺少文件路径');
    });

    it('should reject path outside project directory', () => {
      const operation = {
        type: 'CREATE',
        path: '../../../etc/passwd',
        content: 'malicious'
      };

      const result = validateOperation(operation, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('超出项目目录');
    });

    it('should reject access to node_modules', () => {
      const operation = {
        type: 'CREATE',
        path: 'node_modules/package/index.js',
        content: 'code'
      };

      const result = validateOperation(operation, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('node_modules');
    });

    it('should reject access to .git directory', () => {
      const operation = {
        type: 'CREATE',
        path: '.git/config',
        content: 'malicious'
      };

      const result = validateOperation(operation, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('.git');
    });

    it('should reject access to .env files', () => {
      const operation = {
        type: 'CREATE',
        path: '.env',
        content: 'API_KEY=secret'
      };

      const result = validateOperation(operation, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('.env');
    });

    it('should reject file names with invalid characters', () => {
      const operation = {
        type: 'CREATE',
        path: 'file<invalid>.js',
        content: 'code'
      };

      const result = validateOperation(operation, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('非法字符');
    });

    it('should reject CREATE without content', () => {
      const operation = { type: 'CREATE', path: 'file.js' };

      const result = validateOperation(operation, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('缺少文件内容');
    });

    it('should reject UPDATE without content', () => {
      const operation = { type: 'UPDATE', path: 'file.js' };

      const result = validateOperation(operation, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('缺少文件内容');
    });

    it('should allow DELETE without content', () => {
      const operation = { type: 'DELETE', path: 'file.js' };

      const result = validateOperation(operation, projectPath);

      expect(result.valid).toBe(true);
    });

    it('should allow READ without content', () => {
      const operation = { type: 'READ', path: 'file.js' };

      const result = validateOperation(operation, projectPath);

      expect(result.valid).toBe(true);
    });

    it('should reject access to package-lock.json', () => {
      const operation = {
        type: 'UPDATE',
        path: 'package-lock.json',
        content: '{}'
      };

      const result = validateOperation(operation, projectPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('package-lock.json');
    });
  });

  // ==================== validateOperations 测试 ====================
  describe('validateOperations', () => {
    const projectPath = '/project/root';

    it('should validate all valid operations', () => {
      const operations = [
        { type: 'CREATE', path: 'file1.js', content: 'code1' },
        { type: 'CREATE', path: 'file2.js', content: 'code2' }
      ];

      const result = validateOperations(operations, projectPath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should collect all errors from invalid operations', () => {
      const operations = [
        { type: 'CREATE', path: 'file1.js' }, // Missing content
        { type: 'CREATE', content: 'code' }, // Missing path
        { type: 'CREATE', path: '../../../etc/passwd', content: 'malicious' } // Outside project
      ];

      const result = validateOperations(operations, projectPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
    });

    it('should handle empty operations array', () => {
      const result = validateOperations([], projectPath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should include operation index in error messages', () => {
      const operations = [
        { type: 'CREATE', path: 'valid.js', content: 'code' },
        { type: 'CREATE', path: 'invalid<>.js', content: 'code' }
      ];

      const result = validateOperations(operations, projectPath);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('操作 2');
    });

    it('should handle mix of valid and invalid operations', () => {
      const operations = [
        { type: 'CREATE', path: 'valid.js', content: 'code' },
        { type: 'CREATE', path: '.env', content: 'secret' },
        { type: 'DELETE', path: 'file.js' }
      ];

      const result = validateOperations(operations, projectPath);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('操作 2');
    });
  });

  // ==================== 边缘情况测试 ====================
  describe('边缘情况', () => {
    it('should handle response with mixed content types', () => {
      const responseText = `
Some text here

\`\`\`json
[{"type": "CREATE", "path": "from-json.js", "content": "json code"}]
\`\`\`

More text

\`\`\`file:from-file.js
file code
\`\`\`
      `;

      const result = parseAIResponse(responseText);

      // Should prioritize JSON blocks over file blocks
      expect(result.hasFileOperations).toBe(true);
      expect(result.operations.length).toBeGreaterThan(0);
    });

    it('should handle malformed JSON gracefully', () => {
      const responseText = `
\`\`\`json
{type: "CREATE", path: "file.js"}
\`\`\`
      `;

      const result = parseAIResponse(responseText);

      expect(result.operations).toHaveLength(0);
    });

    it('should handle code blocks with special characters', () => {
      const responseText = `
\`\`\`file:test.js
const str = "Hello \\"World\\"";
const regex = /[\\w\\d]+/g;
\`\`\`
      `;

      const result = parseAIResponse(responseText);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].content).toContain('Hello \\"World\\"');
    });

    it('should handle very long file paths', () => {
      const longPath = 'a/'.repeat(100) + 'file.js';
      const operation = { type: 'CREATE', path: longPath, content: 'code' };

      const normalized = normalizeOperations([operation]);

      expect(normalized[0].path).toBe(longPath);
    });

    it('should handle Unicode in file content', () => {
      const text = `
\`\`\`file:unicode.js
const emoji = "🚀";
const chinese = "你好世界";
\`\`\`
      `;

      const result = parseAIResponse(text);

      expect(result.operations[0].content).toContain('🚀');
      expect(result.operations[0].content).toContain('你好世界');
    });

    it('should handle nested code blocks in content', () => {
      const text = `
\`\`\`file:markdown.md
Here is some code:
\\\`\\\`\\\`javascript
console.log("nested");
\\\`\\\`\\\`
\`\`\`
      `;

      const result = parseAIResponse(text);

      expect(result.operations).toHaveLength(1);
    });

    it('should handle operations with relative paths', () => {
      const operation = {
        type: 'CREATE',
        path: './src/app.js',
        content: 'code'
      };

      const result = validateOperation(operation, '/project/root');

      expect(result.valid).toBe(true);
    });

    it('should handle Windows-style paths', () => {
      const operation = {
        type: 'CREATE',
        path: 'src\\components\\App.vue',
        content: 'code'
      };

      const normalized = normalizeOperations([operation]);

      expect(normalized[0].path).toBe('src\\components\\App.vue');
    });
  });
});
