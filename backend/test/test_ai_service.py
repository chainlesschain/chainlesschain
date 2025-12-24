#!/usr/bin/env python3
"""
测试AI服务优化后的性能
"""
import requests
import time
import json

API_URL = "http://localhost:8001/api/projects/create"

# 测试用例
test_cases = [
    {
        "name": "待办事项（预定义模板）",
        "data": {
            "user_prompt": "创建一个待办事项管理应用",
            "project_type": "web"
        }
    },
    {
        "name": "博客（预定义模板）",
        "data": {
            "user_prompt": "创建一个个人博客",
            "project_type": "web"
        }
    },
    {
        "name": "作品集（预定义模板）",
        "data": {
            "user_prompt": "创建一个作品集网站",
            "project_type": "web"
        }
    },
    {
        "name": "自定义Web项目（LLM生成）",
        "data": {
            "user_prompt": "创建一个电商网站",
            "project_type": "web"
        }
    }
]

def test_api(test_case):
    """测试单个API调用"""
    print(f"\n测试: {test_case['name']}")
    print("="*60)

    start_time = time.time()

    try:
        response = requests.post(
            API_URL,
            json=test_case['data'],
            timeout=30
        )

        elapsed = time.time() - start_time

        print(f"状态码: {response.status_code}")
        print(f"耗时: {elapsed:.2f}秒")

        if response.status_code == 200:
            result = response.json()
            print(f"成功: 项目类型 = {result.get('project_type')}")
            if 'intent' in result:
                intent = result['intent']
                print(f"意图识别: {intent.get('confidence', 0):.2f} 置信度")
                if intent.get('fast_path'):
                    print("✓ 使用了快速路径（规则识别）")

            if 'result' in result and 'metadata' in result['result']:
                metadata = result['result']['metadata']
                if metadata.get('source') == 'predefined_template':
                    print("✓ 使用了预定义模板（无需LLM）")
                elif metadata.get('source') == 'llm_generated':
                    print("⊗ 使用了LLM生成")

            if 'result' in result and 'files' in result['result']:
                files = result['result']['files']
                print(f"生成文件数: {len(files)}")
                for f in files:
                    print(f"  - {f['path']}")
        else:
            print(f"失败: {response.text}")

    except requests.exceptions.Timeout:
        print(f"超时: 超过30秒")
    except Exception as e:
        print(f"错误: {e}")

def main():
    print("AI服务性能测试")
    print("="*60)

    for test_case in test_cases:
        test_api(test_case)
        time.sleep(1)  # 避免请求过快

    print("\n\n测试完成！")

if __name__ == "__main__":
    main()
