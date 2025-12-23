package com.chainlesschain.project.client;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

/**
 * AI Service客户端
 * 与FastAPI AI Service通信
 */
@Slf4j
@Component
public class AiServiceClient {

    private final WebClient webClient;

    public AiServiceClient(@Value("${ai.service.url}") String aiServiceUrl,
                          @Value("${ai.service.timeout:60000}") long timeout) {
        this.webClient = WebClient.builder()
                .baseUrl(aiServiceUrl)
                .codecs(configurer -> configurer
                        .defaultCodecs()
                        .maxInMemorySize(50 * 1024 * 1024)) // 50MB，增加内存限制以处理大响应
                .build();
    }

    /**
     * 创建项目 - 调用AI Service生成文件
     */
    public Mono<JsonNode> createProject(String userPrompt, String projectType, String templateId) {
        Map<String, Object> request = new HashMap<>();
        request.put("user_prompt", userPrompt);
        if (projectType != null) {
            request.put("project_type", projectType);
        }
        if (templateId != null) {
            request.put("template_id", templateId);
        }

        return webClient.post()
                .uri("/api/projects/create")
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .onStatus(
                    status -> !status.is2xxSuccessful(),
                    response -> response.bodyToMono(String.class)
                        .map(body -> new RuntimeException("AI Service错误: " + body))
                )
                .bodyToMono(String.class)
                .map(body -> {
                    try {
                        return new com.fasterxml.jackson.databind.ObjectMapper().readTree(body);
                    } catch (Exception e) {
                        log.error("解析AI Service响应失败，响应体前1000字符: {}",
                                 body.length() > 1000 ? body.substring(0, 1000) : body);
                        throw new RuntimeException("解析响应失败: " + e.getMessage(), e);
                    }
                })
                .timeout(Duration.ofSeconds(300))
                .doOnError(error -> log.error("AI Service创建项目失败: {}", error.getMessage(), error))
                .doOnSuccess(result -> log.info("AI Service创建项目成功"));
    }

