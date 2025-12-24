"""
Project Service 接口测试 - 使用现有项目
绕过创建项目的性能瓶颈
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from test_utils import APITester, validate_json_structure, validate_api_response
from config import PROJECT_SERVICE_BASE_URL, TEST_USER_DID, DEFAULT_TIMEOUT


class ProjectServiceTesterExisting(APITester):
    """Project Service 测试器 - 使用现有项目"""

    def __init__(self, use_existing_project_id: str = None):
        super().__init__(PROJECT_SERVICE_BASE_URL, "project-service")
        self.test_project_id = use_existing_project_id
        self.test_file_id = None
        self.test_collaborator_id = None
        self.test_comment_id = None
        self.test_rule_id = None

    def run_all_tests(self):
        """运行所有测试"""
        print("\n" + "=" * 60)
        print("开始测试 Project Service (使用现有项目)")
        print("=" * 60 + "\n")

        # 1. 健康检查
        self.test_health_check()

        # 2. 获取项目列表并选择一个项目
        if not self.test_project_id:
            self.test_list_projects_and_select()

        # 3. 如果有项目ID，测试所有功能
        if self.test_project_id:
            print(f"\n使用项目ID: {self.test_project_id}")

            # 项目管理
            self.test_get_project()
            self.test_execute_task()

            # 文件管理
            self.test_create_file()
            self.test_batch_create_files()
            self.test_list_files()
            self.test_get_file()
            self.test_update_file()

            # 协作者管理
            self.test_add_collaborator()
            self.test_list_collaborators()
            self.test_update_collaborator_permissions()
            self.test_accept_invitation()

            # 评论管理
            self.test_add_comment()
            self.test_list_comments()
            self.test_reply_comment()
            self.test_get_comment_replies()
            self.test_update_comment()

            # 自动化规则
            self.test_create_automation_rule()
            self.test_list_automation_rules()
            self.test_update_automation_rule()
            self.test_toggle_automation_rule()
            self.test_trigger_automation_rule()
            self.test_get_automation_stats()

            # 删除操作（最后执行）
            self.test_delete_comment()
            self.test_delete_automation_rule()
            self.test_remove_collaborator()
            self.test_delete_file()
            # 注意：不删除项目本身，因为是使用现有的

        # 打印测试摘要
        self.print_summary()

    # ==================== 基础测试 ====================

    def test_health_check(self):
        """测试健康检查"""
        self.test_endpoint(
            test_name="健康检查",
            method="GET",
            endpoint="/api/projects/health",
            validate_response=lambda data: validate_json_structure(
                data, ["data.service", "data.status"]
            )
        )

    def test_list_projects_and_select(self):
        """获取项目列表并选择第一个"""
        result = self.test_endpoint(
            test_name="获取项目列表",
            method="GET",
            endpoint="/api/projects/list",
            params={"pageNum": 1, "pageSize": 10},
            validate_response=lambda data: validate_api_response(data)
        )

        # 尝试从返回结果中获取项目ID
        if result.status == "PASS" and result.details:
            records = result.details.get("data", {}).get("records", [])
            if records and len(records) > 0:
                self.test_project_id = records[0].get("id")
                print(f"  自动选择项目: {records[0].get('name')} (ID: {self.test_project_id})")

    # ==================== 项目管理测试 ====================

    def test_get_project(self):
        """测试获取项目详情"""
        if not self.test_project_id:
            return

        self.test_endpoint(
            test_name="获取项目详情",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}",
            validate_response=lambda data: (
                validate_api_response(data) or
                validate_json_structure(data, ["data.id", "data.name"])
            )
        )

    def test_execute_task(self):
        """测试执行任务"""
        if not self.test_project_id:
            return

        self.test_endpoint(
            test_name="执行任务",
            method="POST",
            endpoint="/api/projects/tasks/execute",
            data={
                "projectId": self.test_project_id,
                "taskType": "test",
                "description": "测试任务执行"
            },
            validate_response=lambda data: validate_api_response(data)
        )

    # ==================== 文件管理测试 ====================

    def test_create_file(self):
        """测试创建文件"""
        result = self.test_endpoint(
            test_name="创建文件",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/files",
            data={
                "fileName": "test_automated.md",
                "filePath": "/test_automated.md",
                "fileType": "markdown",
                "content": "# 自动化测试文件\n\n这是一个自动创建的测试文件。"
            },
            validate_response=lambda data: (
                validate_api_response(data) or
                validate_json_structure(data, ["data.id", "data.fileName"])
            )
        )

        if result.status == "PASS" and result.details:
            self.test_file_id = result.details.get("data", {}).get("id")
            print(f"  保存测试文件ID: {self.test_file_id}")

    def test_batch_create_files(self):
        """测试批量创建文件"""
        self.test_endpoint(
            test_name="批量创建文件",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/files/batch",
            data=[
                {
                    "fileName": "batch_file1.txt",
                    "filePath": "/batch_file1.txt",
                    "fileType": "text",
                    "content": "批量文件1"
                },
                {
                    "fileName": "batch_file2.txt",
                    "filePath": "/batch_file2.txt",
                    "fileType": "text",
                    "content": "批量文件2"
                }
            ],
            validate_response=lambda data: validate_api_response(data)
        )

    def test_list_files(self):
        """测试获取文件列表"""
        self.test_endpoint(
            test_name="获取文件列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/files",
            params={"pageNum": 1, "pageSize": 50},
            validate_response=lambda data: validate_api_response(data)
        )

    def test_get_file(self):
        """测试获取文件详情"""
        if not self.test_file_id:
            result = self.results[-1]
            result.mark_skip("需要先创建文件")
            return

        self.test_endpoint(
            test_name="获取文件详情",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/files/{self.test_file_id}",
            validate_response=lambda data: (
                validate_api_response(data) or
                validate_json_structure(data, ["data.id", "data.content"])
            )
        )

    def test_update_file(self):
        """测试更新文件"""
        if not self.test_file_id:
            result = self.results[-1]
            result.mark_skip("需要先创建文件")
            return

        self.test_endpoint(
            test_name="更新文件",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/files/{self.test_file_id}",
            data={
                "content": "# 更新后的测试文件\n\n文件内容已通过自动化测试更新。"
            },
            validate_response=lambda data: validate_api_response(data)
        )

    def test_delete_file(self):
        """测试删除文件"""
        if not self.test_file_id:
            result = self.results[-1]
            result.mark_skip("需要先创建文件")
            return

        self.test_endpoint(
            test_name="删除文件",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}/files/{self.test_file_id}",
            validate_response=lambda data: validate_api_response(data)
        )

    # ==================== 协作者管理测试 ====================

    def test_add_collaborator(self):
        """测试添加协作者"""
        result = self.test_endpoint(
            test_name="添加协作者",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators",
            data={
                "userDid": "did:test:auto_collaborator",
                "role": "developer",
                "permissions": ["read", "write"]
            },
            headers={"User-DID": TEST_USER_DID},
            validate_response=lambda data: (
                validate_api_response(data) or
                validate_json_structure(data, ["data.id", "data.userDid"])
            )
        )

        if result.status == "PASS" and result.details:
            self.test_collaborator_id = result.details.get("data", {}).get("id")
            print(f"  保存协作者ID: {self.test_collaborator_id}")

    def test_list_collaborators(self):
        """测试获取协作者列表"""
        self.test_endpoint(
            test_name="获取协作者列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators",
            validate_response=lambda data: validate_api_response(data)
        )

    def test_update_collaborator_permissions(self):
        """测试更新协作者权限"""
        if not self.test_collaborator_id:
            result = self.results[-1]
            result.mark_skip("需要先添加协作者")
            return

        self.test_endpoint(
            test_name="更新协作者权限",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators/{self.test_collaborator_id}",
            data={
                "role": "viewer",
                "permissions": ["read"]
            },
            validate_response=lambda data: validate_api_response(data)
        )

    def test_accept_invitation(self):
        """测试接受邀请"""
        if not self.test_collaborator_id:
            result = self.results[-1]
            result.mark_skip("需要先添加协作者")
            return

        self.test_endpoint(
            test_name="接受邀请",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators/{self.test_collaborator_id}/accept",
            validate_response=lambda data: validate_api_response(data)
        )

    def test_remove_collaborator(self):
        """测试移除协作者"""
        if not self.test_collaborator_id:
            result = self.results[-1]
            result.mark_skip("需要先添加协作者")
            return

        self.test_endpoint(
            test_name="移除协作者",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators/{self.test_collaborator_id}",
            validate_response=lambda data: validate_api_response(data)
        )

    # ==================== 评论管理测试 ====================

    def test_add_comment(self):
        """测试添加评论"""
        result = self.test_endpoint(
            test_name="添加评论",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/comments",
            data={
                "content": "这是一条自动化测试评论",
                "filePath": "/test_automated.md",
                "lineNumber": 1
            },
            headers={"User-DID": TEST_USER_DID},
            validate_response=lambda data: (
                validate_api_response(data) or
                validate_json_structure(data, ["data.id", "data.content"])
            )
        )

        if result.status == "PASS" and result.details:
            self.test_comment_id = result.details.get("data", {}).get("id")
            print(f"  保存评论ID: {self.test_comment_id}")

    def test_list_comments(self):
        """测试获取评论列表"""
        self.test_endpoint(
            test_name="获取评论列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/comments",
            params={"pageNum": 1, "pageSize": 20},
            validate_response=lambda data: validate_api_response(data)
        )

    def test_reply_comment(self):
        """测试回复评论"""
        if not self.test_comment_id:
            result = self.results[-1]
            result.mark_skip("需要先添加评论")
            return

        self.test_endpoint(
            test_name="回复评论",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/comments/{self.test_comment_id}/replies",
            data={
                "content": "这是一条自动化测试回复"
            },
            headers={"User-DID": TEST_USER_DID},
            validate_response=lambda data: validate_api_response(data)
        )

    def test_get_comment_replies(self):
        """测试获取评论回复"""
        if not self.test_comment_id:
            result = self.results[-1]
            result.mark_skip("需要先添加评论")
            return

        self.test_endpoint(
            test_name="获取评论回复",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/comments/{self.test_comment_id}/replies",
            validate_response=lambda data: validate_api_response(data)
        )

    def test_update_comment(self):
        """测试更新评论"""
        if not self.test_comment_id:
            result = self.results[-1]
            result.mark_skip("需要先添加评论")
            return

        self.test_endpoint(
            test_name="更新评论",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/comments/{self.test_comment_id}",
            data={
                "content": "更新后的自动化测试评论"
            },
            validate_response=lambda data: validate_api_response(data)
        )

    def test_delete_comment(self):
        """测试删除评论"""
        if not self.test_comment_id:
            result = self.results[-1]
            result.mark_skip("需要先添加评论")
            return

        self.test_endpoint(
            test_name="删除评论",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}/comments/{self.test_comment_id}",
            validate_response=lambda data: validate_api_response(data)
        )

    # ==================== 自动化规则测试 ====================

    def test_create_automation_rule(self):
        """测试创建自动化规则"""
        result = self.test_endpoint(
            test_name="创建自动化规则",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules",
            data={
                "name": "自动化测试规则",
                "description": "通过自动化测试创建的规则",
                "trigger": "file_created",
                "actions": [
                    {
                        "type": "notify",
                        "params": {"message": "新文件已创建"}
                    }
                ],
                "isEnabled": True
            },
            validate_response=lambda data: (
                validate_api_response(data) or
                validate_json_structure(data, ["data.id", "data.name"])
            )
        )

        if result.status == "PASS" and result.details:
            self.test_rule_id = result.details.get("data", {}).get("id")
            print(f"  保存规则ID: {self.test_rule_id}")

    def test_list_automation_rules(self):
        """测试获取自动化规则列表"""
        self.test_endpoint(
            test_name="获取自动化规则列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules",
            validate_response=lambda data: validate_api_response(data)
        )

    def test_update_automation_rule(self):
        """测试更新自动化规则"""
        if not self.test_rule_id:
            result = self.results[-1]
            result.mark_skip("需要先创建规则")
            return

        self.test_endpoint(
            test_name="更新自动化规则",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules/{self.test_rule_id}",
            data={
                "name": "更新后的自动化规则",
                "description": "规则已通过自动化测试更新"
            },
            validate_response=lambda data: validate_api_response(data)
        )

    def test_toggle_automation_rule(self):
        """测试启用/禁用规则"""
        if not self.test_rule_id:
            result = self.results[-1]
            result.mark_skip("需要先创建规则")
            return

        self.test_endpoint(
            test_name="禁用自动化规则",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules/{self.test_rule_id}/toggle",
            params={"enabled": False},
            validate_response=lambda data: validate_api_response(data)
        )

    def test_trigger_automation_rule(self):
        """测试手动触发规则"""
        if not self.test_rule_id:
            result = self.results[-1]
            result.mark_skip("需要先创建规则")
            return

        self.test_endpoint(
            test_name="手动触发规则",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules/{self.test_rule_id}/trigger",
            validate_response=lambda data: validate_api_response(data)
        )

    def test_get_automation_stats(self):
        """测试获取自动化统计"""
        self.test_endpoint(
            test_name="获取自动化统计",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/automation/stats",
            validate_response=lambda data: validate_api_response(data)
        )

    def test_delete_automation_rule(self):
        """测试删除自动化规则"""
        if not self.test_rule_id:
            result = self.results[-1]
            result.mark_skip("需要先创建规则")
            return

        self.test_endpoint(
            test_name="删除自动化规则",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules/{self.test_rule_id}",
            validate_response=lambda data: validate_api_response(data)
        )


def main():
    """主函数"""
    tester = ProjectServiceTesterExisting()
    tester.run_all_tests()
    return tester


if __name__ == "__main__":
    tester = main()
    # 返回测试结果
    summary = tester.get_summary()
    sys.exit(0 if summary["failed"] == 0 and summary["errors"] == 0 else 1)
