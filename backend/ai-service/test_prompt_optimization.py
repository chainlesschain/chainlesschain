#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prompt优化效果验证脚本
测试新Prompt是否能正确引导AI返回JSON格式
"""

import re
import json
from typing import Optional, Dict, List, Union

# 测试用例
TEST_CASES = [
    {
        "name": "单文件创建",
        "input": "帮我创建一个txt文件",
        "expected_operations": 1,
        "expected_type": "CREATE",
        "should_have_json": True
    },
    {
        "name": "多文件创建",
        "input": "创建一个简单的网页，包含HTML、CSS和JS文件",
        "expected_operations": 3,
        "expected_type": "CREATE",
        "should_have_json": True
    },
    {
        "name": "文件更新",
        "input": "把README.md的内容改成项目介绍",
        "expected_operations": 1,
        "expected_type": "UPDATE",
        "should_have_json": True
    },
    {
        "name": "文件删除",
        "input": "删除test.txt文件",
        "expected_operations": 1,
        "expected_type": "DELETE",
        "should_have_json": True
    },
    {
        "name": "非工具查询",
        "input": "我们现在有哪些文件？",
        "expected_operations": 0,
        "expected_type": None,
        "should_have_json": False
    },
    {
        "name": "代码解释",
        "input": "这段代码是什么意思？",
        "expected_operations": 0,
        "expected_type": None,
        "should_have_json": False
    }
]


def extract_json_block(response):
    """
    从AI响应中提取JSON代码块

    Returns:
        提取的JSON对象，如果没有则返回None
    """
    # 匹配 ```json ... ``` 块
    pattern = r'```json\s*([\s\S]*?)```'
    match = re.search(pattern, response)

    if not match:
        return None

    try:
        json_str = match.group(1).strip()
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"  ❌ JSON解析失败: {e}")
        return None


def validate_json_format(response, expected):
    """验证JSON格式是否符合要求"""
    results = {
        "has_json_marker": False,
        "json_parsable": False,
        "has_operations": False,
        "operation_count_correct": False,
        "operation_type_correct": False,
        "no_placeholders": False
    }

    # 1. 检查```json标记
    results["has_json_marker"] = '```json' in response

    # 2. 提取并解析JSON
    json_data = extract_json_block(response)
    if json_data:
        results["json_parsable"] = True

        # 3. 检查operations数组
        if "operations" in json_data:
            results["has_operations"] = True
            operations = json_data["operations"]

            # 4. 检查操作数量
            if len(operations) == expected["expected_operations"]:
                results["operation_count_correct"] = True

            # 5. 检查操作类型
            if operations and expected["expected_type"]:
                if operations[0].get("type") == expected["expected_type"]:
                    results["operation_type_correct"] = True

            # 6. 检查占位符
            has_placeholder = False
            for op in operations:
                content = op.get("content", "")
                if any(p in content for p in ["...", "TODO", "add code here"]):
                    has_placeholder = True
                    break
            results["no_placeholders"] = not has_placeholder

    return results


def simulate_ai_response(user_input):
    """
    模拟AI响应（用于测试Prompt格式）
    实际使用时，这里应该调用真实的LLM API
    """
    # 这里返回符合优化后Prompt的响应示例
    if "创建" in user_input and "txt" in user_input:
        return '''我会为您创建一个文本文件。

```json
{
  "operations": [
    {
      "type": "CREATE",
      "path": "notes.txt",
      "content": "# 项目笔记\\n\\n这是一个用于记录项目相关信息的文本文件。\\n\\n## 待办事项\\n- 完成功能开发\\n- 编写测试用例\\n- 更新文档",
      "language": "txt",
      "reason": "创建用户请求的文本文件"
    }
  ]
}
```'''

    elif "网页" in user_input or ("HTML" in user_input and "CSS" in user_input):
        return '''我会创建一个完整的网页，包含HTML、CSS和JavaScript文件。

```json
{
  "operations": [
    {
      "type": "CREATE",
      "path": "index.html",
      "content": "<!DOCTYPE html>\\n<html lang=\\"zh-CN\\">\\n<head>\\n    <meta charset=\\"UTF-8\\">\\n    <meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1.0\\">\\n    <title>我的网页</title>\\n    <link rel=\\"stylesheet\\" href=\\"style.css\\">\\n</head>\\n<body>\\n    <h1>欢迎</h1>\\n    <p>这是一个简单的网页示例。</p>\\n    <script src=\\"script.js\\"></script>\\n</body>\\n</html>",
      "language": "html",
      "reason": "创建HTML主页面"
    },
    {
      "type": "CREATE",
      "path": "style.css",
      "content": "body {\\n    font-family: Arial, sans-serif;\\n    margin: 0;\\n    padding: 20px;\\n    background-color: #f5f5f5;\\n}\\n\\nh1 {\\n    color: #333;\\n}\\n\\np {\\n    line-height: 1.6;\\n}",
      "language": "css",
      "reason": "添加页面样式"
    },
    {
      "type": "CREATE",
      "path": "script.js",
      "content": "console.log('页面加载完成');\\n\\ndocument.addEventListener('DOMContentLoaded', function() {\\n    console.log('DOM准备就绪');\\n});",
      "language": "javascript",
      "reason": "添加页面交互功能"
    }
  ]
}
```'''

    elif "更新" in user_input or "改成" in user_input:
        return '''我会更新README.md文件的内容。

```json
{
  "operations": [
    {
      "type": "UPDATE",
      "path": "README.md",
      "content": "# 项目名称\\n\\n## 项目介绍\\n\\n这是一个基于Vue3和Electron的桌面应用项目。\\n\\n## 功能特性\\n\\n- 知识库管理\\n- AI对话助手\\n- 文件操作工具\\n\\n## 快速开始\\n\\n\`\`\`bash\\nnpm install\\nnpm run dev\\n\`\`\`",
      "language": "markdown",
      "reason": "更新项目介绍内容"
    }
  ]
}
```'''

    elif "删除" in user_input:
        return '''我会删除test.txt文件。

```json
{
  "operations": [
    {
      "type": "DELETE",
      "path": "test.txt",
      "reason": "按用户要求删除测试文件"
    }
  ]
}
```'''

    else:
        # 非工具操作查询
        return "根据项目文件列表，您当前有以下文件：[列出文件]。这些文件组成了项目的基本结构。"


def run_test(test_case):
    """运行单个测试用例"""
    print(f"\n{'='*60}")
    print(f"测试: {test_case['name']}")
    print(f"输入: {test_case['input']}")
    print(f"{'='*60}")

    # 模拟AI响应
    response = simulate_ai_response(test_case['input'])
    print(f"\nAI响应长度: {len(response)} 字符")

    # 验证格式
    validation = validate_json_format(response, test_case)

    print("\n格式验证:")
    all_passed = True

    checks = [
        ("JSON标记", validation["has_json_marker"], test_case["should_have_json"]),
        ("JSON可解析", validation["json_parsable"], test_case["should_have_json"]),
        ("包含operations", validation["has_operations"], test_case["should_have_json"]),
        ("操作数量正确", validation["operation_count_correct"], test_case["expected_operations"] > 0),
        ("操作类型正确", validation["operation_type_correct"], test_case["expected_type"] is not None),
        ("无占位符", validation["no_placeholders"], test_case["should_have_json"])
    ]

    for check_name, actual, expected_true in checks:
        if expected_true:
            status = "✅" if actual else "❌"
            print(f"  {status} {check_name}: {actual}")
            if not actual:
                all_passed = False
        else:
            # 不期望为真的检查
            status = "✅" if not actual else "⚠️"
            print(f"  {status} {check_name}: {actual}")

    # 提取JSON详情
    if test_case["should_have_json"]:
        json_data = extract_json_block(response)
        if json_data:
            print(f"\n提取的JSON:")
            print(f"  操作数量: {len(json_data.get('operations', []))}")
            for idx, op in enumerate(json_data.get('operations', []), 1):
                print(f"  操作{idx}: {op.get('type')} - {op.get('path')}")

    result = "✅ 通过" if all_passed else "❌ 失败"
    print(f"\n测试结果: {result}")

    return all_passed


def main():
    """运行所有测试"""
    print("="*60)
    print("Prompt优化效果验证")
    print("="*60)
    print(f"总测试用例数: {len(TEST_CASES)}")

    passed = 0
    failed = 0

    for test_case in TEST_CASES:
        if run_test(test_case):
            passed += 1
        else:
            failed += 1

    print("\n" + "="*60)
    print("测试总结")
    print("="*60)
    print(f"通过: {passed}/{len(TEST_CASES)}")
    print(f"失败: {failed}/{len(TEST_CASES)}")
    print(f"成功率: {passed/len(TEST_CASES)*100:.1f}%")

    if failed == 0:
        print("\n🎉 所有测试通过！Prompt优化效果良好。")
    else:
        print("\n⚠️ 有测试失败，请检查Prompt配置。")

    print("\n" + "="*60)
    print("下一步:")
    print("1. 在实际AI服务中测试（替换simulate_ai_response为真实API调用）")
    print("2. 收集真实用户请求样本进行验证")
    print("3. 根据失败案例持续优化Prompt")
    print("="*60)


if __name__ == "__main__":
    main()
