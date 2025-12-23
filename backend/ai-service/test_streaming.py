"""
流式生成API测试脚本
测试 /api/projects/create/stream 和 /api/chat/stream 端点
"""
import requests
import json
import sys


def test_project_create_stream():
    """测试流式创建项目"""
    print("=" * 60)
    print("测试：流式创建Web项目")
    print("=" * 60)

    url = "http://localhost:8001/api/projects/create/stream"
    payload = {
        "user_prompt": "创建一个简单的个人博客网站",
        "project_type": "web"
    }

    try:
        with requests.post(url, json=payload, stream=True, timeout=300) as response:
            response.raise_for_status()

            print(f"状态码: {response.status_code}")
            print(f"Content-Type: {response.headers.get('content-type')}")
            print("\n开始接收流式数据:\n")

            for line in response.iter_lines():
                if line:
                    line_str = line.decode('utf-8')

                    # SSE格式解析
                    if line_str.startswith('data: '):
                        data_str = line_str[6:]  # 去掉 "data: " 前缀
                        try:
                            data = json.loads(data_str)

                            # 根据类型显示不同的信息
                            chunk_type = data.get('type')

                            if chunk_type == 'progress':
                                stage = data.get('stage', '')
                                message = data.get('message', '')
                                print(f"[进度] {stage}: {message}")

                            elif chunk_type == 'content':
                                stage = data.get('stage', '')
                                content = data.get('content', '')
                                # 只显示前50个字符，避免输出过长
                                content_preview = content[:50] if len(content) > 50 else content
                                print(f"[内容] {stage}: {content_preview}...")

                            elif chunk_type == 'complete':
                                print(f"\n[完成] 项目生成完成!")
                                files = data.get('files', [])
                                print(f"生成的文件数量: {len(files)}")
                                for file_info in files:
                                    path = file_info.get('path', 'unknown')
                                    print(f"  - {path}")

                            elif chunk_type == 'error':
                                error = data.get('error', 'Unknown error')
                                print(f"\n[错误] {error}")

                        except json.JSONDecodeError as e:
                            print(f"JSON解析错误: {e}")
                            print(f"原始数据: {data_str[:100]}...")

            print("\n流式响应结束")

    except requests.exceptions.RequestException as e:
        print(f"请求错误: {e}")
        return False

    return True


def test_chat_stream():
    """测试流式对话"""
    print("\n" + "=" * 60)
    print("测试：流式对话")
    print("=" * 60)

    url = "http://localhost:8001/api/chat/stream"
    payload = {
        "messages": [
            {"role": "system", "content": "你是一个友好的助手。"},
            {"role": "user", "content": "请用一句话介绍什么是人工智能？"}
        ],
        "temperature": 0.7
    }

    try:
        with requests.post(url, json=payload, stream=True, timeout=60) as response:
            response.raise_for_status()

            print(f"状态码: {response.status_code}")
            print("\n开始接收流式对话:\n")

            full_response = ""

            for line in response.iter_lines():
                if line:
                    line_str = line.decode('utf-8')

                    if line_str.startswith('data: '):
                        data_str = line_str[6:]
                        try:
                            data = json.loads(data_str)

                            chunk_type = data.get('type')
                            content = data.get('content', '')

                            if chunk_type == 'content':
                                # 实时显示内容
                                sys.stdout.write(content)
                                sys.stdout.flush()
                                full_response += content

                                if data.get('done'):
                                    print("\n\n[完成]")

                            elif chunk_type == 'error':
                                error = data.get('error', 'Unknown error')
                                print(f"\n[错误] {error}")

                        except json.JSONDecodeError as e:
                            print(f"\nJSON解析错误: {e}")

            print(f"\n完整响应长度: {len(full_response)} 字符")

    except requests.exceptions.RequestException as e:
        print(f"请求错误: {e}")
        return False

    return True


def test_health_check():
    """测试服务健康检查"""
    print("=" * 60)
    print("测试：健康检查")
    print("=" * 60)

    url = "http://localhost:8001/health"

    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()

        data = response.json()
        print(f"状态: {data.get('status')}")
        print("引擎状态:")

        engines = data.get('engines', {})
        for engine_name, status in engines.items():
            status_icon = "✓" if status else "✗"
            print(f"  {status_icon} {engine_name}: {status}")

        return data.get('status') == 'healthy'

    except requests.exceptions.RequestException as e:
        print(f"健康检查失败: {e}")
        return False


if __name__ == "__main__":
    print("\n开始测试 ChainlessChain AI Service 流式生成功能\n")

    # 1. 健康检查
    if not test_health_check():
        print("\n⚠️  服务未就绪，请确保 AI Service 正在运行")
        print("启动命令: cd backend/ai-service && uvicorn main:app --host 0.0.0.0 --port 8001 --reload")
        sys.exit(1)

    print("\n✓ 服务就绪\n")

    # 2. 测试流式对话（更快，先测试）
    if test_chat_stream():
        print("\n✓ 流式对话测试通过")
    else:
        print("\n✗ 流式对话测试失败")

    # 3. 测试流式项目创建（较慢）
    if test_project_create_stream():
        print("\n✓ 流式项目创建测试通过")
    else:
        print("\n✗ 流式项目创建测试失败")

    print("\n" + "=" * 60)
    print("所有测试完成!")
    print("=" * 60)
