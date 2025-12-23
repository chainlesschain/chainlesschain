#!/usr/bin/env python3
"""
测试意图识别器
"""
import requests
import json

API_URL = "http://localhost:8001/api/intent/classify"

test_cases = [
    "生成一个包含hello的工作报告",
    "生成一个工作报告",
    "写一份工作报告",
    "创建月报",
    "帮我做一个待办事项",
    "生成一个博客网站",
    "分析这个Excel数据"
]

print("="*80)
print("意图识别测试")
print("="*80)

for text in test_cases:
    print(f"\n测试文本: {text}")
    print("-"*80)

    try:
        response = requests.post(
            API_URL,
            json={"text": text},
            timeout=10
        )

        if response.status_code == 200:
            result = response.json()
            print(f"项目类型: {result.get('project_type')}")
            print(f"置信度: {result.get('confidence')}")
            print(f"意图: {result.get('intent')}")
            print(f"实体: {json.dumps(result.get('entities', {}), ensure_ascii=False)}")

            # 高亮显示错误的识别
            if "报告" in text and result.get('project_type') != 'document':
                print("⚠️  [BUG] 应该识别为document，但识别为了", result.get('project_type'))
        else:
            print(f"错误: {response.status_code}")

    except Exception as e:
        print(f"请求失败: {e}")

print("\n" + "="*80)
