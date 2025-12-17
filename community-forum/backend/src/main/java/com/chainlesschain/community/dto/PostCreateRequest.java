package com.chainlesschain.community.dto;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 创建帖子请求DTO
 */
@Data
public class PostCreateRequest {

    @NotBlank(message = "标题不能为空")
    @Size(max = 200, message = "标题长度不能超过200个字符")
    private String title;

    @NotBlank(message = "内容不能为空")
    @Size(max = 50000, message = "内容长度不能超过50000个字符")
    private String content;

    @NotNull(message = "分类ID不能为空")
    private Long categoryId;

    private List<String> tags; // 标签名称列表

    private String type; // QUESTION, DISCUSSION, FEEDBACK, ANNOUNCEMENT
}
