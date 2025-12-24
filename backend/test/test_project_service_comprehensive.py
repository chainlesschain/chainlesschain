"""
项目服务 (Spring Boot) 全面接口测试
覆盖所有Controller的API端点
端口: 9090
"""
from test_framework import APITester, validate_success_response, validate_has_data, validate_pagination
import uuid


class ProjectServiceComprehensiveTester(APITester):
    def __init__(self, base_url: str = "http://localhost:9090"):
        super().__init__(base_url)
        self.test_project_id = None
        self.test_file_id = None
        self.test_collaborator_id = None
        self.test_comment_id = None
        self.test_rule_id = None
        self.test_device_id = f"device_{uuid.uuid4().hex[:8]}"

    # ========================================
    # ProjectController Tests
    # ========================================
    def test_project_health(self):
        """测试项目服务健康检查"""
        self.run_test(
            name="[ProjectController] 健康检查",
            method="GET",
            endpoint="/api/projects/health",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_create_project(self):
        """测试创建项目"""
        project_data = {
            "name": f"综合测试项目_{uuid.uuid4().hex[:8]}",
            "description": "这是一个全面的自动化测试项目",
            "projectType": "web",
            "userId": "test_user_comprehensive",
            "template": "react"
        }

        result = self.run_test(
            name="[ProjectController] 创建项目",
            method="POST",
            endpoint="/api/projects/create",
            data=project_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r) or validate_has_data(r)
        )

        # 提取项目ID供后续测试使用
        if result.response_data and "data" in result.response_data:
            data = result.response_data["data"]
            if isinstance(data, dict):
                self.test_project_id = data.get("projectId") or data.get("id")

    def test_list_projects(self):
        """测试获取项目列表"""
        self.run_test(
            name="[ProjectController] 获取项目列表",
            method="GET",
            endpoint="/api/projects/list",
            params={"pageNum": 1, "pageSize": 10},
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_get_project_detail(self):
        """测试获取项目详情"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        self.run_test(
            name="[ProjectController] 获取项目详情",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r) or validate_has_data(r)
        )

    def test_execute_task(self):
        """测试执行任务"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        task_data = {
            "projectId": self.test_project_id,
            "taskType": "generate_file",
            "taskDescription": "创建一个README.md文件",
            "parameters": {
                "fileName": "README.md",
                "content": "# Test Project\n\nThis is a test."
            }
        }

        self.run_test(
            name="[ProjectController] 执行任务",
            method="POST",
            endpoint="/api/projects/tasks/execute",
            data=task_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    # ========================================
    # ProjectFileController Tests
    # ========================================
    def test_create_file(self):
        """测试创建文件"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        file_data = {
            "fileName": "test.js",
            "filePath": "/src/test.js",
            "fileType": "javascript",
            "content": "console.log('Hello, World!');",
            "language": "javascript"
        }

        result = self.run_test(
            name="[ProjectFileController] 创建文件",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/files",
            data=file_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

        # 提取文件ID
        if result.response_data and "data" in result.response_data:
            data = result.response_data["data"]
            if isinstance(data, dict):
                self.test_file_id = data.get("id") or data.get("fileId")

    def test_batch_create_files(self):
        """测试批量创建文件"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        files_data = [
            {
                "fileName": "app.js",
                "filePath": "/src/app.js",
                "fileType": "javascript",
                "content": "// Main app file",
                "language": "javascript"
            },
            {
                "fileName": "utils.js",
                "filePath": "/src/utils.js",
                "fileType": "javascript",
                "content": "// Utility functions",
                "language": "javascript"
            }
        ]

        self.run_test(
            name="[ProjectFileController] 批量创建文件",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/files/batch",
            data=files_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_list_files(self):
        """测试获取文件列表"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        self.run_test(
            name="[ProjectFileController] 获取文件列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/files",
            params={"pageNum": 1, "pageSize": 50},
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_get_file_detail(self):
        """测试获取文件详情"""
        if not self.test_project_id or not self.test_file_id:
            print("  跳过：需要先创建项目和文件")
            return

        self.run_test(
            name="[ProjectFileController] 获取文件详情",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/files/{self.test_file_id}",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r) or validate_has_data(r)
        )

    def test_update_file(self):
        """测试更新文件"""
        if not self.test_project_id or not self.test_file_id:
            print("  跳过：需要先创建项目和文件")
            return

        update_data = {
            "content": "console.log('Updated content');",
            "updateReason": "Test update"
        }

        self.run_test(
            name="[ProjectFileController] 更新文件",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/files/{self.test_file_id}",
            data=update_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    # ========================================
    # CollaboratorController Tests
    # ========================================
    def test_add_collaborator(self):
        """测试添加协作者"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        collaborator_data = {
            "userDid": f"did:example:test_user_{uuid.uuid4().hex[:8]}",
            "userName": "测试协作者",
            "role": "developer",
            "permissions": ["read", "write"]
        }

        result = self.run_test(
            name="[CollaboratorController] 添加协作者",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators",
            data=collaborator_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

        # 提取协作者ID
        if result.response_data and "data" in result.response_data:
            data = result.response_data["data"]
            if isinstance(data, dict):
                self.test_collaborator_id = data.get("id") or data.get("collaboratorId")

    def test_list_collaborators(self):
        """测试获取协作者列表"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        self.run_test(
            name="[CollaboratorController] 获取协作者列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_update_collaborator_permissions(self):
        """测试更新协作者权限"""
        if not self.test_project_id or not self.test_collaborator_id:
            print("  跳过：需要先创建项目和添加协作者")
            return

        permission_data = {
            "role": "maintainer",
            "permissions": ["read", "write", "admin"]
        }

        self.run_test(
            name="[CollaboratorController] 更新协作者权限",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators/{self.test_collaborator_id}",
            data=permission_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_accept_invitation(self):
        """测试接受邀请"""
        if not self.test_project_id or not self.test_collaborator_id:
            print("  跳过：需要先创建项目和添加协作者")
            return

        self.run_test(
            name="[CollaboratorController] 接受邀请",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators/{self.test_collaborator_id}/accept",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    # ========================================
    # CommentController Tests
    # ========================================
    def test_add_comment(self):
        """测试添加评论"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        comment_data = {
            "content": "这是一条测试评论",
            "filePath": "/src/test.js",
            "lineNumber": 1,
            "commentType": "general"
        }

        result = self.run_test(
            name="[CommentController] 添加评论",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/comments",
            data=comment_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

        # 提取评论ID
        if result.response_data and "data" in result.response_data:
            data = result.response_data["data"]
            if isinstance(data, dict):
                self.test_comment_id = data.get("id") or data.get("commentId")

    def test_list_comments(self):
        """测试获取评论列表"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        self.run_test(
            name="[CommentController] 获取评论列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/comments",
            params={"pageNum": 1, "pageSize": 20},
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_update_comment(self):
        """测试更新评论"""
        if not self.test_project_id or not self.test_comment_id:
            print("  跳过：需要先创建项目和评论")
            return

        update_data = {
            "content": "这是更新后的评论内容"
        }

        self.run_test(
            name="[CommentController] 更新评论",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/comments/{self.test_comment_id}",
            data=update_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_reply_comment(self):
        """测试回复评论"""
        if not self.test_project_id or not self.test_comment_id:
            print("  跳过：需要先创建项目和评论")
            return

        reply_data = {
            "content": "这是一条回复"
        }

        self.run_test(
            name="[CommentController] 回复评论",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/comments/{self.test_comment_id}/replies",
            data=reply_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_get_comment_replies(self):
        """测试获取评论回复"""
        if not self.test_project_id or not self.test_comment_id:
            print("  跳过：需要先创建项目和评论")
            return

        self.run_test(
            name="[CommentController] 获取评论回复",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/comments/{self.test_comment_id}/replies",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    # ========================================
    # AutomationController Tests
    # ========================================
    def test_create_automation_rule(self):
        """测试创建自动化规则"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        rule_data = {
            "ruleName": "自动测试规则",
            "triggerType": "file_change",
            "triggerCondition": {
                "pattern": "*.js"
            },
            "actionType": "run_tests",
            "actionConfig": {
                "command": "npm test"
            },
            "isEnabled": True
        }

        result = self.run_test(
            name="[AutomationController] 创建自动化规则",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules",
            data=rule_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

        # 提取规则ID
        if result.response_data and "data" in result.response_data:
            data = result.response_data["data"]
            if isinstance(data, dict):
                self.test_rule_id = data.get("id") or data.get("ruleId")

    def test_list_automation_rules(self):
        """测试获取自动化规则列表"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        self.run_test(
            name="[AutomationController] 获取自动化规则列表",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_update_automation_rule(self):
        """测试更新自动化规则"""
        if not self.test_project_id or not self.test_rule_id:
            print("  跳过：需要先创建项目和规则")
            return

        update_data = {
            "ruleName": "更新后的自动化规则",
            "isEnabled": False
        }

        self.run_test(
            name="[AutomationController] 更新自动化规则",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules/{self.test_rule_id}",
            data=update_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_toggle_automation_rule(self):
        """测试启用/禁用自动化规则"""
        if not self.test_project_id or not self.test_rule_id:
            print("  跳过：需要先创建项目和规则")
            return

        self.run_test(
            name="[AutomationController] 启用/禁用规则",
            method="PUT",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules/{self.test_rule_id}/toggle",
            params={"enabled": True},
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_manual_trigger_rule(self):
        """测试手动触发规则"""
        if not self.test_project_id or not self.test_rule_id:
            print("  跳过：需要先创建项目和规则")
            return

        self.run_test(
            name="[AutomationController] 手动触发规则",
            method="POST",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules/{self.test_rule_id}/trigger",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_get_automation_stats(self):
        """测试获取自动化统计"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        self.run_test(
            name="[AutomationController] 获取自动化统计",
            method="GET",
            endpoint=f"/api/projects/{self.test_project_id}/automation/stats",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    # ========================================
    # SyncController Tests
    # ========================================
    def test_sync_health(self):
        """测试同步服务健康检查"""
        self.run_test(
            name="[SyncController] 同步服务健康检查",
            method="GET",
            endpoint="/api/sync/health",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_sync_upload(self):
        """测试批量上传数据"""
        upload_data = {
            "tableName": "notes",
            "deviceId": self.test_device_id,
            "records": [
                {
                    "id": f"note_{uuid.uuid4().hex[:8]}",
                    "title": "测试笔记",
                    "content": "这是测试内容",
                    "updated_at": 1703001600000
                }
            ]
        }

        self.run_test(
            name="[SyncController] 批量上传数据",
            method="POST",
            endpoint="/api/sync/upload",
            data=upload_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_sync_download(self):
        """测试增量下载数据"""
        self.run_test(
            name="[SyncController] 增量下载数据",
            method="GET",
            endpoint="/api/sync/download/notes",
            params={
                "deviceId": self.test_device_id,
                "lastSyncedAt": 0
            },
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_sync_status(self):
        """测试获取同步状态"""
        self.run_test(
            name="[SyncController] 获取同步状态",
            method="GET",
            endpoint="/api/sync/status",
            params={"deviceId": self.test_device_id},
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_resolve_sync_conflict(self):
        """测试解决同步冲突"""
        conflict_data = {
            "conflictId": f"conflict_{uuid.uuid4().hex[:8]}",
            "resolution": "use_server",
            "deviceId": self.test_device_id
        }

        self.run_test(
            name="[SyncController] 解决同步冲突",
            method="POST",
            endpoint="/api/sync/resolve-conflict",
            data=conflict_data,
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    # ========================================
    # Cleanup Tests (DELETE operations)
    # ========================================
    def test_delete_comment(self):
        """测试删除评论"""
        if not self.test_project_id or not self.test_comment_id:
            print("  跳过：需要先创建项目和评论")
            return

        self.run_test(
            name="[CommentController] 删除评论",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}/comments/{self.test_comment_id}",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_remove_collaborator(self):
        """测试移除协作者"""
        if not self.test_project_id or not self.test_collaborator_id:
            print("  跳过：需要先创建项目和协作者")
            return

        self.run_test(
            name="[CollaboratorController] 移除协作者",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}/collaborators/{self.test_collaborator_id}",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_delete_automation_rule(self):
        """测试删除自动化规则"""
        if not self.test_project_id or not self.test_rule_id:
            print("  跳过：需要先创建项目和规则")
            return

        self.run_test(
            name="[AutomationController] 删除自动化规则",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}/automation/rules/{self.test_rule_id}",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_delete_file(self):
        """测试删除文件"""
        if not self.test_project_id or not self.test_file_id:
            print("  跳过：需要先创建项目和文件")
            return

        self.run_test(
            name="[ProjectFileController] 删除文件",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}/files/{self.test_file_id}",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    def test_delete_project(self):
        """测试删除项目（最后执行）"""
        if not self.test_project_id:
            print("  跳过：需要先创建项目")
            return

        self.run_test(
            name="[ProjectController] 删除项目",
            method="DELETE",
            endpoint=f"/api/projects/{self.test_project_id}",
            expected_status=200,
            validate_func=lambda r: validate_success_response(r)
        )

    # ========================================
    # Run All Tests
    # ========================================
    def run_all_tests(self):
        """运行所有测试（按依赖顺序）"""
        print("\n" + "="*80)
        print("开始全面测试项目服务 (Spring Boot) - 所有Controller")
        print("="*80 + "\n")

        # 1. Health Checks
        print("\n--- 健康检查 ---")
        self.test_project_health()
        self.test_sync_health()

        # 2. Project CRUD
        print("\n--- 项目管理 ---")
        self.test_create_project()
        self.test_list_projects()
        self.test_get_project_detail()
        self.test_execute_task()

        # 3. File Management
        print("\n--- 文件管理 ---")
        self.test_create_file()
        self.test_batch_create_files()
        self.test_list_files()
        self.test_get_file_detail()
        self.test_update_file()

        # 4. Collaboration
        print("\n--- 协作管理 ---")
        self.test_add_collaborator()
        self.test_list_collaborators()
        self.test_update_collaborator_permissions()
        self.test_accept_invitation()

        # 5. Comments
        print("\n--- 评论管理 ---")
        self.test_add_comment()
        self.test_list_comments()
        self.test_update_comment()
        self.test_reply_comment()
        self.test_get_comment_replies()

        # 6. Automation
        print("\n--- 自动化规则 ---")
        self.test_create_automation_rule()
        self.test_list_automation_rules()
        self.test_update_automation_rule()
        self.test_toggle_automation_rule()
        self.test_manual_trigger_rule()
        self.test_get_automation_stats()

        # 7. Data Sync
        print("\n--- 数据同步 ---")
        self.test_sync_upload()
        self.test_sync_download()
        self.test_sync_status()
        self.test_resolve_sync_conflict()

        # 8. Cleanup (DELETE operations)
        print("\n--- 清理资源 ---")
        self.test_delete_comment()
        self.test_remove_collaborator()
        self.test_delete_automation_rule()
        self.test_delete_file()
        self.test_delete_project()


if __name__ == "__main__":
    tester = ProjectServiceComprehensiveTester()
    tester.run_all_tests()
    tester.generate_report(
        markdown=True,
        json_report=True
    )
