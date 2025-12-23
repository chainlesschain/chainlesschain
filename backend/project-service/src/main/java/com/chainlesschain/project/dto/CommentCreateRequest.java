package com.chainlesschain.project.dto;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;

/**
 * 创建评论请求DTO
 */
@Data
public class CommentCreateRequest {

    private String filePath;  // 批注的文件（可为空表示项目级评论）

    private Integer lineNumber;  // 代码行号（仅代码文件）

    @NotBlank(message = "评论内容不能为空")
    private String content;  // 评论内容

    private String parentCommentId;  // 回复的父评论ID
}
