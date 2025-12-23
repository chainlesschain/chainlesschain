#!/usr/bin/env python3
"""
测试AI服务的Word文档生成API
"""
import requests
import json
import base64
import os
from datetime import datetime

# API配置
API_BASE = "http://localhost:8001"
API_ENDPOINT = f"{API_BASE}/api/projects/create"

def test_word_generation(prompt="生成一个包含hello的工作报告", output_format="word"):
    """
    测试Word文档生成

    Args:
        prompt: 用户需求描述
        output_format: 输出格式 (word/pdf/both)
    """
    print("="*80)
    print(f"测试Word文档生成API")
    print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)
    print(f"\n用户需求: {prompt}")
    print(f"输出格式: {output_format}\n")

    # 构造请求数据
    request_data = {
        "user_prompt": prompt,
        "project_type": "document",  # 指定为document类型
        "metadata": {
            "format": output_format
        }
    }

    print("[1/4] 发送API请求...")
    print(f"URL: {API_ENDPOINT}")
    print(f"请求数据: {json.dumps(request_data, ensure_ascii=False, indent=2)}\n")

    try:
        # 发送POST请求
        response = requests.post(
            API_ENDPOINT,
            json=request_data,
            timeout=120  # 增加超时时间，因为LLM生成需要时间
        )

        print(f"[2/4] 响应状态码: {response.status_code}")

        if response.status_code == 200:
            result = response.json()
            print("[OK] API调用成功!\n")

            # 显示返回的元数据
            print("[3/4] 返回信息:")
            print(f"  - 项目类型: {result.get('project_type')}")
            print(f"  - 意图识别: {json.dumps(result.get('intent', {}), ensure_ascii=False, indent=4)}")

            # 处理生成的文件
            files = result.get('result', {}).get('files', [])
            print(f"\n[4/4] 生成的文件数: {len(files)}")

            saved_files = []
            for idx, file_info in enumerate(files, 1):
                file_path = file_info.get('path', f'file_{idx}')
                file_type = file_info.get('type', 'unknown')
                content = file_info.get('content')
                content_encoding = file_info.get('content_encoding', '')

                print(f"\n文件 {idx}:")
                print(f"  - 路径: {file_path}")
                print(f"  - 类型: {file_type}")
                print(f"  - 编码: {content_encoding or 'raw'}")

                # 解码内容
                if content_encoding == 'base64':
                    print(f"  - 内容长度: {len(content)} 字符 (base64)")
                    try:
                        binary_content = base64.b64decode(content)
                        print(f"  - 解码后大小: {len(binary_content)} 字节")

                        # 保存文件
                        output_path = os.path.join(os.getcwd(), file_path)
                        with open(output_path, 'wb') as f:
                            f.write(binary_content)

                        saved_files.append(output_path)
                        print(f"  [OK] 文件已保存: {output_path}")

                    except Exception as e:
                        print(f"  [ERROR] 解码/保存失败: {e}")
                else:
                    # 非base64编码，直接保存（可能是字符串）
                    if isinstance(content, bytes):
                        output_path = os.path.join(os.getcwd(), file_path)
                        with open(output_path, 'wb') as f:
                            f.write(content)
                        saved_files.append(output_path)
                        print(f"  [OK] 文件已保存: {output_path}")

            # 总结
            print("\n" + "="*80)
            print("测试完成!")
            print("="*80)
            if saved_files:
                print(f"\n生成了 {len(saved_files)} 个文件:")
                for fp in saved_files:
                    file_size = os.path.getsize(fp)
                    print(f"  - {fp} ({file_size:,} 字节)")
                print("\n你现在可以打开这些文件查看内容。")
            else:
                print("\n[WARNING] 没有文件被保存")

            return True

        else:
            print(f"[ERROR] API调用失败")
            print(f"状态码: {response.status_code}")
            print(f"响应: {response.text}\n")
            return False

    except requests.exceptions.Timeout:
        print("[ERROR] 请求超时（120秒）")
        print("可能原因:")
        print("  1. LLM服务未启动或响应慢")
        print("  2. 网络问题")
        print("  3. API密钥配置错误")
        return False

    except requests.exceptions.ConnectionError:
        print("[ERROR] 连接失败")
        print("请确认AI服务是否在运行:")
        print("  curl http://localhost:8001/health")
        return False

    except Exception as e:
        print(f"[ERROR] 未知错误: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_health_check():
    """测试健康检查"""
    print("\n预检查: 测试服务健康状态...")
    try:
        response = requests.get(f"{API_BASE}/health", timeout=5)
        if response.status_code == 200:
            health = response.json()
            print(f"[OK] 服务状态: {health.get('status')}")
            print(f"引擎状态:")
            for engine, status in health.get('engines', {}).items():
                status_text = "[OK]" if status else "[FAIL]"
                print(f"  {status_text} {engine}: {status}")
            return True
        else:
            print(f"[ERROR] 健康检查失败: {response.status_code}")
            return False
    except Exception as e:
        print(f"[ERROR] 无法连接到服务: {e}")
        return False


if __name__ == "__main__":
    # 先检查服务状态
    if not test_health_check():
        print("\n服务未就绪，请先启动AI服务:")
        print("  cd backend/ai-service")
        print("  uvicorn main:app --reload --port 8001")
        exit(1)

    print("\n")

    # 测试案例
    test_cases = [
        {
            "name": "测试1: 生成包含hello的简单Word文档",
            "prompt": "生成一个包含hello的工作报告",
            "format": "word"
        },
        {
            "name": "测试2: 生成技术文档(Word)",
            "prompt": "写一份关于Python编程的技术文档",
            "format": "word"
        },
        {
            "name": "测试3: 同时生成Word和PDF",
            "prompt": "生成一个项目总结报告",
            "format": "both"
        }
    ]

    # 运行第一个测试
    print(f"\n{test_cases[0]['name']}")
    print("-"*80)
    success = test_word_generation(
        prompt=test_cases[0]['prompt'],
        output_format=test_cases[0]['format']
    )

    if success:
        print("\n\n如果要测试其他案例，取消下面代码的注释:\n")
        # for test_case in test_cases[1:]:
        #     print(f"\n{test_case['name']}")
        #     print("-"*80)
        #     test_word_generation(
        #         prompt=test_case['prompt'],
        #         output_format=test_case['format']
        #     )
        #     print("\n")
