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

    private String message;  // 版本备注（同 commitMessage，用于版本历史）

    private String generatedBy;  // 创建者类型（user/auto/ai）

    /**
     * 获取版本消息（优先使用 message，回退到 commitMessage）
     */
    public String getVersionMessage() {
        if (message != null && !message.isEmpty()) {
            return message;
        }
        return commitMessage;
    }
}
