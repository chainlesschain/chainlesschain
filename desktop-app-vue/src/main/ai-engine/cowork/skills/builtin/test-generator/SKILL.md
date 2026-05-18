---
name: test-generator
display-name: Test Generator
description: 测试生成技能 - 单元测试创建、Mock生成、覆盖率分析
version: 1.0.0
category: development
user-invocable: true
tags: [test, unit-test, mock, coverage, vitest, jest, pytest, junit]
capabilities:
  [
    test-generation,
    mock-generation,
    coverage-analysis,
    test-framework-detection,
  ]
tools:
  - file_reader
  - file_writer
  - code_analyzer
supported-file-types: [js, ts, py, java, go, vue, jsx, tsx]
instructions: |
  Use this skill when the user wants to generate unit tests for source code.
  Analyze function signatures, class structures, and dependencies to produce
  comprehensive test suites. Support Vitest, Jest, Pytest, and JUnit with
  automatic framework detection. Generate mocks for external dependencies.
examples:
  - input: "/test-generator src/main/utils/ipc-error-handler.js"
    output: "Vitest test suite with describe/it blocks covering normal paths, edge cases, and error handling"
  - input: "/test-generator src/main/llm/session-manager.js --framework vitest --mock-style spy"
    output: "Test suite using vi.spyOn for dependency mocking"
  - input: "/test-generator src/main/rag/bm25-search.js --coverage"
    output: "Coverage analysis report with supplemental test cases for uncovered paths"
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# 测试生成技能

## 描述

自动分析源代码并生成对应的单元测试，包括Mock对象生成、边界条件测试和覆盖率分析报告。支持Vitest、Jest、Pytest和JUnit。

## 使用方法

```
/test-generator [源文件路径] [选项]
```

## 选项

- `--framework <name>` - 测试框架: vitest, jest, pytest, junit (默认: 自动检测)
- `--style <type>` - 测试风格: unit, integration, e2e (默认: unit)
- `--coverage` - 分析现有测试覆盖率并补充缺失用例
- `--mock-style <type>` - Mock风格: manual, auto, spy (默认: auto)

## 执行步骤

1. **分析源代码**: 解析函数签名、类结构、依赖关系和公共API
2. **识别测试用例**: 确定正常路径、边界条件、错误处理和异步场景
3. **生成Mock**: 为外部依赖创建Mock对象和Stub函数
4. **生成测试**: 编写测试代码，包含describe/it结构、断言和清理逻辑
5. **覆盖率报告**: 分析已有测试覆盖率，标记未覆盖的代码路径

## 测试类型

| 类型     | 说明                   | 场景               |
| -------- | ---------------------- | ------------------ |
| 正常路径 | 验证预期输入的正确输出 | 标准参数调用       |
| 边界条件 | 验证极端和边界值       | 空值、最大值、零   |
| 错误处理 | 验证异常和错误情况     | 无效输入、网络错误 |
| 异步测试 | 验证Promise和回调      | API调用、定时器    |
| 快照测试 | 验证输出结构不变       | 组件渲染、序列化   |

## 输出格式

- 生成的测试文件内容（可直接保存运行）
- 测试用例清单和描述
- Mock依赖列表
- 预估覆盖率和改进建议

## 示例

生成单元测试:

```
/test-generator src/main/utils/ipc-error-handler.js
```

指定框架和Mock风格:

```
/test-generator src/main/llm/session-manager.js --framework vitest --mock-style spy
```

分析覆盖率并补充测试:

```
/test-generator src/main/rag/bm25-search.js --coverage
```
