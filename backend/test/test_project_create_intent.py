#!/usr/bin/env python3
"""
测试项目创建API的意图识别流程
"""
import requests
import json

API_URL = "http://localhost:8001/api/projects/create"

test_cases = [
    {
        "name": "案例1: 不指定project_type（让系统自动识别）",
        "data": {
            "user_prompt": "生成一个包含hello的工作报告"
            # 注意：这里不指定project_type
        }
    },
    {
        "name": "案例2: 明确指定document类型",
        "data": {
            "user_prompt": "生成一个包含hello的工作报告",
            "project_type": "document"
        }
    },
    {
        "name": "案例3: 明确指定web类型（错误的类型）",
        "data": {
            "user_prompt": "生成一个包含hello的工作报告",
            "project_type": "web"
        }
    }
]

print("="*80)
print("项目创建API意图识别测试")
print("="*80)

for test_case in test_cases:
    print(f"\n{test_case['name']}")
    print("-"*80)
    print(f"请求数据: {json.dumps(test_case['data'], ensure_ascii=False)}\n")

    try:
        response = requests.post(
            API_URL,
            json=test_case['data'],
            timeout=120
        )

        if response.status_code == 200:
            result = response.json()
            print(f"[OK] 请求成功")
            print(f"  - 识别的项目类型: {result.get('project_type')}")
            print(f"  - 意图识别结果: {json.dumps(result.get('intent', {}), ensure_ascii=False, indent=4)}")

            # 检查是否匹配正确
            if result.get('project_type') == 'document':
                print("  [OK] 识别为document类型")
            else:
                print(f"  [ERROR] 应该是document，但识别为 {result.get('project_type')}")

        else:
            print(f"[ERROR] 请求失败: {response.status_code}")
            print(f"  错误信息: {response.text[:200]}")

    except requests.exceptions.Timeout:
        print("[ERROR] 请求超时（120秒）")
    except Exception as e:
        print(f"[ERROR] 错误: {e}")

print("\n" + "="*80)
print("测试完成")
print("="*80)
