"""
ChainlessChain 后端接口全面测试主脚本
运行所有接口测试并生成详细报告和修复计划
"""
import argparse
import sys
import json
from datetime import datetime
from pathlib import Path

from test_project_service_comprehensive import ProjectServiceComprehensiveTester
from test_ai_service_comprehensive import AIServiceComprehensiveTester


def generate_remediation_plan(all_results):
    """
    根据测试结果生成修复计划

    Args:
        all_results: 所有测试结果

    Returns:
        修复计划文本
    """
    plan = """# ChainlessChain 后端接口修复计划

## 测试执行摘要

"""

    # 收集所有失败和错误的测试
    failed_tests = []
    error_tests = []
    missing_apis = []

    for service_name, tester in all_results:
        for result in tester.reporter.results:
            if result.status.value == "FAILED":
                failed_tests.append({
                    "service": service_name,
                    "name": result.name,
                    "endpoint": result.endpoint,
                    "method": result.method,
                    "error": result.error_message,
                    "expected": result.expected,
                    "actual": result.actual
                })
            elif result.status.value == "ERROR":
                error_tests.append({
                    "service": service_name,
                    "name": result.name,
                    "endpoint": result.endpoint,
                    "method": result.method,
                    "error": result.error_message
                })

    # 统计信息
    total_failed = len(failed_tests)
    total_error = len(error_tests)
    total_issues = total_failed + total_error

    plan += f"- **测试时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
    plan += f"- **总问题数**: {total_issues}\n"
    plan += f"  - 失败: {total_failed}\n"
    plan += f"  - 错误: {total_error}\n\n"

    # 问题分类
    plan += "## 问题分类\n\n"

    # 按服务分类
    service_issues = {}
    for test in failed_tests + error_tests:
        service = test["service"]
        if service not in service_issues:
            service_issues[service] = []
        service_issues[service].append(test)

    for service, issues in service_issues.items():
        plan += f"### {service} ({len(issues)}个问题)\n\n"
        for issue in issues:
            plan += f"#### {issue['name']}\n\n"
            plan += f"- **端点**: `{issue['method']} {issue['endpoint']}`\n"
            plan += f"- **错误**: {issue['error']}\n"
            if 'expected' in issue and issue['expected'] is not None:
                plan += f"- **期望**: {issue['expected']}\n"
                plan += f"- **实际**: {issue['actual']}\n"
            plan += "\n"

    # 修复优先级
    plan += "## 修复优先级\n\n"

    # 高优先级：核心功能错误（无法连接、5xx错误）
    high_priority = [t for t in error_tests if "无法连接" in t.get("error", "") or "500" in str(t.get("actual", ""))]

    # 中优先级：功能失败（4xx错误）
    medium_priority = [t for t in failed_tests if "404" in str(t.get("actual", "")) or "400" in str(t.get("actual", ""))]

    # 低优先级：验证失败（数据格式问题）
    low_priority = [t for t in failed_tests if t not in medium_priority]

    if high_priority:
        plan += "### 🔴 高优先级 (服务不可用/严重错误)\n\n"
        for issue in high_priority:
            plan += f"- [ ] **{issue['service']}**: {issue['name']}\n"
            plan += f"  - 端点: `{issue['method']} {issue['endpoint']}`\n"
            plan += f"  - 问题: {issue['error']}\n"
            plan += f"  - 修复建议: 检查服务是否启动，检查端口配置，查看服务日志\n\n"

    if medium_priority:
        plan += "### 🟡 中优先级 (接口缺失/参数错误)\n\n"
        for issue in medium_priority:
            plan += f"- [ ] **{issue['service']}**: {issue['name']}\n"
            plan += f"  - 端点: `{issue['method']} {issue['endpoint']}`\n"
            plan += f"  - 问题: {issue['error']}\n"
            if "404" in str(issue.get("actual", "")):
                plan += f"  - 修复建议: 实现缺失的API端点，检查路由配置\n\n"
            else:
                plan += f"  - 修复建议: 检查请求参数格式，验证数据校验规则\n\n"

    if low_priority:
        plan += "### 🟢 低优先级 (数据格式/验证问题)\n\n"
        for issue in low_priority:
            plan += f"- [ ] **{issue['service']}**: {issue['name']}\n"
            plan += f"  - 端点: `{issue['method']} {issue['endpoint']}`\n"
            plan += f"  - 问题: {issue['error']}\n"
            plan += f"  - 修复建议: 调整响应格式，确保符合API规范\n\n"

    # 建议的系统设计缺失功能
    plan += "## 系统设计对照检查\n\n"
    plan += "### 已实现的核心功能\n\n"
    plan += "- ✅ 项目管理 (CRUD)\n"
    plan += "- ✅ 文件管理\n"
    plan += "- ✅ 协作者管理\n"
    plan += "- ✅ 评论系统\n"
    plan += "- ✅ 自动化规则\n"
    plan += "- ✅ 数据同步\n"
    plan += "- ✅ AI意图识别\n"
    plan += "- ✅ 代码生成与分析\n"
    plan += "- ✅ RAG知识检索\n"
    plan += "- ✅ Git操作\n\n"

    plan += "### 可能缺失或未测试的功能\n\n"
    plan += "- ⚠️ 流式响应接口 (Stream API)\n"
    plan += "  - `/api/projects/create/stream` - 流式项目创建\n"
    plan += "  - `/api/chat/stream` - 流式对话\n"
    plan += "  - 建议: 使用专门的流式测试工具测试\n\n"
    plan += "- ⚠️ Git高级操作\n"
    plan += "  - `/api/git/commit` - 提交代码\n"
    plan += "  - `/api/git/push` - 推送到远程\n"
    plan += "  - `/api/git/pull` - 拉取更新\n"
    plan += "  - `/api/git/merge` - 合并分支\n"
    plan += "  - `/api/git/resolve-conflicts` - 解决冲突\n"
    plan += "  - 建议: 在测试环境中使用临时Git仓库进行测试\n\n"

    # 修复步骤
    plan += "## 建议的修复步骤\n\n"
    plan += "1. **启动所有服务**\n"
    plan += "   ```bash\n"
    plan += "   # 启动Docker服务\n"
    plan += "   docker-compose up -d\n\n"
    plan += "   # 启动项目服务\n"
    plan += "   cd backend/project-service\n"
    plan += "   mvn spring-boot:run\n\n"
    plan += "   # 启动AI服务\n"
    plan += "   cd backend/ai-service\n"
    plan += "   uvicorn main:app --reload --port 8001\n"
    plan += "   ```\n\n"
    plan += "2. **修复高优先级问题** (服务连接问题)\n"
    plan += "   - 检查端口占用: `netstat -ano | findstr \"9090 8001\"`\n"
    plan += "   - 查看服务日志\n"
    plan += "   - 验证数据库连接\n\n"
    plan += "3. **实现缺失的API端点** (404错误)\n"
    plan += "   - 对照系统设计文档\n"
    plan += "   - 实现缺失的Controller方法\n"
    plan += "   - 添加相应的Service层逻辑\n\n"
    plan += "4. **修复参数验证问题** (400错误)\n"
    plan += "   - 检查DTO定义\n"
    plan += "   - 添加必要的@Valid注解\n"
    plan += "   - 统一错误响应格式\n\n"
    plan += "5. **统一响应格式**\n"
    plan += "   - 确保所有API使用统一的Response格式\n"
    plan += "   - Spring Boot使用ApiResponse<T>\n"
    plan += "   - FastAPI使用标准JSON格式\n\n"
    plan += "6. **重新运行测试**\n"
    plan += "   ```bash\n"
    plan += "   cd backend/test\n"
    plan += "   python run_comprehensive_tests.py\n"
    plan += "   ```\n\n"

    # 长期改进建议
    plan += "## 长期改进建议\n\n"
    plan += "1. **集成测试自动化**\n"
    plan += "   - 添加到CI/CD流程\n"
    plan += "   - 定期运行测试\n"
    plan += "   - 测试覆盖率报告\n\n"
    plan += "2. **API文档**\n"
    plan += "   - 使用Swagger/OpenAPI自动生成文档\n"
    plan += "   - 保持文档与代码同步\n"
    plan += "   - 添加API使用示例\n\n"
    plan += "3. **性能测试**\n"
    plan += "   - 添加压力测试\n"
    plan += "   - 监控响应时间\n"
    plan += "   - 优化慢接口\n\n"
    plan += "4. **安全加固**\n"
    plan += "   - 添加身份验证测试\n"
    plan += "   - 权限控制验证\n"
    plan += "   - 输入验证和防注入\n\n"

    return plan


