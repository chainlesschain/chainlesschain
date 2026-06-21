"""
function_schemas 系统提示词构建 + Function-Calling Schema 测试（先前零覆盖）。

src/engines/function_schemas.py 决定了发给 LLM 的系统提示词与文件操作的结构化
Schema，但此前无任何测试钉住其分支契约。本文件覆盖：

  - FILE_OPERATIONS_SCHEMA: 结构不变式（name/操作枚举 CREATE/UPDATE/DELETE/READ、
    required 字段、items 必填 type+path）
  - build_project_context_prompt: 默认值回退（Unnamed Project / No description /
    general）、file_list 截断到前 20 + "... and N more files"、path/file_path 与
    type/file_type 双键回退、file_list 为空时不加文件区
  - build_system_prompt_with_context: 复用上者 + RAG 上下文最多 5 条 + score 两位
    小数格式化 + 无 rag_context 时不加上下文区

被测模块纯函数、无第三方依赖，可直接导入。无网络/不起服务，无生产代码改动。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.engines.function_schemas import (  # noqa: E402
    FILE_OPERATIONS_SCHEMA,
    build_project_context_prompt,
    build_system_prompt_with_context,
)


# --------------------------------------------------------------------------- #
# FILE_OPERATIONS_SCHEMA — 结构不变式
# --------------------------------------------------------------------------- #
class TestFileOperationsSchema:
    def test_name_and_top_level_shape(self):
        assert FILE_OPERATIONS_SCHEMA["name"] == "file_operations"
        params = FILE_OPERATIONS_SCHEMA["parameters"]
        assert params["type"] == "object"
        assert params["required"] == ["operations"]

    def test_operation_type_enum_exact(self):
        op_props = (
            FILE_OPERATIONS_SCHEMA["parameters"]["properties"]
            ["operations"]["items"]["properties"]
        )
        assert op_props["type"]["enum"] == ["CREATE", "UPDATE", "DELETE", "READ"]

    def test_each_operation_requires_type_and_path(self):
        items = FILE_OPERATIONS_SCHEMA["parameters"]["properties"]["operations"]["items"]
        assert items["required"] == ["type", "path"]


# --------------------------------------------------------------------------- #
# build_project_context_prompt
# --------------------------------------------------------------------------- #
class TestBuildProjectContextPrompt:
    def test_uses_provided_project_fields(self):
        out = build_project_context_prompt(
            {"name": "MyApp", "description": "A cool app", "type": "web"}
        )
        assert "project: MyApp" in out
        assert "Project Description: A cool app" in out
        assert "Project Type: web" in out

    def test_falls_back_to_defaults_when_fields_missing(self):
        out = build_project_context_prompt({})
        assert "Unnamed Project" in out
        assert "No description" in out
        assert "Project Type: general" in out

    def test_no_file_section_when_file_list_empty_or_none(self):
        assert "Current Project Files" not in build_project_context_prompt({})
        assert "Current Project Files" not in build_project_context_prompt({}, [])

    def test_lists_files_with_path_and_type(self):
        out = build_project_context_prompt(
            {"name": "X"},
            [{"path": "src/App.vue", "type": "vue"}],
        )
        assert "Current Project Files" in out
        assert "- src/App.vue (vue)" in out

    def test_dual_key_fallback_file_path_and_file_type(self):
        # 没有 path/type 时回退到 file_path/file_type
        out = build_project_context_prompt(
            {"name": "X"},
            [{"file_path": "main.py", "file_type": "python"}],
        )
        assert "- main.py (python)" in out

    def test_unknown_when_no_path_or_type_keys(self):
        out = build_project_context_prompt({"name": "X"}, [{}])
        assert "- unknown (unknown)" in out

    def test_truncates_to_first_20_and_reports_remainder(self):
        files = [{"path": f"f{i}.txt", "type": "txt"} for i in range(25)]
        out = build_project_context_prompt({"name": "X"}, files)
        assert "- f0.txt (txt)" in out
        assert "- f19.txt (txt)" in out
        # 第 21 个（index 20）不应列出
        assert "- f20.txt (txt)" not in out
        assert "... and 5 more files" in out

    def test_exactly_20_files_no_remainder_line(self):
        files = [{"path": f"f{i}.txt", "type": "txt"} for i in range(20)]
        out = build_project_context_prompt({"name": "X"}, files)
        assert "- f19.txt (txt)" in out
        assert "more files" not in out


# --------------------------------------------------------------------------- #
# build_system_prompt_with_context
# --------------------------------------------------------------------------- #
class TestBuildSystemPromptWithContext:
    def test_no_rag_section_when_context_empty_or_none(self):
        assert "Relevant Context" not in build_system_prompt_with_context({"name": "X"})
        assert "Relevant Context" not in build_system_prompt_with_context(
            {"name": "X"}, None, []
        )

    def test_includes_base_prompt(self):
        out = build_system_prompt_with_context({"name": "Base"})
        assert "project: Base" in out

    def test_appends_rag_context_with_score_two_decimals(self):
        out = build_system_prompt_with_context(
            {"name": "X"},
            None,
            [{"file_path": "a.py", "text": "def f(): pass", "score": 0.876543}],
        )
        assert "Relevant Context from Project Files" in out
        assert "Context 1 (from a.py, relevance: 0.88)" in out
        assert "def f(): pass" in out

    def test_caps_rag_context_at_5(self):
        ctx = [
            {"file_path": f"f{i}.py", "text": f"t{i}", "score": 0.5}
            for i in range(8)
        ]
        out = build_system_prompt_with_context({"name": "X"}, None, ctx)
        assert "Context 5 (from f4.py" in out
        # 第 6 条（index 5）不应出现
        assert "Context 6" not in out
        assert "t5" not in out

    def test_rag_defaults_when_keys_missing(self):
        out = build_system_prompt_with_context({"name": "X"}, None, [{}])
        assert "from unknown, relevance: 0.00" in out
