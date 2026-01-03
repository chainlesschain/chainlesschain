# ChainlessChain 自动化测试指南

**版本**: 1.0.0
**更新日期**: 2025-12-25

---

## 📋 目录

- [测试概述](#测试概述)
- [快速开始](#快速开始)
- [测试类型](#测试类型)
- [运行测试](#运行测试)
- [编写测试](#编写测试)
- [测试覆盖率](#测试覆盖率)
- [持续集成](#持续集成)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)

---

## 测试概述

ChainlessChain使用**Vitest**作为测试框架，提供完整的自动化测试体系：

| 测试类型 | 目的 | 工具 | 文件位置 |
|---------|------|------|---------|
| **单元测试** | 测试独立函数和模块 | Vitest | `tests/unit/` |
| **组件测试** | 测试Vue组件 | @vue/test-utils + Vitest | `tests/unit/` |
| **集成测试** | 测试模块间交互 | Vitest | `tests/integration/` |
| **E2E测试** | 测试用户流程 | Playwright/Spectron | `tests/e2e/` |

**测试统计**:
- ✅ 单元测试: 200+ 个测试用例
- ✅ 集成测试: 50+ 个测试用例
- ✅ 代码覆盖率目标: 70%+
- ✅ CI/CD: GitHub Actions 自动化

---

## 快速开始

### 1. 安装依赖

```bash
cd desktop-app-vue
npm install
```

### 2. 运行所有测试

```bash
npm test
```

### 3. 查看测试UI

```bash
npm run test:ui
```

浏览器会自动打开 `http://localhost:51204/__vitest__/`

### 4. 生成覆盖率报告

```bash
npm run test:coverage
```

报告位置: `coverage/index.html`

---

## 测试类型

### 1. 单元测试

测试独立的函数、类和模块。

**示例**: `tests/unit/code-executor.test.js`

```javascript
import { describe, it, expect } from 'vitest';
import { CodeExecutor } from '@main/engines/code-executor';

describe('CodeExecutor', () => {
  it('应该成功执行Python代码', async () => {
    const executor = new CodeExecutor();
    await executor.initialize();

    const result = await executor.executePython('print("test")');

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('test');
  });
});
```

**运行单元测试**:
```bash
npm run test:unit
```

---

### 2. 组件测试

测试Vue组件的渲染和交互。

**示例**: `tests/unit/PythonExecutionPanel.test.ts`

```typescript
import { mount } from '@vue/test-utils';
import PythonExecutionPanel from '@renderer/components/projects/PythonExecutionPanel.vue';

describe('PythonExecutionPanel', () => {
  it('应该正确渲染组件', () => {
    const wrapper = mount(PythonExecutionPanel, {
      props: {
        code: 'print("Hello")'
      }
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.text()).toContain('运行代码');
  });
});
```

**运行组件测试**:
```bash
npm run test:unit
```

---

### 3. 集成测试

测试多个模块之间的交互。

**示例**: `tests/integration/code-execution-flow.test.ts`

```typescript
describe('代码执行流程', () => {
  it('应该完成从前端到后端的完整执行流程', async () => {
    // 1. 安全检查
    const safety = await window.api.code.checkSafety(code);
    expect(safety.safe).toBe(true);

    // 2. 执行代码
    const result = await window.api.code.executePython(code);
    expect(result.success).toBe(true);

    // 3. 验证输出
    expect(result.stdout).toContain('expected output');
  });
});
```

**运行集成测试**:
```bash
npm run test:integration
```

---

### 4. E2E测试

测试完整的用户流程(需要Playwright/Spectron)。

**当前状态**: 占位符已创建，待实现

**配置E2E测试**:

1. 安装Playwright:
   ```bash
   npm install -D @playwright/test playwright
   ```

2. 创建配置文件 `playwright.config.ts`

3. 编写E2E测试:
   ```typescript
   import { test, _electron as electron } from '@playwright/test';

   test('应该能够执行Python代码', async () => {
     const app = await electron.launch({ args: ['.'] });
     const window = await app.firstWindow();

     // 1. 导航到项目
     // 2. 创建Python文件
     // 3. 输入代码
     // 4. 点击运行
     // 5. 验证输出

     await app.close();
   });
   ```

**运行E2E测试**:
```bash
npm run test:e2e
```

---

## 运行测试

### 基本命令

| 命令 | 说明 | 用途 |
|------|------|------|
| `npm test` | 运行所有测试 | 一次性执行所有测试 |
| `npm run test:watch` | 监听模式 | 开发时自动运行测试 |
| `npm run test:ui` | UI模式 | 可视化测试界面 |
| `npm run test:unit` | 单元测试 | 只运行单元测试 |
| `npm run test:integration` | 集成测试 | 只运行集成测试 |
| `npm run test:e2e` | E2E测试 | 端到端测试 |
| `npm run test:coverage` | 覆盖率 | 生成覆盖率报告 |
| `npm run test:all` | 全部测试 | 包括数据库和U-Key测试 |

### 监听模式

在开发过程中，使用监听模式自动运行测试:

```bash
npm run test:watch
```

**功能**:
- ✅ 文件变化自动运行相关测试
- ✅ 失败的测试优先运行
- ✅ 交互式过滤测试

**快捷键**:
- `a` - 运行所有测试
- `f` - 只运行失败的测试
- `u` - 更新快照
- `p` - 按文件名过滤
- `t` - 按测试名过滤
- `q` - 退出

### UI模式

可视化测试界面，方便调试:

```bash
npm run test:ui
```

**功能**:
- 📊 可视化测试结果
- 🔍 查看测试代码
- 🐛 调试失败的测试
- 📈 覆盖率热力图

---

## 编写测试

### 测试文件命名

- 单元测试: `*.test.js` 或 `*.test.ts`
- 组件测试: `*.test.ts` (与组件同名)
- 集成测试: `*-flow.test.ts` 或 `*-integration.test.ts`
- E2E测试: `*.e2e.test.ts`

### 测试结构

```javascript
describe('功能模块名称', () => {
  // 每个测试前执行
  beforeEach(() => {
    // 设置测试环境
  });

  // 每个测试后执行
  afterEach(() => {
    // 清理
  });

  describe('子功能1', () => {
    it('应该正确处理情况A', () => {
      // Arrange (准备)
      const input = 'test';

      // Act (执行)
      const result = functionToTest(input);

      // Assert (断言)
      expect(result).toBe('expected');
    });

    it('应该正确处理情况B', () => {
      // ...
    });
  });

  describe('子功能2', () => {
    // ...
  });
});
```

### 常用断言

```javascript
// 基本断言
expect(value).toBe(expected);              // 严格相等
expect(value).toEqual(expected);           // 深度相等
expect(value).toBeTruthy();                // 真值
expect(value).toBeFalsy();                 // 假值
expect(value).toBeNull();                  // null
expect(value).toBeUndefined();             // undefined
expect(value).toBeDefined();               // 已定义

// 数值断言
expect(value).toBeGreaterThan(3);          // 大于
expect(value).toBeGreaterThanOrEqual(3);   // 大于等于
expect(value).toBeLessThan(5);             // 小于
expect(value).toBeCloseTo(0.3, 5);         // 近似相等

// 字符串断言
expect(string).toMatch(/pattern/);         // 正则匹配
expect(string).toContain('substring');     // 包含子串

// 数组断言
expect(array).toContain(item);             // 包含元素
expect(array).toHaveLength(3);             // 长度

// 对象断言
expect(object).toHaveProperty('key');      // 有属性
expect(object).toMatchObject({             // 部分匹配
  key: 'value'
});

// 函数断言
expect(fn).toThrow();                      // 抛出错误
expect(fn).toHaveBeenCalled();             // 被调用
expect(fn).toHaveBeenCalledWith(arg);      // 被特定参数调用
expect(fn).toHaveBeenCalledTimes(2);       // 调用次数

// 异步断言
await expect(promise).resolves.toBe(value);   // Promise resolve
await expect(promise).rejects.toThrow();      // Promise reject
```

### Mock和Spy

```javascript
import { vi } from 'vitest';

// Mock函数
const mockFn = vi.fn();
mockFn('arg1', 'arg2');
expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');

// Mock返回值
mockFn.mockReturnValue('result');
mockFn.mockResolvedValue('async result');
mockFn.mockRejectedValue(new Error('failed'));

// Mock模块
vi.mock('module-name', () => ({
  default: {
    method: vi.fn()
  }
}));

// Spy
const spy = vi.spyOn(object, 'method');
object.method();
expect(spy).toHaveBeenCalled();
spy.mockRestore();

// 定时器
vi.useFakeTimers();
setTimeout(() => {}, 1000);
vi.advanceTimersByTime(1000);
vi.useRealTimers();
```

### 组件测试技巧

```javascript
import { mount, shallowMount } from '@vue/test-utils';

// 挂载组件
const wrapper = mount(Component, {
  props: {
    msg: 'Hello'
  },
  global: {
    stubs: {
      'child-component': true
    },
    mocks: {
      $route: { path: '/' }
    },
    provide: {
      key: 'value'
    }
  }
});

// 查找元素
wrapper.find('button');
wrapper.findAll('.item');
wrapper.findComponent(ChildComponent);

// 触发事件
await wrapper.find('button').trigger('click');
await wrapper.find('input').setValue('text');

// 检查emit
expect(wrapper.emitted('event-name')).toBeTruthy();
expect(wrapper.emitted('event-name')[0][0]).toBe(value);

// 访问组件实例
wrapper.vm.method();
expect(wrapper.vm.property).toBe(value);

// 更新props
await wrapper.setProps({ msg: 'New' });

// 清理
wrapper.unmount();
```

---

## 测试覆盖率

### 查看覆盖率

```bash
npm run test:coverage
```

报告会生成在 `coverage/` 目录:
- `coverage/index.html` - HTML报告(推荐)
- `coverage/lcov.info` - LCOV格式
- `coverage/coverage-final.json` - JSON格式

### 覆盖率目标

| 指标 | 目标 | 当前 |
|------|------|------|
| **行覆盖率** | 70% | - |
| **函数覆盖率** | 70% | - |
| **分支覆盖率** | 70% | - |
| **语句覆盖率** | 70% | - |

### 排除文件

以下文件不计入覆盖率:
- `node_modules/`
- `tests/`
- `**/*.d.ts`
- `**/*.config.*`
- `**/mockData/`
- `dist/` 和 `out/`

### CI覆盖率检查

在CI中,如果覆盖率低于目标会给出警告,但不会阻止构建。

---

## 持续集成

### GitHub Actions

项目使用GitHub Actions进行自动化测试。

**配置文件**: `.github/workflows/test.yml`

**触发条件**:
- Push到 `main` 或 `develop` 分支
- Pull Request到 `main` 或 `develop` 分支

**测试矩阵**:
- ✅ Ubuntu Latest
- ✅ Windows Latest
- ✅ macOS Latest
- ✅ Node.js 20.x

**执行步骤**:
1. Checkout代码
2. 安装Node.js和Python
3. 安装依赖
4. 运行单元测试
5. 运行集成测试
6. 生成覆盖率报告
7. 上传到Codecov
8. 归档测试结果

### 本地运行CI检查

模拟CI环境:

```bash
# 1. 清理环境
rm -rf node_modules
rm package-lock.json

# 2. 全新安装
npm ci

# 3. 运行测试
npm run test:all

# 4. 运行构建
npm run build
```

---

## 最佳实践

### 1. 测试独立性

❌ **错误**:
```javascript
let sharedData;

test('test 1', () => {
  sharedData = { value: 1 };
});

test('test 2', () => {
  // 依赖test 1的结果
  expect(sharedData.value).toBe(1);
});
```

✅ **正确**:
```javascript
test('test 1', () => {
  const data = { value: 1 };
  // 测试逻辑
});

test('test 2', () => {
  const data = { value: 1 };
  // 独立测试
});
```

### 2. 描述性测试名

❌ **错误**:
```javascript
it('works', () => {});
it('test1', () => {});
```

✅ **正确**:
```javascript
it('应该在输入为空时返回错误', () => {});
it('应该在超时时抛出异常', () => {});
```

### 3. AAA模式

**Arrange - Act - Assert**:

```javascript
it('应该正确计算总和', () => {
  // Arrange: 准备测试数据
  const numbers = [1, 2, 3, 4, 5];

  // Act: 执行被测试的操作
  const result = sum(numbers);

  // Assert: 断言结果
  expect(result).toBe(15);
});
```

### 4. 测试边界情况

```javascript
describe('divide', () => {
  it('应该正确处理正常情况', () => {
    expect(divide(10, 2)).toBe(5);
  });

  it('应该处理除零错误', () => {
    expect(() => divide(10, 0)).toThrow('除数不能为零');
  });

  it('应该处理负数', () => {
    expect(divide(-10, 2)).toBe(-5);
  });

  it('应该处理小数', () => {
    expect(divide(1, 3)).toBeCloseTo(0.333, 3);
  });
});
```

### 5. 清理副作用

```javascript
afterEach(() => {
  // 清理mock
  vi.clearAllMocks();

  // 清理DOM
  document.body.innerHTML = '';

  // 清理定时器
  vi.clearAllTimers();

  // 卸载组件
  wrapper?.unmount();
});
```

### 6. 使用describe分组

```javascript
describe('UserService', () => {
  describe('register', () => {
    it('应该创建新用户', () => {});
    it('应该发送确认邮件', () => {});
    it('应该拒绝重复邮箱', () => {});
  });

  describe('login', () => {
    it('应该返回JWT token', () => {});
    it('应该拒绝错误密码', () => {});
  });
});
```

---

## 常见问题

### Q1: 如何跳过某个测试?

```javascript
it.skip('暂时跳过这个测试', () => {
  // ...
});

// 或者
it.todo('待实现的测试');
```

### Q2: 如何只运行某个测试?

```javascript
it.only('只运行这个测试', () => {
  // ...
});
```

### Q3: 测试超时怎么办?

```javascript
it('长时间运行的测试', async () => {
  // ...
}, 10000); // 10秒超时
```

或在配置文件中设置全局超时:
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    testTimeout: 10000,
  }
});
```

### Q4: 如何测试私有方法?

通常不应该直接测试私有方法,而是通过公共API间接测试。如果必须测试:

```javascript
// 通过实例访问
const instance = new MyClass();
const privateMethod = instance['privateMethod'];
```

### Q5: Mock不生效怎么办?

确保在导入模块之前设置mock:

```javascript
// ❌ 错误顺序
import { functionToTest } from './module';
vi.mock('./dependency');

// ✅ 正确顺序
vi.mock('./dependency');
import { functionToTest } from './module';
```

### Q6: 如何调试测试?

1. 使用 `console.log`:
   ```javascript
   it('test', () => {
     console.log(value);
     expect(value).toBe(expected);
   });
   ```

2. 使用 `debugger`:
   ```javascript
   it('test', () => {
     debugger;
     expect(value).toBe(expected);
   });
   ```

3. 使用 VSCode 调试:
   在 `.vscode/launch.json` 中添加:
   ```json
   {
     "type": "node",
     "request": "launch",
     "name": "Debug Tests",
     "runtimeExecutable": "npm",
     "runtimeArgs": ["run", "test:watch"],
     "console": "integratedTerminal"
   }
   ```

### Q7: 组件测试中API调用如何mock?

```javascript
import { mockElectronAPI } from '../setup';

beforeEach(() => {
  mockElectronAPI.code.executePython.mockResolvedValue({
    success: true,
    stdout: 'output'
  });
});

it('should call API', async () => {
  const wrapper = mount(Component);
  await wrapper.find('button').trigger('click');

  expect(mockElectronAPI.code.executePython).toHaveBeenCalled();
});
```

---

## 资源链接

- 📖 [Vitest官方文档](https://vitest.dev/)
- 📖 [Vue Test Utils文档](https://test-utils.vuejs.org/)
- 📖 [Testing Library](https://testing-library.com/)
- 📖 [Playwright文档](https://playwright.dev/)
- 📊 [代码覆盖率最佳实践](https://martinfowler.com/bliki/TestCoverage.html)
- 🎯 [测试金字塔](https://martinfowler.com/bliki/TestPyramid.html)

---

## 反馈和支持

如有测试相关问题,请:

1. 查看本文档的[常见问题](#常见问题)
2. 搜索[GitHub Issues](https://github.com/chainlesschain/desktop-app/issues)
3. 创建新的Issue,附上:
   - 测试代码
   - 错误信息
   - 运行环境

---

**最后更新**: 2025-12-25
**维护者**: ChainlessChain Team
