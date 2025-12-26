#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PPT生成功能测试脚本
测试意图识别、文档生成和文件验证
"""

import requests
import json
import time
import os
from pathlib import Path

# API配置
AI_SERVICE_URL = "http://localhost:8001"
PROJECT_SERVICE_URL = "http://localhost:9090"

def print_section(title):
    """打印分隔线"""
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60)

def test_intent_classification():
    """测试意图识别"""
    print_section("步骤1: 测试意图识别")

    test_cases = [
        "做一个项目汇报PPT",
        "生成工作总结演示文稿",
        "准备一份产品介绍幻灯片",
        "写一份工作报告Word",  # 对比测试
    ]

    results = []

    for prompt in test_cases:
        print(f"\n测试提示: '{prompt}'")
        try:
            response = requests.post(
                f"{AI_SERVICE_URL}/api/intent/classify",
                json={"text": prompt},
                timeout=10
            )

            if response.status_code == 200:
                result = response.json()
                print(f"  ✓ 意图: {result.get('intent')}")
                print(f"  ✓ 项目类型: {result.get('project_type')}")
                print(f"  ✓ 实体: {result.get('entities')}")
                print(f"  ✓ 置信度: {result.get('confidence')}")

                # 检查format字段
                entities = result.get('entities', {})
                doc_format = entities.get('format', 'N/A')
                if 'PPT' in prompt or '演示' in prompt or '幻灯片' in prompt:
                    expected = 'ppt'
                    if doc_format == expected:
                        print(f"  ✓ 格式识别正确: {doc_format}")
                        results.append(("PASS", prompt, doc_format))
                    else:
                        print(f"  ✗ 格式识别错误: 期望 '{expected}', 实际 '{doc_format}'")
                        results.append(("FAIL", prompt, doc_format))
                else:
                    print(f"  ℹ 格式: {doc_format}")
                    results.append(("INFO", prompt, doc_format))
            else:
                print(f"  ✗ 请求失败: {response.status_code}")
                print(f"    {response.text}")
                results.append(("ERROR", prompt, None))

        except Exception as e:
            print(f"  ✗ 错误: {e}")
            results.append(("ERROR", prompt, None))

    # 总结
    print("\n" + "-" * 60)
    print("意图识别测试总结:")
    passed = sum(1 for r in results if r[0] == "PASS")
    failed = sum(1 for r in results if r[0] == "FAIL")
    print(f"  通过: {passed}")
    print(f"  失败: {failed}")

    return results

def test_document_generation():
    """测试文档生成"""
    print_section("步骤2: 测试PPT生成")

    prompt = "做一个项目汇报PPT"
    print(f"生成请求: '{prompt}'")

    try:
        # 使用流式API
        response = requests.post(
            f"{AI_SERVICE_URL}/api/projects/create/stream",
            json={
                "user_prompt": prompt,
                "project_type": "document"
            },
            stream=True,
            timeout=120
        )

        if response.status_code != 200:
            print(f"✗ 请求失败: {response.status_code}")
            print(response.text)
            return None

        print("\n接收流式响应...")
        project_data = None

        for line in response.iter_lines():
            if line:
                line_text = line.decode('utf-8')
                if line_text.startswith('data: '):
                    try:
                        data = json.loads(line_text[6:])
                        msg_type = data.get('type')

                        if msg_type == 'progress':
                            stage = data.get('stage', '')
                            message = data.get('message', '')
                            print(f"  [{stage}] {message}")

                            # 检查意图识别结果
                            if stage == 'intent' and 'intent' in data:
                                intent_data = data.get('intent', {})
                                entities = intent_data.get('entities', {})
                                doc_format = entities.get('format', 'N/A')
                                print(f"    └─ 识别格式: {doc_format}")

                        elif msg_type == 'complete':
                            print("  ✓ 生成完成!")
                            project_data = data.get('result', {})

                        elif msg_type == 'error':
                            print(f"  ✗ 错误: {data.get('error')}")
                            return None

                    except json.JSONDecodeError:
                        pass

        return project_data

    except Exception as e:
        print(f"✗ 生成失败: {e}")
        return None

def verify_generated_files(project_data):
    """验证生成的文件"""
    print_section("步骤3: 验证生成的文件")

    if not project_data:
        print("✗ 没有项目数据")
        return False

    files = project_data.get('files', [])
    if not files:
        print("✗ 没有生成文件")
        return False

    print(f"生成了 {len(files)} 个文件:")

    has_ppt = False
    for file_info in files:
        file_path = file_info.get('path', '')
        file_type = file_info.get('type', '')

        print(f"\n文件: {file_path}")
        print(f"  类型: {file_type}")

        # 检查是否为PPT
        if file_path.endswith('.pptx') or file_type == 'ppt':
            has_ppt = True
            print("  ✓ 这是PPT文件!")

            # 检查内容
            content = file_info.get('content')
            if content:
                # 内容是base64编码的
                import base64
                try:
                    decoded = base64.b64decode(content)
                    file_size = len(decoded)
                    print(f"  ✓ 文件大小: {file_size} 字节")

                    if file_size > 0:
                        print("  ✓ 文件内容非空")

                        # 检查是否是有效的ZIP文件（PPTX是ZIP格式）
                        if decoded[:4] == b'PK\x03\x04':
                            print("  ✓ 文件格式正确 (ZIP/PPTX)")
                        else:
                            print("  ✗ 文件格式可能不正确")
                    else:
                        print("  ✗ 文件内容为空")

                except Exception as e:
                    print(f"  ✗ 解码失败: {e}")
        elif file_path.endswith('.docx'):
            print("  ℹ 这是Word文件（不是预期的PPT）")

    if has_ppt:
        print("\n✓ 成功生成PPT文件!")
        return True
    else:
        print("\n✗ 没有生成PPT文件")
        return False

def find_latest_ppt():
    """查找最新生成的PPT文件"""
    print_section("步骤4: 查找本地PPT文件")

    projects_dir = Path("C:/code/chainlesschain/data/projects")
    if not projects_dir.exists():
        print("✗ 项目目录不存在")
        return None

    print(f"搜索目录: {projects_dir}")

    ppt_files = list(projects_dir.rglob("*.pptx"))

    if not ppt_files:
        print("✗ 未找到PPT文件")
        return None

    # 按修改时间排序
    ppt_files.sort(key=lambda x: x.stat().st_mtime, reverse=True)
    latest = ppt_files[0]

    print(f"✓ 找到 {len(ppt_files)} 个PPT文件")
    print(f"  最新: {latest}")
    print(f"  大小: {latest.stat().st_size} 字节")
    print(f"  修改时间: {time.ctime(latest.stat().st_mtime)}")

    return latest

def main():
    """主测试流程"""
    print("=" * 60)
    print("        PPT生成功能完整测试")
    print("=" * 60)

    # 1. 测试意图识别
    intent_results = test_intent_classification()

    # 2. 测试文档生成
    project_data = test_document_generation()

    # 3. 验证生成的文件
    if project_data:
        verify_generated_files(project_data)

    # 4. 查找本地PPT文件
    latest_ppt = find_latest_ppt()

    # 最终总结
    print_section("测试总结")

    # 统计意图识别结果
    ppt_tests = [r for r in intent_results if 'PPT' in r[1] or '演示' in r[1] or '幻灯片' in r[1]]
    ppt_passed = sum(1 for r in ppt_tests if r[0] == "PASS")

    print(f"意图识别 (PPT): {ppt_passed}/{len(ppt_tests)} 通过")
    print(f"文档生成: {'✓ 成功' if project_data else '✗ 失败'}")
    print(f"本地PPT文件: {'✓ 找到' if latest_ppt else '✗ 未找到'}")

    if ppt_passed == len(ppt_tests) and project_data and latest_ppt:
        print("\n🎉 所有测试通过！PPT功能正常工作！")
        return 0
    else:
        print("\n⚠️ 部分测试失败，需要进一步检查")
        return 1

if __name__ == "__main__":
    exit(main())
