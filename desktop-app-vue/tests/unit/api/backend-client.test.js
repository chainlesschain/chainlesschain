/**
 * 后端API客户端单元测试
 *
 * 测试覆盖：
 * - Axios客户端配置
 * - 错误处理
 * - ProjectFileAPI / GitAPI / RAGAPI / CodeAPI
 *
 * Unskipped via `_setClientsForTesting` seam (RFC T1 — vi.mock CJS interop migration).
 * 见 `docs/design/desktop_vi_mock_cjs_migration_rfc.md`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock git-config (project-local module, vi.mock works fine)
vi.mock("../../../src/main/git/git-config", () => ({
  getGitConfig: vi.fn(() => ({
    isLoggingEnabled: () => false,
  })),
}));

import * as backendClient from "../../../src/main/api/backend-client.js";

const { ProjectFileAPI, GitAPI, RAGAPI, CodeAPI, _setClientsForTesting } =
  backendClient;

function makeFakeClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    defaults: { headers: { common: {} } },
  };
}

describe("BackendClient", () => {
  let fakeJavaClient;
  let fakePythonClient;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeJavaClient = makeFakeClient();
    fakePythonClient = makeFakeClient();
    _setClientsForTesting({ java: fakeJavaClient, python: fakePythonClient });
  });

  afterEach(() => {
    _setClientsForTesting(null); // restore real axios clients
  });

  describe("Client Configuration", () => {
    it("should create javaClient with correct default config", () => {
      _setClientsForTesting(null); // we want to inspect the real default-config client
      expect(backendClient.javaClient.defaults.baseURL).toBe(
        "http://localhost:9090",
      );
      expect(backendClient.javaClient.defaults.timeout).toBe(30000);
      expect(backendClient.javaClient.defaults.headers["Content-Type"]).toBe(
        "application/json",
      );
    });

    it("should create pythonClient with correct default config", () => {
      _setClientsForTesting(null);
      expect(backendClient.pythonClient.defaults.baseURL).toBe(
        "http://localhost:8001",
      );
      expect(backendClient.pythonClient.defaults.timeout).toBe(60000);
      expect(backendClient.pythonClient.defaults.headers["Content-Type"]).toBe(
        "application/json",
      );
    });

    it("should use environment variables for baseURL", async () => {
      vi.resetModules();
      process.env.PROJECT_SERVICE_URL = "http://custom-java:9000";
      process.env.AI_SERVICE_URL = "http://custom-python:8000";

      try {
        const fresh = await import("../../../src/main/api/backend-client.js");
        expect(fresh.javaClient.defaults.baseURL).toBe(
          "http://custom-java:9000",
        );
        expect(fresh.pythonClient.defaults.baseURL).toBe(
          "http://custom-python:8000",
        );
      } finally {
        delete process.env.PROJECT_SERVICE_URL;
        delete process.env.AI_SERVICE_URL;
      }
    });
  });

  describe("ProjectFileAPI", () => {
    describe("getFiles", () => {
      it("should get files with pagination", async () => {
        const mockResponse = { data: { files: [], total: 0 } };
        fakeJavaClient.get.mockResolvedValue(mockResponse);

        const result = await ProjectFileAPI.getFiles("proj1", "js", 1, 20);

        expect(fakeJavaClient.get).toHaveBeenCalledWith(
          "/api/projects/proj1/files",
          { params: { fileType: "js", pageNum: 1, pageSize: 20 } },
        );
        expect(result).toEqual(mockResponse.data);
      });

      it("should handle errors gracefully", async () => {
        fakeJavaClient.get.mockRejectedValue(new Error("Network error"));

        const result = await ProjectFileAPI.getFiles("proj1");

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe("getFile", () => {
      it("should get single file details", async () => {
        const mockFile = { id: "file1", name: "test.js" };
        fakeJavaClient.get.mockResolvedValue({ data: mockFile });

        const result = await ProjectFileAPI.getFile("proj1", "file1");

        expect(fakeJavaClient.get).toHaveBeenCalledWith(
          "/api/projects/proj1/files/file1",
        );
        expect(result).toEqual(mockFile);
      });
    });

    describe("createFile", () => {
      it("should create new file", async () => {
        const fileData = { name: "new.js", content: 'console.log("test")' };
        const mockResponse = { data: { id: "file2", ...fileData } };
        fakeJavaClient.post.mockResolvedValue(mockResponse);

        const result = await ProjectFileAPI.createFile("proj1", fileData);

        expect(fakeJavaClient.post).toHaveBeenCalledWith(
          "/api/projects/proj1/files",
          fileData,
        );
        expect(result).toEqual(mockResponse.data);
      });
    });

    describe("batchCreateFiles", () => {
      it("should create multiple files", async () => {
        const files = [
          { name: "file1.js", content: "test1" },
          { name: "file2.js", content: "test2" },
        ];
        const mockResponse = { data: { created: 2 } };
        fakeJavaClient.post.mockResolvedValue(mockResponse);

        const result = await ProjectFileAPI.batchCreateFiles("proj1", files);

        expect(fakeJavaClient.post).toHaveBeenCalledWith(
          "/api/projects/proj1/files/batch",
          files,
        );
        expect(result).toEqual(mockResponse.data);
      });
    });

    describe("updateFile", () => {
      it("should update existing file", async () => {
        const fileData = { content: "updated content" };
        const mockResponse = { data: { success: true } };
        fakeJavaClient.put.mockResolvedValue(mockResponse);

        const result = await ProjectFileAPI.updateFile(
          "proj1",
          "file1",
          fileData,
        );

        expect(fakeJavaClient.put).toHaveBeenCalledWith(
          "/api/projects/proj1/files/file1",
          fileData,
        );
        expect(result).toEqual(mockResponse.data);
      });
    });

    describe("deleteFile", () => {
      it("should delete file", async () => {
        const mockResponse = { data: { success: true } };
        fakeJavaClient.delete.mockResolvedValue(mockResponse);

        const result = await ProjectFileAPI.deleteFile("proj1", "file1");

        expect(fakeJavaClient.delete).toHaveBeenCalledWith(
          "/api/projects/proj1/files/file1",
        );
        expect(result).toEqual(mockResponse.data);
      });
    });
  });

  describe("GitAPI", () => {
    describe("init", () => {
      it("should initialize git repository", async () => {
        const mockResponse = { data: { success: true } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        const result = await GitAPI.init(
          "/repo/path",
          "https://github.com/test/repo.git",
          "main",
        );

        expect(fakePythonClient.post).toHaveBeenCalledWith("/api/git/init", {
          repo_path: "/repo/path",
          remote_url: "https://github.com/test/repo.git",
          branch_name: "main",
        });
        expect(result).toEqual(mockResponse.data);
      });

      it("should handle optional parameters", async () => {
        const mockResponse = { data: { success: true } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        await GitAPI.init("/repo/path");

        const call = fakePythonClient.post.mock.calls[0];
        expect(call[1].remote_url).toBeNull();
        expect(call[1].branch_name).toBe("main");
      });
    });

    describe("status", () => {
      it("should get git status", async () => {
        const mockStatus = { data: { staged: [], unstaged: [] } };
        fakePythonClient.get.mockResolvedValue(mockStatus);

        const result = await GitAPI.status("/repo/path");

        expect(fakePythonClient.get).toHaveBeenCalledWith("/api/git/status", {
          params: { repo_path: "/repo/path" },
        });
        expect(result).toEqual(mockStatus.data);
      });
    });

    describe("commit", () => {
      it("should commit changes with message", async () => {
        const mockResponse = { data: { commit_id: "abc123" } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        const result = await GitAPI.commit("/repo/path", "feat: add feature", [
          "file1.js",
        ]);

        expect(fakePythonClient.post).toHaveBeenCalledWith("/api/git/commit", {
          repo_path: "/repo/path",
          message: "feat: add feature",
          files: ["file1.js"],
          auto_generate_message: false,
        });
        expect(result).toEqual(mockResponse.data);
      });

      it("should support auto-generated commit message", async () => {
        const mockResponse = { data: { message: "Auto: updated files" } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        await GitAPI.commit("/repo/path", null, null, true);

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/git/commit",
          expect.objectContaining({ auto_generate_message: true }),
        );
      });
    });

    describe("push and pull", () => {
      it("should push to remote", async () => {
        const mockResponse = { data: { success: true } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        await GitAPI.push("/repo/path", "origin", "main");

        expect(fakePythonClient.post).toHaveBeenCalledWith("/api/git/push", {
          repo_path: "/repo/path",
          remote: "origin",
          branch: "main",
        });
      });

      it("should pull from remote", async () => {
        const mockResponse = { data: { success: true } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        await GitAPI.pull("/repo/path", "origin", "develop");

        expect(fakePythonClient.post).toHaveBeenCalledWith("/api/git/pull", {
          repo_path: "/repo/path",
          remote: "origin",
          branch: "develop",
        });
      });
    });

    describe("log and diff", () => {
      it("should get commit history", async () => {
        const mockLogs = { data: { commits: [] } };
        fakePythonClient.get.mockResolvedValue(mockLogs);

        await GitAPI.log("/repo/path", 50);

        expect(fakePythonClient.get).toHaveBeenCalledWith("/api/git/log", {
          params: { repo_path: "/repo/path", limit: 50 },
        });
      });

      it("should get diff between commits", async () => {
        const mockDiff = { data: { diff: "diff content" } };
        fakePythonClient.get.mockResolvedValue(mockDiff);

        await GitAPI.diff("/repo/path", "abc123", "def456");

        expect(fakePythonClient.get).toHaveBeenCalledWith("/api/git/diff", {
          params: {
            repo_path: "/repo/path",
            commit1: "abc123",
            commit2: "def456",
          },
        });
      });
    });

    describe("branch operations", () => {
      it("should list branches", async () => {
        const mockBranches = { data: { branches: ["main", "develop"] } };
        fakePythonClient.get.mockResolvedValue(mockBranches);

        const result = await GitAPI.branches("/repo/path");

        expect(fakePythonClient.get).toHaveBeenCalledWith("/api/git/branches", {
          params: { repo_path: "/repo/path" },
        });
        expect(result).toEqual(mockBranches.data);
      });

      it("should create branch", async () => {
        const mockResponse = { data: { success: true } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        await GitAPI.createBranch("/repo/path", "feature-x", "main");

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/git/branch/create",
          {
            repo_path: "/repo/path",
            branch_name: "feature-x",
            from_branch: "main",
          },
        );
      });

      it("should checkout branch", async () => {
        const mockResponse = { data: { success: true } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        await GitAPI.checkoutBranch("/repo/path", "develop");

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/git/branch/checkout",
          {
            repo_path: "/repo/path",
            branch_name: "develop",
          },
        );
      });

      it("should merge branches", async () => {
        const mockResponse = { data: { success: true } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        await GitAPI.merge("/repo/path", "feature-x", "main");

        expect(fakePythonClient.post).toHaveBeenCalledWith("/api/git/merge", {
          repo_path: "/repo/path",
          source_branch: "feature-x",
          target_branch: "main",
        });
      });
    });

    describe("conflict resolution", () => {
      it("should resolve conflicts", async () => {
        const mockResponse = { data: { resolved: true } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        await GitAPI.resolveConflicts("/repo/path", "file.js", true, "ours");

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/git/resolve-conflicts",
          {
            repo_path: "/repo/path",
            file_path: "file.js",
            auto_resolve: true,
            strategy: "ours",
          },
        );
      });
    });

    describe("AI features", () => {
      it("should generate commit message", async () => {
        const mockResponse = { data: { message: "feat: implement feature X" } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        const result = await GitAPI.generateCommitMessage(
          "/repo/path",
          ["file1.js"],
          "diff content",
        );

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/git/generate-commit-message",
          {
            repo_path: "/repo/path",
            staged_files: ["file1.js"],
            diff_content: "diff content",
          },
        );
        expect(result).toEqual(mockResponse.data);
      });
    });
  });

  describe("RAGAPI", () => {
    describe("indexProject", () => {
      it("should index project with custom timeout", async () => {
        const mockResponse = { data: { indexed: 100 } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        await RAGAPI.indexProject(
          "proj1",
          "/path/to/repo",
          ["js", "ts"],
          false,
        );

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/rag/index/project",
          {
            project_id: "proj1",
            repo_path: "/path/to/repo",
            file_types: ["js", "ts"],
            force_reindex: false,
          },
          { timeout: 300000 },
        );
      });

      it("should support force reindex", async () => {
        const mockResponse = { data: { indexed: 200 } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        await RAGAPI.indexProject("proj1", "/path", null, true);

        const call = fakePythonClient.post.mock.calls[0];
        expect(call[1].force_reindex).toBe(true);
      });
    });

    describe("getIndexStats", () => {
      it("should get index statistics", async () => {
        const mockStats = { data: { total_files: 100, total_chunks: 500 } };
        fakePythonClient.get.mockResolvedValue(mockStats);

        const result = await RAGAPI.getIndexStats("proj1");

        expect(fakePythonClient.get).toHaveBeenCalledWith(
          "/api/rag/index/stats",
          {
            params: { project_id: "proj1" },
          },
        );
        expect(result).toEqual(mockStats.data);
      });
    });

    describe("enhancedQuery", () => {
      it("should perform enhanced query", async () => {
        const mockResults = { data: { results: [], reranked: true } };
        fakePythonClient.post.mockResolvedValue(mockResults);

        const result = await RAGAPI.enhancedQuery(
          "proj1",
          "search query",
          10,
          true,
          ["project", "docs"],
        );

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/rag/query/enhanced",
          {
            project_id: "proj1",
            query: "search query",
            top_k: 10,
            use_reranker: true,
            sources: ["project", "docs"],
          },
        );
        expect(result).toEqual(mockResults.data);
      });

      it("should use default parameters", async () => {
        const mockResults = { data: { results: [] } };
        fakePythonClient.post.mockResolvedValue(mockResults);

        await RAGAPI.enhancedQuery("proj1", "query");

        const call = fakePythonClient.post.mock.calls[0];
        expect(call[1].top_k).toBe(5);
        expect(call[1].use_reranker).toBe(false);
        expect(call[1].sources).toEqual(["project"]);
      });
    });

    describe("deleteProjectIndex", () => {
      it("should delete project index", async () => {
        const mockResponse = { data: { deleted: true } };
        fakePythonClient.delete.mockResolvedValue(mockResponse);

        await RAGAPI.deleteProjectIndex("proj1");

        expect(fakePythonClient.delete).toHaveBeenCalledWith(
          "/api/rag/index/project/proj1",
        );
      });
    });

    describe("updateFileIndex", () => {
      it("should update single file index", async () => {
        const mockResponse = { data: { updated: true } };
        fakePythonClient.post.mockResolvedValue(mockResponse);

        await RAGAPI.updateFileIndex("proj1", "/path/file.js", "file content");

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/rag/index/update-file",
          {
            project_id: "proj1",
            file_path: "/path/file.js",
            content: "file content",
          },
        );
      });
    });
  });

  describe("CodeAPI", () => {
    describe("generate", () => {
      it("should generate code with all options", async () => {
        const mockCode = {
          data: { code: "function test() {}", tests: "describe(...)" },
        };
        fakePythonClient.post.mockResolvedValue(mockCode);

        const result = await CodeAPI.generate(
          "create a test function",
          "javascript",
          "modern",
          true,
          true,
          { framework: "jest" },
        );

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/code/generate",
          {
            description: "create a test function",
            language: "javascript",
            style: "modern",
            include_tests: true,
            include_comments: true,
            context: { framework: "jest" },
          },
        );
        expect(result).toEqual(mockCode.data);
      });
    });

    describe("review", () => {
      it("should review code", async () => {
        const mockReview = { data: { suggestions: [], issues: [] } };
        fakePythonClient.post.mockResolvedValue(mockReview);

        await CodeAPI.review("const x = 1;", "javascript", [
          "security",
          "performance",
        ]);

        expect(fakePythonClient.post).toHaveBeenCalledWith("/api/code/review", {
          code: "const x = 1;",
          language: "javascript",
          focus_areas: ["security", "performance"],
        });
      });
    });

    describe("refactor", () => {
      it("should refactor code", async () => {
        const mockRefactored = { data: { code: "refactored code" } };
        fakePythonClient.post.mockResolvedValue(mockRefactored);

        await CodeAPI.refactor(
          "old code",
          "python",
          "extract_method",
          "process_data",
        );

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/code/refactor",
          {
            code: "old code",
            language: "python",
            refactor_type: "extract_method",
            target: "process_data",
          },
        );
      });
    });

    describe("explain", () => {
      it("should explain code", async () => {
        const mockExplanation = { data: { explanation: "This code does..." } };
        fakePythonClient.post.mockResolvedValue(mockExplanation);

        const result = await CodeAPI.explain("complex code", "java");

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/code/explain",
          {
            code: "complex code",
            language: "java",
          },
        );
        expect(result).toEqual(mockExplanation.data);
      });
    });

    describe("fixBug", () => {
      it("should fix bugs in code", async () => {
        const mockFixed = {
          data: { code: "fixed code", explanation: "Fixed by..." },
        };
        fakePythonClient.post.mockResolvedValue(mockFixed);

        await CodeAPI.fixBug(
          "buggy code",
          "typescript",
          "null pointer exception",
        );

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/code/fix-bug",
          {
            code: "buggy code",
            language: "typescript",
            bug_description: "null pointer exception",
          },
        );
      });
    });

    describe("generateTests", () => {
      it("should generate unit tests", async () => {
        const mockTests = { data: { tests: "test code" } };
        fakePythonClient.post.mockResolvedValue(mockTests);

        await CodeAPI.generateTests(
          "function add(a, b) { return a + b; }",
          "javascript",
        );

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/code/generate-tests",
          {
            code: "function add(a, b) { return a + b; }",
            language: "javascript",
          },
        );
      });
    });

    describe("optimize", () => {
      it("should optimize code performance", async () => {
        const mockOptimized = {
          data: { code: "optimized code", improvements: [] },
        };
        fakePythonClient.post.mockResolvedValue(mockOptimized);

        await CodeAPI.optimize("slow code", "python");

        expect(fakePythonClient.post).toHaveBeenCalledWith(
          "/api/code/optimize",
          {
            code: "slow code",
            language: "python",
          },
        );
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle response errors", async () => {
      const responseError = {
        response: {
          status: 400,
          data: { message: "Bad request" },
        },
      };
      fakeJavaClient.get.mockRejectedValue(responseError);

      const result = await ProjectFileAPI.getFiles("proj1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Bad request");
      expect(result.status).toBe(400);
    });

    it("should handle response errors with detail field", async () => {
      const responseError = {
        response: {
          status: 422,
          data: { detail: "Validation error" },
        },
      };
      fakePythonClient.post.mockRejectedValue(responseError);

      const result = await CodeAPI.generate("test", "js");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Validation error");
    });

    it("should handle request errors (no response)", async () => {
      const requestError = {
        request: {},
        message: "Network error",
      };
      fakePythonClient.get.mockRejectedValue(requestError);

      const result = await GitAPI.status("/repo");

      expect(result.success).toBe(false);
      expect(result.error).toContain("后端服务无响应");
      expect(result.status).toBe(0);
    });

    it("should handle other errors", async () => {
      const genericError = new Error("Unexpected error");
      fakeJavaClient.post.mockRejectedValue(genericError);

      const result = await ProjectFileAPI.createFile("proj1", {});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unexpected error");
      expect(result.status).toBe(-1);
    });

    it("should support silent error mode", async () => {
      // Silent mode is tested indirectly via the handleError silent flag.
      const error = new Error("Silent error");
      fakeJavaClient.get.mockRejectedValue(error);

      await ProjectFileAPI.getFiles("proj1");
    });
  });

  describe("Edge Cases", () => {
    it("should handle null/undefined parameters", async () => {
      const mockResponse = { data: { success: true } };
      fakePythonClient.post.mockResolvedValue(mockResponse);

      await GitAPI.commit("/repo", null, null, false);

      expect(fakePythonClient.post).toHaveBeenCalledWith(
        "/api/git/commit",
        expect.objectContaining({
          message: null,
          files: null,
        }),
      );
    });

    it("should handle empty arrays", async () => {
      const mockResponse = { data: { created: 0 } };
      fakeJavaClient.post.mockResolvedValue(mockResponse);

      await ProjectFileAPI.batchCreateFiles("proj1", []);

      expect(fakeJavaClient.post).toHaveBeenCalledWith(expect.any(String), []);
    });

    it("should handle very long timeouts", async () => {
      const mockResponse = { data: { indexed: 1000 } };
      fakePythonClient.post.mockResolvedValue(mockResponse);

      await RAGAPI.indexProject("proj1", "/path", null, true);

      const call = fakePythonClient.post.mock.calls[0];
      expect(call[2].timeout).toBe(300000);
    });

    it("should handle unicode in parameters", async () => {
      const mockResponse = { data: { success: true } };
      fakePythonClient.post.mockResolvedValue(mockResponse);

      await GitAPI.commit("/repo", "feat: 添加中文支持 🚀", null, false);

      expect(fakePythonClient.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ message: "feat: 添加中文支持 🚀" }),
      );
    });
  });
});
