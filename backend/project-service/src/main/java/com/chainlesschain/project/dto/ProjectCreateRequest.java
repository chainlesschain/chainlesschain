package com.chainlesschain.project.dto;

import lombok.Data;
import javax.validation.constraints.NotBlank;

/**
 * 创建项目请求DTO
 */
@Data
public class ProjectCreateRequest {

    @NotBlank(message = "用户提示不能为空")
    private String userPrompt;

    private String projectType;  // web, document, data (可选，AI会自动识别)

    private String templateId;

    private String name;  // 项目名称（可选，AI会自动生成）

    private String userId;  // 用户ID
}
