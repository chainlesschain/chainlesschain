package com.chainlesschain.community.dto;

import lombok.Data;
import javax.validation.constraints.Size;
import java.util.List;

/**
 * 更新帖子请求DTO
 */
@Data
public class PostUpdateRequest {

    @Size(max = 200, message = "标题长度不能超过200个字符")
    private String title;

    @Size(max = 50000, message = "内容长度不能超过50000个字符")
    private String content;

    private Long categoryId;

    private List<String> tags;

    private String type;
}
