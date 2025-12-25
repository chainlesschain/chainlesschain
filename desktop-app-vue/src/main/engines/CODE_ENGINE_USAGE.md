# 代码引擎使用指南

代码引擎已全面增强，新增多项强大功能。

## 新增功能概览

### 1. 流式输出和进度反馈

```javascript
const { getCodeEngine } = require('./code-engine');
const codeEngine = getCodeEngine();

await codeEngine.initialize();

// 使用流式输出和进度回调
const result = await codeEngine.generateCode('创建一个用户登录函数', {
  language: 'javascript',
  streaming: true,
  onProgress: (progress) => {
    console.log(`[${progress.stage}] ${progress.progress}%`);
    if (progress.content) {
      console.log(progress.content);
    }
  }
});
```

### 2. 代码格式化和美化

```javascript
// 格式化代码
const result = await codeEngine.formatCode(
  `function test(){console.log("hello")}`,
  'javascript',
  {
    style: 'prettier',      // standard, prettier, airbnb, google
    indentSize: 2,
    useTabs: false,
    semicolons: true,
    singleQuotes: true
  }
);

console.log(result.formattedCode);
```

### 3. 代码复杂度分析

```javascript
// 分析代码复杂度
const analysis = await codeEngine.analyzeComplexity(code, 'javascript');

console.log('圈复杂度:', analysis.metrics.cyclomaticComplexity);
console.log('认知复杂度:', analysis.metrics.cognitiveComplexity);
console.log('时间复杂度:', analysis.metrics.timeComplexity);
console.log('空间复杂度:', analysis.metrics.spaceComplexity);
console.log('综合评分:', analysis.metrics.score);
```

### 4. 安全漏洞扫描

```javascript
// 扫描安全漏洞
const security = await codeEngine.scanSecurity(code, 'javascript');

console.log('安全等级:', security.securityLevel); // critical, medium, low, safe
console.log('安全评分:', security.score);

security.vulnerabilities.forEach(vuln => {
  console.log(`漏洞: ${vuln.type}`);
  console.log(`严重程度: ${vuln.severity}`);
  console.log(`位置: ${vuln.location}`);
  console.log(`修复建议: ${vuln.recommendation}`);
});

console.log('修复后的代码:', security.fixedCode);
```

### 5. 代码转换/迁移

```javascript
// JavaScript 转 TypeScript
const result = await codeEngine.convertCode(
  jsCode,
  'javascript',
  'typescript',
  {
    preserveComments: true,
    modernize: true
  }
);

// Python 2 转 Python 3
const result = await codeEngine.convertCode(
  py2Code,
  'python2',
  'python3'
);

// React 类组件转 Hooks
const result = await codeEngine.convertCode(
  classComponent,
  'class',
  'hooks'
);

// Promise 转 async/await
const result = await codeEngine.convertCode(
  promiseCode,
  'promise',
  'async'
);

console.log(result.convertedCode);
console.log(result.explanation);
```

### 6. 增强的代码审查

```javascript
// 全面代码审查（整合复杂度分析和安全扫描）
const review = await codeEngine.reviewCode(code, 'javascript', {
  includeComplexity: true,    // 包含复杂度分析
  includeSecurity: true,       // 包含安全扫描
  detailed: true
});

console.log('综合评分:', review.finalScore);

// 基础审查结果
console.log('代码质量评分:', review.basicReview.score);

// 复杂度分析
console.log('圈复杂度:', review.complexity.metrics.cyclomaticComplexity);

// 安全分析
console.log('安全等级:', review.security.securityLevel);
console.log('发现的漏洞:', review.security.vulnerabilities.length);

// 综合建议
review.suggestions.forEach(s => {
  console.log(`[${s.priority}] ${s.issue}: ${s.advice}`);
});

console.log('改进后的代码:', review.improvedCode);
```

### 7. 集成测试生成

```javascript
// 生成集成测试
const tests = await codeEngine.generateIntegrationTests(
  code,
  'javascript',
  {
    framework: 'Jest',
    testScenarios: [
      '测试用户注册流程',
      '测试数据库事务回滚',
      '测试外部API集成'
    ]
  }
);

console.log(tests.tests);
```

### 8. E2E 测试生成

```javascript
// 生成 E2E 测试
const e2eTests = await codeEngine.generateE2ETests(
  '用户登录和购物流程',
  'cypress',
  {
    baseUrl: 'http://localhost:3000',
    userFlows: [
      '用户访问首页',
      '点击登录按钮',
      '输入用户名和密码',
      '登录成功后跳转到商品列表',
      '选择商品加入购物车',
      '完成结账'
    ]
  }
);

console.log(e2eTests.tests);
```

### 9. 完善的项目脚手架

```javascript
// 生成 React 项目
const react = await codeEngine.generateScaffold('react_app', {
  projectName: 'my-react-app'
});

// 生成 Vue 项目
const vue = await codeEngine.generateScaffold('vue_app', {
  projectName: 'my-vue-app'
});

// 生成 Next.js 项目
const nextjs = await codeEngine.generateScaffold('nextjs_app', {
  projectName: 'my-nextjs-app'
});

// 生成 Express API
const express = await codeEngine.generateScaffold('express_api', {
  projectName: 'my-api'
});

// 生成 FastAPI 项目
const fastapi = await codeEngine.generateScaffold('fastapi_app', {
  projectName: 'my-fastapi'
});

// 写入文件
const fs = require('fs').promises;
const path = require('path');

for (const file of react.files) {
  const filePath = path.join('./my-react-app', file.path);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, file.content, 'utf-8');
}
```

