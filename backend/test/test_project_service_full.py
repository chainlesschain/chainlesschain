"""
项目服务 (Spring Boot) 接口测试 - 完整版
端口: 9090
覆盖所有30+接口
"""
from test_framework import APITester, validate_success_response, validate_has_data
import uuid


class ProjectServiceTester(APITester):
    def __init__(self, base_url: str = "http://localhost:9090"):
        super().__init__(base_url)
        self.test_project_id = None
        self.test_file_id = None
        self.test_collaborator_id = None
        self.test_comment_id = None
        self.test_rule_id = None

    # ==================== 项目管理 ====================

    def test_health(self):
        self.run_test(
            name="项目服务健康检查",
            method="GET",
            endpoint="/api/projects/health",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_create_project(self):
        project_data = {
            "userPrompt": f"Create a simple web project for testing - {uuid.uuid4().hex[:8]}",
            "projectType": "web",
            "userId": "test_user_001"
        }

        result = self.run_test(
            name="创建项目",
            method="POST",
            endpoint="/api/projects/create",
            data=project_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r) or validate_has_data(r)
        )

        if result.response_data and "data" in result.response_data:
            data = result.response_data["data"]
            if isinstance(data, dict) and "projectId" in data:
                self.test_project_id = data["projectId"]
            elif isinstance(data, dict) and "id" in data:
                self.test_project_id = data["id"]

    def test_list_projects(self):
        self.run_test(
            name="获取项目列表",
            method="GET",
            endpoint="/api/projects/list",
            params={"pageNum": 1, "pageSize": 10},
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_get_project_detail(self):
        if not self.test_project_id:
            print("[SKIP] 获取项目详情 - 缺少项目ID")
            return

        self.run_test(
            name="获取项目详情",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_execute_task(self):
        if not self.test_project_id:
            print("[SKIP] 执行项目任务 - 缺少项目ID")
            return

        task_data = {
            "projectId": self.test_project_id,
            "userPrompt": "Add error handling to the project",
            "context": []
        }

        self.run_test(
            name="执行项目任务",
            method="POST",
            endpoint="/api/projects/tasks/execute",
            data=task_data,
            expected_status=200
        )

    def test_delete_project(self):
        if not self.test_project_id:
            print("[SKIP] 删除项目 - 缺少项目ID")
            return

        self.run_test(
            name="删除项目",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}",
            expected_status=200
        )

    # ==================== 文件管理 ====================

    def test_list_files(self):
        if not self.test_project_id:
            print("[SKIP] 获取文件列表 - 缺少项目ID")
            return

        self.run_test(
            name="获取文件列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/files",
            expected_status=200
        )

    def test_create_file(self):
        if not self.test_project_id:
            print("[SKIP] 创建文件 - 缺少项目ID")
            return

        file_data = {
            "fileName": f"test_{uuid.uuid4().hex[:8]}.txt",
            "filePath": "/test",
            "content": "Test file content",
            "fileType": "text"
        }

        result = self.run_test(
            name="创建文件",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/files",
            data=file_data,
            expected_status=200
        )

        if result.response_data and "data" in result.response_data:
            data = result.response_data["data"]
            if isinstance(data, dict) and "id" in data:
                self.test_file_id = data["id"]

    def test_get_file_detail(self):
        if not self.test_project_id or not self.test_file_id:
            print("[SKIP] 获取文件详情 - 缺少项目ID或文件ID")
            return

        self.run_test(
            name="获取文件详情",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/files/{self.test_file_id}",
            expected_status=200
        )

    def test_update_file(self):
        if not self.test_project_id or not self.test_file_id:
            print("[SKIP] 更新文件 - 缺少项目ID或文件ID")
            return

        update_data = {
            "content": "Updated content",
            "version": 2
        }

        self.run_test(
            name="更新文件",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/files/{self.test_file_id}",
            data=update_data,
            expected_status=200
        )

    def test_delete_file(self):
        if not self.test_project_id or not self.test_file_id:
            print("[SKIP] 删除文件 - 缺少项目ID或文件ID")
            return

        self.run_test(
            name="删除文件",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}/files/{self.test_file_id}",
            expected_status=200
        )

    def test_batch_create_files(self):
        if not self.test_project_id:
            print("[SKIP] 批量创建文件 - 缺少项目ID")
            return

        # 直接发送List，不是包装在对象中
        batch_data = [
            {"fileName": "file1.txt", "filePath": "/test", "content": "Content 1", "fileType": "text"},
            {"fileName": "file2.txt", "filePath": "/test", "content": "Content 2", "fileType": "text"}
        ]

        self.run_test(
            name="批量创建文件",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/files/batch",
            data=batch_data,
            expected_status=200
        )

    # ==================== 协作者管理 ====================

    def test_list_collaborators(self):
        if not self.test_project_id:
            print("[SKIP] 获取协作者列表 - 缺少项目ID")
            return

        self.run_test(
            name="获取协作者列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators",
            expected_status=200
        )

    def test_add_collaborator(self):
        if not self.test_project_id:
            print("[SKIP] 添加协作者 - 缺少项目ID")
            return

        collaborator_data = {
            "collaboratorDid": "did:example:collaborator001",
            "role": "developer",
            "permissions": ["read", "write"],
            "invitationMessage": "Welcome to the project"
        }

        result = self.run_test(
            name="添加协作者",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators",
            data=collaborator_data,
            expected_status=200
        )

        if result.response_data and "data" in result.response_data:
            data = result.response_data["data"]
            if isinstance(data, dict) and "id" in data:
                self.test_collaborator_id = data["id"]

    def test_update_collaborator(self):
        if not self.test_project_id or not self.test_collaborator_id:
            print("[SKIP] 更新协作者 - 缺少项目ID或协作者ID")
            return

        update_data = {
            "role": "admin",
            "permissions": ["read", "write", "delete"]
        }

        self.run_test(
            name="更新协作者",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators/{self.test_collaborator_id}",
            data=update_data,
            expected_status=200
        )

    def test_remove_collaborator(self):
        if not self.test_project_id or not self.test_collaborator_id:
            print("[SKIP] 移除协作者 - 缺少项目ID或协作者ID")
            return

        self.run_test(
            name="移除协作者",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators/{self.test_collaborator_id}",
            expected_status=200
        )

    def test_accept_collaboration(self):
        if not self.test_project_id or not self.test_collaborator_id:
            print("[SKIP] 接受协作邀请 - 缺少项目ID或协作者ID")
            return

        self.run_test(
            name="接受协作邀请",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators/{self.test_collaborator_id}/accept",
            expected_status=200
        )

    # ==================== 评论管理 ====================

    def test_list_comments(self):
        if not self.test_project_id:
            print("[SKIP] 获取评论列表 - 缺少项目ID")
            return

        self.run_test(
            name="获取评论列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/comments",
            expected_status=200
        )

    def test_create_comment(self):
        if not self.test_project_id:
            print("[SKIP] 创建评论 - 缺少项目ID")
            return

        comment_data = {
            "content": "This is a test comment",
            "userId": "test_user_001"
        }

        result = self.run_test(
            name="创建评论",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/comments",
            data=comment_data,
            expected_status=200
        )

        if result.response_data and "data" in result.response_data:
            data = result.response_data["data"]
            if isinstance(data, dict) and "id" in data:
                self.test_comment_id = data["id"]

    def test_update_comment(self):
        if not self.test_project_id or not self.test_comment_id:
            print("[SKIP] 更新评论 - 缺少项目ID或评论ID")
            return

        update_data = {
            "content": "Updated comment content"
        }

        self.run_test(
            name="更新评论",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/comments/{self.test_comment_id}",
            data=update_data,
            expected_status=200
        )

    def test_delete_comment(self):
        if not self.test_project_id or not self.test_comment_id:
            print("[SKIP] 删除评论 - 缺少项目ID或评论ID")
            return

        self.run_test(
            name="删除评论",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}/comments/{self.test_comment_id}",
            expected_status=200
        )

    def test_create_comment_reply(self):
        if not self.test_project_id or not self.test_comment_id:
            print("[SKIP] 创建评论回复 - 缺少项目ID或评论ID")
            return

        reply_data = {
            "content": "This is a reply",
            "userId": "test_user_002"
        }

        self.run_test(
            name="创建评论回复",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/comments/{self.test_comment_id}/replies",
            data=reply_data,
            expected_status=200
        )

    def test_list_comment_replies(self):
        if not self.test_project_id or not self.test_comment_id:
            print("[SKIP] 获取评论回复列表 - 缺少项目ID或评论ID")
            return

        self.run_test(
            name="获取评论回复列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/comments/{self.test_comment_id}/replies",
            expected_status=200
        )

    # ==================== 自动化规则 ====================

    def test_list_automation_rules(self):
        if not self.test_project_id:
            print("[SKIP] 获取自动化规则列表 - 缺少项目ID")
            return

        self.run_test(
            name="获取自动化规则列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules",
            expected_status=200
        )

    def test_create_automation_rule(self):
        if not self.test_project_id:
            print("[SKIP] 创建自动化规则 - 缺少项目ID")
            return

        rule_data = {
            "ruleName": "Auto Build Rule",
            "description": "Automatically build and test on file changes",
            "triggerEvent": "file_modified",
            "actionType": "run_script",
            "triggerConfig": {
                "filePattern": "*.java",
                "watchPaths": ["/src"]
            },
            "actionConfig": {
                "script": "npm run build && npm run test",
                "timeout": 300
            },
            "isEnabled": True
        }

        result = self.run_test(
            name="创建自动化规则",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules",
            data=rule_data,
            expected_status=200
        )

        if result.response_data and "data" in result.response_data:
            data = result.response_data["data"]
            if isinstance(data, dict) and "id" in data:
                self.test_rule_id = data["id"]

    def test_update_automation_rule(self):
        if not self.test_project_id or not self.test_rule_id:
            print("[SKIP] 更新自动化规则 - 缺少项目ID或规则ID")
            return

        update_data = {
            "name": "Updated Auto Build Rule",
            "actions": ["build", "test", "deploy"]
        }

        self.run_test(
            name="更新自动化规则",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules/{self.test_rule_id}",
            data=update_data,
            expected_status=200
        )

    def test_delete_automation_rule(self):
        if not self.test_project_id or not self.test_rule_id:
            print("[SKIP] 删除自动化规则 - 缺少项目ID或规则ID")
            return

        self.run_test(
            name="删除自动化规则",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules/{self.test_rule_id}",
            expected_status=200
        )

    def test_trigger_automation_rule(self):
        if not self.test_project_id or not self.test_rule_id:
            print("[SKIP] 触发自动化规则 - 缺少项目ID或规则ID")
            return

        self.run_test(
            name="触发自动化规则",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules/{self.test_rule_id}/trigger",
            expected_status=200
        )

    def test_toggle_automation_rule(self):
        if not self.test_project_id or not self.test_rule_id:
            print("[SKIP] 切换自动化规则状态 - 缺少项目ID或规则ID")
            return

        toggle_data = {
            "enabled": False
        }

        self.run_test(
            name="切换自动化规则状态",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules/{self.test_rule_id}/toggle",
            data=toggle_data,
            expected_status=200
        )

    def test_get_automation_stats(self):
        if not self.test_project_id:
            print("[SKIP] 获取自动化统计 - 缺少项目ID")
            return

        self.run_test(
            name="获取自动化统计",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/automation/stats",
            expected_status=200
        )

    def run_all_tests(self):
        print("\n" + "="*60)
        print("开始测试项目服务 (Spring Boot) - 完整测试套件")
        print("="*60 + "\n")

        # 项目管理 (6个)
        print("\n>>> 项目管理接口 (6个)")
        self.test_health()
        self.test_create_project()
        self.test_list_projects()
        self.test_get_project_detail()
        self.test_execute_task()

        # 文件管理 (6个)
        print("\n>>> 文件管理接口 (6个)")
        self.test_list_files()
        self.test_create_file()
        self.test_get_file_detail()
        self.test_update_file()
        self.test_batch_create_files()
        self.test_delete_file()

        # 协作者管理 (5个)
        print("\n>>> 协作者管理接口 (5个)")
        self.test_list_collaborators()
        self.test_add_collaborator()
        self.test_update_collaborator()
        self.test_accept_collaboration()
        self.test_remove_collaborator()

        # 评论管理 (6个)
        print("\n>>> 评论管理接口 (6个)")
        self.test_list_comments()
        self.test_create_comment()
        self.test_update_comment()
        self.test_create_comment_reply()
        self.test_list_comment_replies()
        self.test_delete_comment()

        # 自动化规则 (7个)
        print("\n>>> 自动化规则接口 (7个)")
        self.test_list_automation_rules()
        self.test_create_automation_rule()
        self.test_update_automation_rule()
        self.test_trigger_automation_rule()
        self.test_toggle_automation_rule()
        self.test_get_automation_stats()
        self.test_delete_automation_rule()

        # 清理：删除测试项目
        print("\n>>> 清理测试数据")
        self.test_delete_project()


if __name__ == "__main__":
    tester = ProjectServiceTester()
    tester.run_all_tests()
    tester.generate_report()
