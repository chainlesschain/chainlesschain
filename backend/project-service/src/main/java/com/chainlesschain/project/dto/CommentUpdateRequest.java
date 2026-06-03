package com.chainlesschain.project.dto;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;

/**
 * 更新评论请求DTO
 */
@Data
public class CommentUpdateRequest {

    @NotBlank(message = "评论内容不能为空")
    private String content;
}
