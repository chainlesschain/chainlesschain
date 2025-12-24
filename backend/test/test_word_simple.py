#!/usr/bin/env python3
"""
简化的Word API测试 - 用于排查问题
"""
import requests
import json
import base64
import time

API_URL = "http://localhost:8001/api/projects/create"

print("="*80)
print("Word文档生成API测试")
print("="*80)

# 测试数据
data = {
    "user_prompt": "生成一个包含hello的简单工作报告",
    "project_type": "document",
    "metadata": {"format": "word"}
}

print(f"\n请求URL: {API_URL}")
print(f"请求数据:\n{json.dumps(data, ensure_ascii=False, indent=2)}\n")
print("发送请求... (这可能需要30-120秒，请耐心等待)\n")

start_time = time.time()

try:
    response = requests.post(
        API_URL,
        json=data,
        timeout=180  # 3分钟超时
    )

    elapsed = time.time() - start_time
    print(f"响应时间: {elapsed:.2f} 秒")
    print(f"状态码: {response.status_code}\n")

    if response.status_code == 200:
        result = response.json()

        print("[OK] API调用成功!")
        print(f"\n项目类型: {result.get('project_type')}")

        # 提取文件
        files = result.get('result', {}).get('files', [])
        print(f"生成文件数: {len(files)}\n")

        for idx, file_info in enumerate(files, 1):
            file_path = file_info.get('path', f'file_{idx}')
            content = file_info.get('content')
            encoding = file_info.get('content_encoding', '')

            print(f"文件 {idx}: {file_path}")
            print(f"  编码: {encoding or 'raw'}")

            if encoding == 'base64':
                # 解码并保存
                binary = base64.b64decode(content)
                print(f"  大小: {len(binary)} 字节")

                with open(file_path, 'wb') as f:
                    f.write(binary)

                print(f"  [OK] 已保存: {file_path}\n")

        print("="*80)
        print("测试成功完成！")
        print("="*80)

    else:
        print(f"[ERROR] 状态码 {response.status_code}")
        print(f"错误: {response.text}\n")

except requests.exceptions.Timeout:
    print(f"[ERROR] 请求超时（180秒）")
    print("\n可能的原因:")
    print("  1. LLM API密钥配置错误或额度用完")
    print("  2. LLM服务响应慢")
    print("  3. 网络问题")
    print("\n请检查:")
    print("  - Docker日志: docker logs chainlesschain-ai-service --tail 50")
    print("  - 环境变量: .env文件中的VOLCENGINE_API_KEY")

except Exception as e:
    print(f"[ERROR] {e}")
    import traceback
    traceback.print_exc()