## 完整工作流示例

```javascript
const { getCodeEngine } = require('./code-engine');

async function fullWorkflow() {
  const codeEngine = getCodeEngine();
  await codeEngine.initialize();

  // 1. 生成代码
  console.log('=== 1. 生成代码 ===');
  const generated = await codeEngine.generateCode(
    '创建一个用户认证函数，支持JWT令牌',
    {
      language: 'javascript',
      framework: 'Express',
      includeTests: false,
      streaming: true,
      onProgress: (p) => console.log(`${p.stage}: ${p.progress}%`)
    }
  );

  const code = generated.code;
  console.log('生成的代码:', code);

  // 2. 格式化代码
  console.log('\n=== 2. 格式化代码 ===');
  const formatted = await codeEngine.formatCode(code, 'javascript', {
    style: 'prettier'
  });

  // 3. 复杂度分析
  console.log('\n=== 3. 复杂度分析 ===');
  const complexity = await codeEngine.analyzeComplexity(
    formatted.formattedCode,
    'javascript'
  );
  console.log('复杂度评分:', complexity.metrics.score);

  // 4. 安全扫描
  console.log('\n=== 4. 安全扫描 ===');
  const security = await codeEngine.scanSecurity(
    formatted.formattedCode,
    'javascript'
  );
  console.log('安全等级:', security.securityLevel);
  console.log('发现漏洞数:', security.vulnerabilities.length);

  // 5. 全面审查
  console.log('\n=== 5. 全面代码审查 ===');
  const review = await codeEngine.reviewCode(
    formatted.formattedCode,
    'javascript',
    {
      includeComplexity: true,
      includeSecurity: true
    }
  );
  console.log('综合评分:', review.finalScore);

  // 6. 生成测试
  console.log('\n=== 6. 生成单元测试 ===');
  const unitTests = await codeEngine.generateTests(
    review.improvedCode || formatted.formattedCode,
    'javascript'
  );

  console.log('\n=== 7. 生成集成测试 ===');
  const integrationTests = await codeEngine.generateIntegrationTests(
    review.improvedCode || formatted.formattedCode,
    'javascript',
    {
      testScenarios: ['测试JWT生成', '测试令牌验证', '测试过期处理']
    }
  );

  // 7. 如果需要，转换为 TypeScript
  console.log('\n=== 8. 转换为 TypeScript ===');
  const tsCode = await codeEngine.convertCode(
    review.improvedCode || formatted.formattedCode,
    'javascript',
    'typescript',
    { modernize: true }
  );

  console.log('\n=== 完成！===');
  console.log('最终代码已生成、审查、测试并转换为TypeScript');

  return {
    code: tsCode.convertedCode,
    tests: {
      unit: unitTests,
      integration: integrationTests.tests
    },
    analysis: {
      complexity: complexity.metrics,
      security: security
    }
  };
}

// 运行完整工作流
fullWorkflow().catch(console.error);
```

## 支持的编程语言

- JavaScript
- TypeScript
- Python
- Java
- C++
- Go
- Rust
- C#

## 支持的项目模板

- `express_api` - Express API 服务器
- `react_app` - React 应用（Vite）
- `vue_app` - Vue 3 应用（Vite）
- `nextjs_app` - Next.js 13+ 应用
- `fastapi_app` - FastAPI 后端服务

## API 参考

### 核心方法

#### `generateCode(description, options)`
生成代码，支持流式输出

#### `formatCode(code, language, options)`
格式化和美化代码

#### `analyzeComplexity(code, language)`
分析代码复杂度

#### `scanSecurity(code, language)`
扫描安全漏洞

#### `convertCode(code, fromLang, toLang, options)`
转换代码语言/模式

#### `reviewCode(code, language, options)`
全面代码审查（整合复杂度和安全）

#### `generateTests(code, language, options)`
生成单元测试

#### `generateIntegrationTests(code, language, options)`
生成集成测试

#### `generateE2ETests(description, framework, options)`
生成端到端测试

#### `generateScaffold(projectType, options)`
生成项目脚手架

#### `refactorCode(code, language, refactoringType)`
代码重构

#### `explainCode(code, language)`
解释代码功能

#### `fixBug(code, language, errorMessage)`
修复代码 Bug

## 注意事项

1. 使用前必须先调用 `initialize()` 初始化引擎
2. 所有方法都是异步的，返回 Promise
3. 复杂度分析和安全扫描需要较长时间，建议使用进度回调
4. 流式输出需要 LLM 管理器支持 `queryStream` 方法
5. 生成的代码仅供参考，建议人工审查后使用

## 性能优化建议

1. 使用 `streaming: true` 获得更好的交互体验
2. 对于大型代码，分块处理以提高性能
3. 缓存常用的分析结果
4. 并行执行独立的分析任务

## 更新日志

### v2.0.0 (2025-12-25)

**新增功能:**
- ✅ 流式输出和进度反馈
- ✅ 代码格式化和美化
- ✅ 代码复杂度分析
- ✅ 安全漏洞扫描
- ✅ 代码转换/迁移
- ✅ 集成测试和 E2E 测试生成
- ✅ 完善的项目脚手架（React, Vue, Next.js, FastAPI）

**增强功能:**
- ✅ 代码审查整合复杂度和安全分析
- ✅ 并行执行多个分析任务
- ✅ 综合评分系统

---

**ChainlessChain Code Engine v2.0**

生成于 2025-12-25
