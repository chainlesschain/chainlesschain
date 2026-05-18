package com.chainlesschain.community.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 帖子标签关联实体
 */
@Data
@TableName("post_tags")
public class PostTag {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long postId;
    private Long tagId;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
}