def main():
    parser = argparse.ArgumentParser(description='ChainlessChain后端接口全面测试')
    parser.add_argument('--service', choices=['all', 'project', 'ai'], default='all',
                        help='选择要测试的服务 (默认: all)')
    parser.add_argument('--project-url', default='http://localhost:9090',
                        help='项目服务URL (默认: http://localhost:9090)')
    parser.add_argument('--ai-url', default='http://localhost:8001',
                        help='AI服务URL (默认: http://localhost:8001)')
    parser.add_argument('--generate-plan', action='store_true',
                        help='生成修复计划')
    args = parser.parse_args()

    print("="*100)
    print("ChainlessChain 后端接口全面自动化测试")
    print(f"测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*100)

    all_results = []

    # 测试项目服务
    if args.service in ['all', 'project']:
        print("\n" + "="*100)
        print("[1/2] 测试项目服务 (Spring Boot) - 所有Controller")
        print("="*100)
        project_tester = ProjectServiceComprehensiveTester(args.project_url)
        project_tester.run_all_tests()
        all_results.append(('项目服务 (Spring Boot)', project_tester))

    # 测试AI服务
    if args.service in ['all', 'ai']:
        print("\n" + "="*100)
        print("[2/2] 测试AI服务 (FastAPI) - 所有API端点")
        print("="*100)
        ai_tester = AIServiceComprehensiveTester(args.ai_url)
        ai_tester.run_all_tests()
        all_results.append(('AI服务 (FastAPI)', ai_tester))

    # 生成独立报告
    print("\n" + "="*100)
    print("生成测试报告...")
    print("="*100)

    for service_name, tester in all_results:
        service_slug = service_name.split()[0].lower().replace('服务', '_service')
        md_file = f"test_report_{service_slug}.md"
        json_file = f"test_report_{service_slug}.json"

        tester.reporter.generate_markdown_report(md_file)
        tester.reporter.generate_json_report(json_file)

        print(f"\n[OK] {service_name}报告已生成:")
        print(f"   - Markdown: {md_file}")
        print(f"   - JSON: {json_file}")

    # 打印综合摘要
    print("\n" + "="*100)
    print("综合测试摘要")
    print("="*100)

    total_tests = sum(len(t.reporter.results) for _, t in all_results)
    total_passed = sum(sum(1 for r in t.reporter.results if r.status.value == "PASSED") for _, t in all_results)
    total_failed = sum(sum(1 for r in t.reporter.results if r.status.value == "FAILED") for _, t in all_results)
    total_errors = sum(sum(1 for r in t.reporter.results if r.status.value == "ERROR") for _, t in all_results)

    for service_name, tester in all_results:
        summary = tester.reporter.get_summary()
        print(f"\n[{service_name}]")
        print(f"   总数: {summary['total']}, 通过: {summary['passed']}, "
              f"失败: {summary['failed']}, 错误: {summary['error']}")
        print(f"   成功率: {summary['success_rate']}, 耗时: {summary['duration']:.2f}s")

    print(f"\n[整体统计]")
    print(f"   总测试数: {total_tests}")
    print(f"   总通过: {total_passed}")
    print(f"   总失败: {total_failed}")
    print(f"   总错误: {total_errors}")
    if total_tests > 0:
        overall_success_rate = (total_passed / total_tests * 100)
        print(f"   整体成功率: {overall_success_rate:.2f}%")

        # 根据成功率给出评价
        if overall_success_rate >= 90:
            print("   评价: [优秀] 系统状态良好")
        elif overall_success_rate >= 70:
            print("   评价: [良好] 存在少量问题")
        elif overall_success_rate >= 50:
            print("   评价: [一般] 需要关注和修复")
        else:
            print("   评价: [较差] 需要立即修复")

    # 生成修复计划
    if args.generate_plan or total_failed > 0 or total_errors > 0:
        print("\n" + "="*100)
        print("生成修复计划...")
        print("="*100)

        remediation_plan = generate_remediation_plan(all_results)
        plan_file = "API_REMEDIATION_PLAN.md"

        with open(plan_file, 'w', encoding='utf-8') as f:
            f.write(remediation_plan)

        print(f"\n[OK] 修复计划已生成: {plan_file}")

        # 打印关键问题
        if total_errors > 0:
            print(f"\n[WARNING] 发现 {total_errors} 个严重错误（ERROR），请优先处理！")
        if total_failed > 0:
            print(f"[INFO] 发现 {total_failed} 个测试失败（FAILED），需要修复。")

    print("\n" + "="*100)
    print("测试完成！")
    print("="*100)

    # 如果有失败或错误，返回非零退出码
    if total_failed > 0 or total_errors > 0:
        print("\n[WARNING] 测试存在问题，请查看报告和修复计划。")
        sys.exit(1)
    else:
        print("\n[SUCCESS] 所有测试通过！")
        sys.exit(0)


if __name__ == "__main__":
    main()
