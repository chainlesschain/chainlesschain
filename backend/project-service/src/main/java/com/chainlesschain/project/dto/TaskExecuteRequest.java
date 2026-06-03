package com.chainlesschain.project.dto;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;

/**
 * 执行任务请求DTO
 */
@Data
public class TaskExecuteRequest {

    @NotBlank(message = "项目ID不能为空")
    private String projectId;

    @NotBlank(message = "用户提示不能为空")
    private String userPrompt;

    private List<Map<String, String>> context;  // 对话上下文
}
