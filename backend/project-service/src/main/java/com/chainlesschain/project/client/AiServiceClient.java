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
                .bodyValue(request)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(60))
                .doOnError(error -> log.error("AI Service创建项目失败: {}", error.getMessage()));
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
}
