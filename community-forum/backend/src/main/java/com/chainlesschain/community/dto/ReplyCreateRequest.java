package com.chainlesschain.community.dto;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 创建回复请求DTO
 */
@Data
public class ReplyCreateRequest {

    @NotNull(message = "帖子ID不能为空")
    private Long postId;

    @NotBlank(message = "回复内容不能为空")
    @Size(max = 10000, message = "回复内容长度不能超过10000个字符")
    private String content;

    private Long parentId; // 父回复ID（可选）

    private Long replyToUserId; // 回复给谁（可选）
}
