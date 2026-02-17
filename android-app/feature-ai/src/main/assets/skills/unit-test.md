---
name: unit-test
display-name: Unit Test Generator
description: Generate unit test code for given source code
version: 1.0.0
category: testing
user-invocable: true
tags: [test, unit-test, testing]
supported-file-types: [kt, java, py, js, ts]
os: [android, win32, darwin, linux]
handler: UnitTestHandler
input-schema:
  - name: code
    type: string
    description: The code to generate tests for
    required: true
  - name: language
    type: string
    description: Programming language
    required: false
  - name: framework
    type: string
    description: Test framework (JUnit, MockK, pytest, etc.)
    required: false
execution-mode: local
---

# Unit Test Generator Skill

Generates comprehensive unit tests for provided code.

## Usage

```
/unit-test [code to test]
```

## Options

- `--framework <name>` - Test framework: JUnit, MockK, pytest, jest (auto-detected)
- `--language <lang>` - Programming language hint

## Examples

```
/unit-test --framework=JUnit
class Calculator {
    fun add(a: Int, b: Int) = a + b
    fun divide(a: Int, b: Int): Int {
        require(b != 0) { "Division by zero" }
        return a / b
    }
}
```