    /**
     * 执行任务
     */
    public Mono<JsonNode> executeTask(String projectId, String userPrompt, Object context) {
        Map<String, Object> request = new HashMap<>();
        request.put("project_id", projectId);
        request.put("user_prompt", userPrompt);
        if (context != null) {
            request.put("context", context);
        }

        return webClient.post()
                .uri("/api/tasks/execute")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(60))
                .doOnError(error -> log.error("AI Service执行任务失败: {}", error.getMessage()));
    }

    /**
     * 意图识别
     */
    public Mono<JsonNode> classifyIntent(String text, Object context) {
        Map<String, Object> request = new HashMap<>();
        request.put("text", text);
        if (context != null) {
            request.put("context", context);
        }

        return webClient.post()
                .uri("/api/intent/classify")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(10))
                .doOnError(error -> log.error("AI Service意图识别失败: {}", error.getMessage()));
    }

    /**
     * RAG知识检索
     */
    public Mono<JsonNode> queryKnowledge(String query, String projectId) {
        return webClient.post()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/rag/query")
                        .queryParam("query", query)
                        .queryParam("project_id", projectId)
                        .build())
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(10))
                .doOnError(error -> log.error("AI Service知识检索失败: {}", error.getMessage()));
    }

    /**
     * 健康检查
     */
    public Mono<JsonNode> healthCheck() {
        return webClient.get()
                .uri("/health")
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(5));
    }

    // ==================== Git Operations ====================

    /**
     * 初始化Git仓库
     */
    public Mono<JsonNode> gitInit(String repoPath, String remoteUrl, String branchName) {
        Map<String, Object> request = new HashMap<>();
        request.put("repo_path", repoPath);
        if (remoteUrl != null) {
            request.put("remote_url", remoteUrl);
        }
        if (branchName != null) {
            request.put("branch_name", branchName);
        }

        return webClient.post()
                .uri("/api/git/init")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(10))
                .doOnError(error -> log.error("Git初始化失败: {}", error.getMessage()));
    }

    /**
     * 获取Git状态
     */
    public Mono<JsonNode> gitStatus(String repoPath) {
        return webClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/git/status")
                        .queryParam("repo_path", repoPath)
                        .build())
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(10))
                .doOnError(error -> log.error("获取Git状态失败: {}", error.getMessage()));
    }

    /**
     * Git提交
     */
    public Mono<JsonNode> gitCommit(String repoPath, String message, Object files, Boolean autoGenerateMessage) {
        Map<String, Object> request = new HashMap<>();
        request.put("repo_path", repoPath);
        if (message != null) {
            request.put("message", message);
        }
        if (files != null) {
            request.put("files", files);
        }
        if (autoGenerateMessage != null) {
            request.put("auto_generate_message", autoGenerateMessage);
        }

        return webClient.post()
                .uri("/api/git/commit")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(30))
                .doOnError(error -> log.error("Git提交失败: {}", error.getMessage()));
    }

    /**
     * Git推送
     */
    public Mono<JsonNode> gitPush(String repoPath, String remote, String branch) {
        Map<String, Object> request = new HashMap<>();
        request.put("repo_path", repoPath);
        if (remote != null) {
            request.put("remote", remote);
        }
        if (branch != null) {
            request.put("branch", branch);
        }

        return webClient.post()
                .uri("/api/git/push")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(60))
                .doOnError(error -> log.error("Git推送失败: {}", error.getMessage()));
    }

    /**
     * Git拉取
     */
    public Mono<JsonNode> gitPull(String repoPath, String remote, String branch) {
        Map<String, Object> request = new HashMap<>();
        request.put("repo_path", repoPath);
        if (remote != null) {
            request.put("remote", remote);
        }
        if (branch != null) {
            request.put("branch", branch);
        }

        return webClient.post()
                .uri("/api/git/pull")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(60))
                .doOnError(error -> log.error("Git拉取失败: {}", error.getMessage()));
    }

    /**
     * 获取Git日志
     */
    public Mono<JsonNode> gitLog(String repoPath, Integer limit) {
        return webClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/git/log")
                        .queryParam("repo_path", repoPath)
                        .queryParam("limit", limit != null ? limit : 20)
                        .build())
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(10))
                .doOnError(error -> log.error("获取Git日志失败: {}", error.getMessage()));
    }

    /**
     * 获取Git差异
     */
    public Mono<JsonNode> gitDiff(String repoPath, String commit1, String commit2) {
        return webClient.get()
                .uri(uriBuilder -> {
                    var builder = uriBuilder.path("/api/git/diff")
                            .queryParam("repo_path", repoPath);
                    if (commit1 != null) {
                        builder.queryParam("commit1", commit1);
                    }
                    if (commit2 != null) {
                        builder.queryParam("commit2", commit2);
                    }
                    return builder.build();
                })
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(15))
                .doOnError(error -> log.error("获取Git差异失败: {}", error.getMessage()));
    }

    /**
     * 列出Git分支
     */
    public Mono<JsonNode> gitBranches(String repoPath) {
        return webClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/git/branches")
                        .queryParam("repo_path", repoPath)
                        .build())
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(10))
                .doOnError(error -> log.error("获取Git分支列表失败: {}", error.getMessage()));
    }

    /**
     * 创建Git分支
     */
    public Mono<JsonNode> gitCreateBranch(String repoPath, String branchName, String fromBranch) {
        Map<String, Object> request = new HashMap<>();
        request.put("repo_path", repoPath);
        request.put("branch_name", branchName);
        if (fromBranch != null) {
            request.put("from_branch", fromBranch);
        }

        return webClient.post()
                .uri("/api/git/branch/create")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(10))
                .doOnError(error -> log.error("创建Git分支失败: {}", error.getMessage()));
    }

    /**
     * 切换Git分支
     */
    public Mono<JsonNode> gitCheckoutBranch(String repoPath, String branchName) {
        Map<String, Object> request = new HashMap<>();
        request.put("repo_path", repoPath);
        request.put("branch_name", branchName);

        return webClient.post()
                .uri("/api/git/branch/checkout")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(10))
                .doOnError(error -> log.error("切换Git分支失败: {}", error.getMessage()));
    }

    /**
     * 合并Git分支
     */
    public Mono<JsonNode> gitMerge(String repoPath, String sourceBranch, String targetBranch) {
        Map<String, Object> request = new HashMap<>();
        request.put("repo_path", repoPath);
        request.put("source_branch", sourceBranch);
        if (targetBranch != null) {
            request.put("target_branch", targetBranch);
        }

        return webClient.post()
                .uri("/api/git/merge")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(30))
                .doOnError(error -> log.error("Git合并失败: {}", error.getMessage()));
    }

    /**
     * 解决Git冲突
     */
    public Mono<JsonNode> gitResolveConflicts(String repoPath, Map<String, Object> resolutions) {
        Map<String, Object> request = new HashMap<>();
        request.put("repo_path", repoPath);
        request.put("resolutions", resolutions);

        return webClient.post()
                .uri("/api/git/resolve-conflicts")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(30))
                .doOnError(error -> log.error("解决Git冲突失败: {}", error.getMessage()));
    }

    /**
     * AI生成提交消息
     */
    public Mono<JsonNode> gitGenerateCommitMessage(String repoPath, Object stagedFiles, String diffContent) {
        Map<String, Object> request = new HashMap<>();
        request.put("repo_path", repoPath);
        if (stagedFiles != null) {
            request.put("staged_files", stagedFiles);
        }
        if (diffContent != null) {
            request.put("diff_content", diffContent);
        }

        return webClient.post()
                .uri("/api/git/generate-commit-message")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(15))
                .doOnError(error -> log.error("AI生成提交消息失败: {}", error.getMessage()));
    }

    // ==================== RAG Indexing Operations ====================

    /**
     * 索引项目文件
     */
    public Mono<JsonNode> indexProjectFiles(String projectId, String repoPath, Object fileTypes, Boolean forceReindex) {
        Map<String, Object> request = new HashMap<>();
        request.put("project_id", projectId);
        request.put("repo_path", repoPath);
        if (fileTypes != null) {
            request.put("file_types", fileTypes);
        }
        if (forceReindex != null) {
            request.put("force_reindex", forceReindex);
        }

        return webClient.post()
                .uri("/api/rag/index/project")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(300))
                .doOnError(error -> log.error("索引项目文件失败: {}", error.getMessage()));
    }

    /**
     * 获取项目索引统计
     */
    public Mono<JsonNode> getIndexStats(String projectId) {
        return webClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/rag/index/stats")
                        .queryParam("project_id", projectId)
                        .build())
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(10))
                .doOnError(error -> log.error("获取索引统计失败: {}", error.getMessage()));
    }

    /**
     * 增强RAG查询
     */
    public Mono<JsonNode> enhancedQuery(String projectId, String query, Integer topK, Boolean useReranker, Object sources) {
        Map<String, Object> request = new HashMap<>();
        request.put("project_id", projectId);
        request.put("query", query);
        if (topK != null) {
            request.put("top_k", topK);
        }
        if (useReranker != null) {
            request.put("use_reranker", useReranker);
        }
        if (sources != null) {
            request.put("sources", sources);
        }

        return webClient.post()
                .uri("/api/rag/query/enhanced")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(30))
                .doOnError(error -> log.error("增强查询失败: {}", error.getMessage()));
    }

    /**
     * 删除项目索引
     */
    public Mono<JsonNode> deleteProjectIndex(String projectId) {
        return webClient.delete()
                .uri("/api/rag/index/project/" + projectId)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(10))
                .doOnError(error -> log.error("删除项目索引失败: {}", error.getMessage()));
    }

    /**
     * 更新单个文件索引
     */
    public Mono<JsonNode> updateFileIndex(String projectId, String filePath, String content) {
        Map<String, Object> request = new HashMap<>();
        request.put("project_id", projectId);
        request.put("file_path", filePath);
        request.put("content", content);

        return webClient.post()
                .uri("/api/rag/index/update-file")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(30))
                .doOnError(error -> log.error("更新文件索引失败: {}", error.getMessage()));
    }

    // ==================== Code Assistant Operations ====================

    /**
     * 生成代码
     */
    public Mono<JsonNode> generateCode(String description, String language, String style,
                                      Boolean includeTests, Boolean includeComments, String context) {
        Map<String, Object> request = new HashMap<>();
        request.put("description", description);
        request.put("language", language);
        if (style != null) {
            request.put("style", style);
        }
        if (includeTests != null) {
            request.put("include_tests", includeTests);
        }
        if (includeComments != null) {
            request.put("include_comments", includeComments);
        }
        if (context != null) {
            request.put("context", context);
        }

        return webClient.post()
                .uri("/api/code/generate")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(60))
                .doOnError(error -> log.error("代码生成失败: {}", error.getMessage()));
    }

    /**
     * 代码审查
     */
    public Mono<JsonNode> reviewCode(String code, String language, Object focusAreas) {
        Map<String, Object> request = new HashMap<>();
        request.put("code", code);
        request.put("language", language);
        if (focusAreas != null) {
            request.put("focus_areas", focusAreas);
        }

        return webClient.post()
                .uri("/api/code/review")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(60))
                .doOnError(error -> log.error("代码审查失败: {}", error.getMessage()));
    }

    /**
     * 代码重构
     */
    public Mono<JsonNode> refactorCode(String code, String language, String refactorType, String target) {
        Map<String, Object> request = new HashMap<>();
        request.put("code", code);
        request.put("language", language);
        if (refactorType != null) {
            request.put("refactor_type", refactorType);
        }
        if (target != null) {
            request.put("target", target);
        }

        return webClient.post()
                .uri("/api/code/refactor")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(60))
                .doOnError(error -> log.error("代码重构失败: {}", error.getMessage()));
    }

    /**
     * 代码解释
     */
    public Mono<JsonNode> explainCode(String code, String language) {
        Map<String, Object> request = new HashMap<>();
        request.put("code", code);
        request.put("language", language);

        return webClient.post()
                .uri("/api/code/explain")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(30))
                .doOnError(error -> log.error("代码解释失败: {}", error.getMessage()));
    }

    /**
     * 修复Bug
     */
    public Mono<JsonNode> fixBug(String code, String language, String bugDescription) {
        Map<String, Object> request = new HashMap<>();
        request.put("code", code);
        request.put("language", language);
        if (bugDescription != null) {
            request.put("bug_description", bugDescription);
        }

        return webClient.post()
                .uri("/api/code/fix-bug")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(60))
                .doOnError(error -> log.error("修复Bug失败: {}", error.getMessage()));
    }

    /**
     * 生成单元测试
     */
    public Mono<JsonNode> generateTests(String code, String language) {
        Map<String, Object> request = new HashMap<>();
        request.put("code", code);
        request.put("language", language);

        return webClient.post()
                .uri("/api/code/generate-tests")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(60))
                .doOnError(error -> log.error("生成测试失败: {}", error.getMessage()));
    }

    /**
     * 性能优化
     */
    public Mono<JsonNode> optimizeCode(String code, String language) {
        Map<String, Object> request = new HashMap<>();
        request.put("code", code);
        request.put("language", language);

        return webClient.post()
                .uri("/api/code/optimize")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(60))
                .doOnError(error -> log.error("代码优化失败: {}", error.getMessage()));
    }
}
