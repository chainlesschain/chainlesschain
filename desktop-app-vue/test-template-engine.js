/**
 * 模板引擎测试脚本
 * 用于验证模板引擎的核心功能
 */

const { getTemplateEngine } = require('./src/main/engines/template-engine');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(testName) {
  console.log('\n' + '='.repeat(50));
  log(`测试: ${testName}`, 'blue');
  console.log('='.repeat(50));
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

// 测试1: 基本模板渲染
function testBasicRender() {
  logTest('基本模板渲染');

  const templateEngine = getTemplateEngine();

  const template = 'Hello, {{name}}! Welcome to {{project}}.';
  const variables = {
    name: 'Alice',
    project: 'ChainlessChain'
  };

  try {
    const result = templateEngine.render(template, variables);
    console.log('输入模板:', template);
    console.log('输入变量:', variables);
    console.log('渲染结果:', result);

    if (result === 'Hello, Alice! Welcome to ChainlessChain.') {
      logSuccess('基本渲染测试通过');
      return true;
    } else {
      logError('渲染结果不正确');
      return false;
    }
  } catch (error) {
    logError(`渲染失败: ${error.message}`);
    return false;
  }
}

// 测试2: Handlebars Helpers
function testHelpers() {
  logTest('Handlebars Helpers测试');

  const templateEngine = getTemplateEngine();

  const tests = [
    {
      name: '大写转换',
      template: '{{uppercase name}}',
      variables: { name: 'alice' },
      expected: 'ALICE'
    },
    {
      name: '小写转换',
      template: '{{lowercase name}}',
      variables: { name: 'ALICE' },
      expected: 'alice'
    },
    {
      name: '首字母大写',
      template: '{{capitalize name}}',
      variables: { name: 'alice' },
      expected: 'Alice'
    },
    {
      name: '默认值',
      template: '{{default description "无描述"}}',
      variables: { description: '' },
      expected: '无描述'
    }
  ];

  let allPassed = true;

  tests.forEach(test => {
    try {
      const result = templateEngine.render(test.template, test.variables);
      console.log(`\n${test.name}:`);
      console.log('  模板:', test.template);
      console.log('  结果:', result);
      console.log('  期望:', test.expected);

      if (result === test.expected) {
        logSuccess(`${test.name} 通过`);
      } else {
        logError(`${test.name} 失败`);
        allPassed = false;
      }
    } catch (error) {
      logError(`${test.name} 出错: ${error.message}`);
      allPassed = false;
    }
  });

  return allPassed;
}

// 测试3: 变量验证
function testValidation() {
  logTest('变量验证测试');

  const templateEngine = getTemplateEngine();

  const variableDefinitions = [
    {
      name: 'projectName',
      label: '项目名称',
      type: 'text',
      required: true,
      min: 3,
      max: 50
    },
    {
      name: 'author',
      label: '作者',
      type: 'text',
      required: true
    },
    {
      name: 'version',
      label: '版本号',
      type: 'text',
      pattern: '^\\d+\\.\\d+\\.\\d+$'
    },
    {
      name: 'email',
      label: '邮箱',
      type: 'email',
      required: false
    },
    {
      name: 'age',
      label: '年龄',
      type: 'number',
      min: 0,
      max: 150
    }
  ];

  const tests = [
    {
      name: '有效变量',
      variables: {
        projectName: 'MyProject',
        author: 'Alice',
        version: '1.0.0',
        email: 'alice@example.com',
        age: 25
      },
      shouldPass: true
    },
    {
      name: '缺少必填项',
      variables: {
        projectName: 'MyProject'
        // 缺少 author
      },
      shouldPass: false
    },
    {
      name: '项目名称太短',
      variables: {
        projectName: 'AB',
        author: 'Alice'
      },
      shouldPass: false
    },
    {
      name: '版本号格式错误',
      variables: {
        projectName: 'MyProject',
        author: 'Alice',
        version: '1.0'
      },
      shouldPass: false
    },
    {
      name: '邮箱格式错误',
      variables: {
        projectName: 'MyProject',
        author: 'Alice',
        email: 'invalid-email'
      },
      shouldPass: false
    },
    {
      name: '年龄超出范围',
      variables: {
        projectName: 'MyProject',
        author: 'Alice',
        age: 200
      },
      shouldPass: false
    }
  ];

  let allPassed = true;

  tests.forEach(test => {
    console.log(`\n${test.name}:`);
    const validation = templateEngine.validateVariables(variableDefinitions, test.variables);

    console.log('  验证结果:', validation.valid ? '通过' : '失败');
    if (!validation.valid) {
      console.log('  错误信息:', validation.errors);
    }

    if (validation.valid === test.shouldPass) {
      logSuccess(`${test.name} - 符合预期`);
    } else {
      logError(`${test.name} - 不符合预期`);
      allPassed = false;
    }
  });

  return allPassed;
}

// 测试4: 变量提取
function testExtractVariables() {
  logTest('变量提取测试');

  const templateEngine = getTemplateEngine();

  const template = `
# {{projectName}}

作者: {{author}}
邮箱: {{email}}
版本: {{version}}

## 描述

{{description}}

创建时间: {{_system.date}}
  `;

  try {
    const variables = templateEngine.extractVariables(template);
    console.log('模板:', template);
    console.log('提取的变量:', variables);

    const expectedVars = ['projectName', 'author', 'email', 'version', 'description'];
    const allFound = expectedVars.every(v => variables.includes(v));

    if (allFound && !variables.includes('_system.date')) {
      logSuccess('变量提取测试通过');
      return true;
    } else {
      logError('变量提取不完整或包含系统变量');
      return false;
    }
  } catch (error) {
    logError(`变量提取失败: ${error.message}`);
    return false;
  }
}

// 测试5: 获取默认值
function testGetDefaultVariables() {
  logTest('获取默认值测试');

  const templateEngine = getTemplateEngine();

  const variableDefinitions = [
    {
      name: 'projectName',
      type: 'text',
      default: 'MyProject'
    },
    {
      name: 'author',
      type: 'text',
      default: '{{user.name}}'
    },
    {
      name: 'version',
      type: 'text',
      default: '1.0.0'
    },
    {
      name: 'enabled',
      type: 'switch',
      default: true
    },
    {
      name: 'count',
      type: 'number'
      // 无默认值
    }
  ];

  try {
    const defaults = templateEngine.getDefaultVariables(variableDefinitions);
    console.log('变量定义:', variableDefinitions);
    console.log('默认值:', defaults);

    if (defaults.projectName === 'MyProject' &&
        defaults.version === '1.0.0' &&
        defaults.enabled === true &&
        defaults.count === 0) {
      logSuccess('默认值测试通过');
      return true;
    } else {
      logError('默认值不正确');
      return false;
    }
  } catch (error) {
    logError(`获取默认值失败: ${error.message}`);
    return false;
  }
}

// 测试6: 完整模板测试
function testFullTemplate() {
  logTest('完整模板测试（README生成）');

  const templateEngine = getTemplateEngine();

  const template = `# {{projectName}}

> {{description}}

## 项目信息

- **作者**: {{author}}
- **版本**: {{version}}
- **创建时间**: {{formatDate _system.date "yyyy年MM月dd日"}}

## 技术栈

{{#each techStack}}
- {{this}}
{{/each}}

## 许可证

{{license}}
`;

  const variables = {
    projectName: 'ChainlessChain',
    description: '去中心化个人AI管理系统',
    author: 'Alice',
    version: '1.0.0',
    techStack: ['Electron', 'Vue 3', 'Node.js'],
    license: 'MIT',
    _system: {
      date: new Date().toISOString()
    }
  };

  try {
    const result = templateEngine.render(template, variables);
    console.log('渲染结果:');
    console.log(result);

    if (result.includes('ChainlessChain') &&
        result.includes('Alice') &&
        result.includes('Electron') &&
        result.includes('MIT')) {
      logSuccess('完整模板测试通过');
      return true;
    } else {
      logError('模板内容不完整');
      return false;
    }
  } catch (error) {
    logError(`模板渲染失败: ${error.message}`);
    return false;
  }
}

// 运行所有测试
async function runAllTests() {
  console.log('\n');
  log('╔═════════════════════════════════════════════════╗', 'blue');
  log('║       ChainlessChain 模板引擎测试套件         ║', 'blue');
  log('╚═════════════════════════════════════════════════╝', 'blue');
  console.log('\n');

  const tests = [
    { name: '基本模板渲染', fn: testBasicRender },
    { name: 'Handlebars Helpers', fn: testHelpers },
    { name: '变量验证', fn: testValidation },
    { name: '变量提取', fn: testExtractVariables },
    { name: '获取默认值', fn: testGetDefaultVariables },
    { name: '完整模板', fn: testFullTemplate }
  ];

  const results = [];

  for (const test of tests) {
    try {
      const passed = test.fn();
      results.push({ name: test.name, passed });
    } catch (error) {
      console.error(`测试 ${test.name} 出错:`, error);
      results.push({ name: test.name, passed: false });
    }
  }

  // 输出总结
  console.log('\n');
  log('╔═════════════════════════════════════════════════╗', 'blue');
  log('║                  测试总结                       ║', 'blue');
  log('╚═════════════════════════════════════════════════╝', 'blue');
  console.log('\n');

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  results.forEach(result => {
    if (result.passed) {
      logSuccess(`${result.name}`);
    } else {
      logError(`${result.name}`);
    }
  });

  console.log('\n');
  if (passed === total) {
    log(`所有测试通过! (${passed}/${total})`, 'green');
  } else {
    log(`部分测试失败: ${passed}/${total} 通过`, 'yellow');
  }
  console.log('\n');

  return passed === total;
}

// 执行测试
if (require.main === module) {
  runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('测试运行出错:', error);
      process.exit(1);
    });
}

module.exports = { runAllTests };
