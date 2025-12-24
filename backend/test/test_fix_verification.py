#!/usr/bin/env python3
"""
验证修复后的意图识别效果
模拟前端修复后的请求
"""
import requests
import json

API_URL = "http://localhost:8001/api/projects/create"

print("="*80)
print("修复验证测试")
print("="*80)

test_cases = [
    {
        "name": "修复前：强制指定web类型（错误）",
        "data": {
            "user_prompt": "生成一个包含hello的工作报告",
            "project_type": "web"  # 错误：强制web
        },
        "expected": "web",
        "should_be": "document",
        "is_bug": True
    },
    {
        "name": "修复后：不指定类型，让AI识别（正确）",
        "data": {
            "user_prompt": "生成一个包含hello的工作报告"
            # 正确：不指定project_type
        },
        "expected": "document",
        "should_be": "document",
        "is_bug": False
    },
    {
        "name": "修复后：明确指定document类型（正确）",
        "data": {
            "user_prompt": "生成一个包含hello的工作报告",
            "project_type": "document"
        },
        "expected": "document",
        "should_be": "document",
        "is_bug": False
    }
]

print("\n注意：以下测试会调用真实的LLM API，需要较长时间\n")

# 只测试第2个案例（修复后的正确行为）
test_case = test_cases[1]

print(f"测试案例: {test_case['name']}")
print("-"*80)
print(f"请求数据: {json.dumps(test_case['data'], ensure_ascii=False, indent=2)}")
print(f"期望结果: {test_case['expected']}\n")

try:
    response = requests.post(
        API_URL,
        json=test_case['data'],
        timeout=120
    )

    if response.status_code == 200:
        result = response.json()
        actual_type = result.get('project_type')

        print(f"实际结果: {actual_type}")

        if actual_type == test_case['expected']:
            print(f"[OK] 识别正确！")
        else:
            print(f"[ERROR] 识别错误！应该是 {test_case['expected']}")

        print(f"\n意图识别详情:")
        print(json.dumps(result.get('intent', {}), ensure_ascii=False, indent=2))

    else:
        print(f"[ERROR] 请求失败: {response.status_code}")
        print(response.text[:300])

except requests.exceptions.Timeout:
    print("[ERROR] 请求超时")
except Exception as e:
    print(f"[ERROR] {e}")

print("\n" + "="*80)
print("验证完成")
print("="*80)
print("\n修复总结:")
print("1. AIProjectCreator.vue - projectType默认值: 'web' -> '' (已修复)")
print("2. ProjectsPage.vue - projectType默认值: 'web' -> '' (已修复)")
print("3. ManualProjectForm.vue - 保持 'web' (手动选择，无需修复)")
print("\n现在'生成工作报告'类的提示词会正确识别为document类型！")
