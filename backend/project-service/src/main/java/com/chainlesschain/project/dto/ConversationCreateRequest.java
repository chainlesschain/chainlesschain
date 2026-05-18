package com.chainlesschain.project.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 创建对话请求
 */
@Data
public class ConversationCreateRequest {

    /**
     * 对话标题
     */
    @NotBlank(message = "对话标题不能为空")
    private String title;

    /**
     * 项目ID（可选）
     */
    private String projectId;

    /**
     * 用户ID
     */
    @NotBlank(message = "用户ID不能为空")
    private String userId;

    /**
     * 上下文模式：project/file/global
     */
    private String contextMode;

    /**
     * 上下文数据（JSON格式）
     */
    private String contextData;
}
