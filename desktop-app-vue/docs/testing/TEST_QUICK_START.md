# 测试快速入门指南

> 5分钟开始使用ChainlessChain自动化测试

---

## 🚀 快速开始

### 1. 安装测试依赖

```bash
cd desktop-app-vue
npm install
```

这会安装所有测试相关的包:
- `vitest` - 测试框架
- `@vue/test-utils` - Vue组件测试
- `@vitest/ui` - 可视化测试UI
- `@vitest/coverage-v8` - 代码覆盖率

---

### 2. 运行测试

#### 方式一: 运行所有测试 (推荐新手)

```bash
npm test
```

输出示例:
```
✓ tests/unit/code-executor.test.js (30 tests) 2.3s
✓ tests/unit/PythonExecutionPanel.test.ts (40 tests) 1.8s
✓ tests/integration/code-execution-flow.test.ts (30 tests) 1.5s

Test Files  3 passed (3)
     Tests  100 passed (100)
  Start at  14:30:45
  Duration  5.67s
```

#### 方式二: 可视化UI模式 (推荐开发)

```bash
npm run test:ui
```

会自动打开浏览器 `http://localhost:51204/__vitest__/`

**UI功能**:
- 📊 实时查看测试结果
- 🔍 点击查看测试代码
- 📈 查看代码覆盖率
- 🐛 调试失败的测试

#### 方式三: 监听模式 (推荐调试)

```bash
npm run test:watch
```

**交互式快捷键**:
- `a` - 运行所有测试
- `f` - 只运行失败的测试
- `p` - 按文件名过滤
- `t` - 按测试名过滤
- `q` - 退出

---

### 3. 查看覆盖率报告

```bash
npm run test:coverage
```

报告会生成在 `coverage/index.html`

**在浏览器中打开**:
```bash
# Windows
start coverage/index.html

# macOS
open coverage/index.html

# Linux
xdg-open coverage/index.html
```

---

## 📚 常用命令

| 命令 | 说明 | 使用场景 |
|------|------|---------|
| `npm test` | 运行所有测试 | CI/CD, 提交前检查 |
| `npm run test:watch` | 监听模式 | 开发中实时测试 |
| `npm run test:ui` | UI模式 | 调试和探索测试 |
| `npm run test:unit` | 只运行单元测试 | 快速验证核心逻辑 |
| `npm run test:integration` | 只运行集成测试 | 验证模块交互 |
| `npm run test:coverage` | 生成覆盖率报告 | 检查测试覆盖率 |
| `npm run test:all` | 运行所有测试(含数据库) | 完整测试 |

---

## 🎯 典型工作流

### 场景1: 修改代码后验证

```bash
# 1. 启动监听模式
npm run test:watch

# 2. 修改代码 (自动运行相关测试)

# 3. 查看结果,继续修改

# 4. 按 'q' 退出
```

### 场景2: 新增功能前检查

```bash
# 1. 运行所有测试确保现有功能正常
npm test

# 2. 开发新功能...

# 3. 编写新功能的测试

# 4. 运行测试验证
npm run test:watch
```

### 场景3: 提交代码前

```bash
# 1. 运行所有测试
npm test

# 2. 检查覆盖率
npm run test:coverage

# 3. 确保覆盖率 >= 70%

# 4. 提交代码
git add .
git commit -m "feat: add new feature with tests"
```

---

## 🐛 调试测试

### 使用console.log

在测试中添加:
```javascript
it('test', () => {
  console.log('调试信息:', someVariable);
  expect(someVariable).toBe(expected);
});
```

### 使用debugger

```javascript
it('test', () => {
  debugger;  // 程序会在这里暂停
  expect(value).toBe(expected);
});
```

### 使用Vitest UI

1. 运行 `npm run test:ui`
2. 找到失败的测试
3. 点击"Debug"按钮
4. 查看堆栈跟踪和变量

---

## ❓ 常见问题

### Q: 测试失败怎么办?

**A**: 检查错误信息:

```
❌ tests/unit/my-test.test.js > MyTest > should work

AssertionError: expected 'actual' to be 'expected'

Expected: 'expected'
Received: 'actual'
```

**解决步骤**:
1. 阅读错误信息
2. 查看 Expected vs Received
3. 检查代码逻辑
4. 修改后重新运行

### Q: 如何只运行某一个测试?

**A**: 使用 `.only`:

```javascript
it.only('只运行这个测试', () => {
  // 测试代码
});
```

或使用过滤:
```bash
npm run test:watch
# 然后按 't' 键,输入测试名称
```

### Q: 测试太慢怎么办?

**A**:
1. 使用 `test:unit` 只运行单元测试
2. 使用过滤只运行相关测试
3. 检查是否有unnecessary async/await

### Q: Mock不生效怎么办?

**A**: 确保mock在import之前:

```javascript
// ✅ 正确
vi.mock('./module');
import { function } from './module';

// ❌ 错误
import { function } from './module';
vi.mock('./module');
```

---

## 📖 进阶阅读

- 📘 [完整测试指南](TESTING.md) - 850行详细文档
- 📘 [测试总结报告](../AUTOMATED_TESTING_SUMMARY.md)
- 📘 [Vitest官方文档](https://vitest.dev/)
- 📘 [Vue Test Utils](https://test-utils.vuejs.org/)

---

## 🎓 测试示例

### 单元测试示例

```javascript
// tests/unit/my-function.test.js
import { describe, it, expect } from 'vitest';
import { myFunction } from '@/utils/my-function';

describe('myFunction', () => {
  it('应该返回输入的两倍', () => {
    expect(myFunction(5)).toBe(10);
  });

  it('应该处理负数', () => {
    expect(myFunction(-5)).toBe(-10);
  });
});
```

### 组件测试示例

```javascript
// tests/unit/MyButton.test.ts
import { mount } from '@vue/test-utils';
import MyButton from '@/components/MyButton.vue';

describe('MyButton', () => {
  it('应该显示按钮文本', () => {
    const wrapper = mount(MyButton, {
      props: { text: 'Click Me' }
    });

    expect(wrapper.text()).toContain('Click Me');
  });

  it('点击时应该触发事件', async () => {
    const wrapper = mount(MyButton);

    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('click')).toBeTruthy();
  });
});
```

---

## ✅ 检查清单

在提交代码前:

- [ ] 所有测试通过 (`npm test`)
- [ ] 覆盖率 >= 70% (`npm run test:coverage`)
- [ ] 新功能有对应测试
- [ ] Bug修复有回归测试
- [ ] 测试命名清晰易懂
- [ ] 没有 `.only` 或 `.skip`

---

## 🆘 获取帮助

1. 查看 [TESTING.md](TESTING.md) 中的"常见问题"章节
2. 搜索 [GitHub Issues](https://github.com/chainlesschain/issues)
3. 查看现有测试文件作为参考
4. 创建新的Issue并附上:
   - 测试代码
   - 错误信息
   - 期望行为

---

**祝测试愉快!** 🎉

如有问题,请参考 [TESTING.md](TESTING.md) 获取更详细的信息。
