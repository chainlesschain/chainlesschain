package com.chainlesschain.project.dto;

import lombok.Data;

/**
 * 更新文件请求DTO
 */
@Data
public class FileUpdateRequest {

    private String content;  // 更新的内容

    private Boolean isBase64 = false;  // 是否为Base64编码

    private String commitMessage;  // 变更说明（用于版本控制）
}
