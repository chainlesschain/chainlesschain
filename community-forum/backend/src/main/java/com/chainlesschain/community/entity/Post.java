package com.chainlesschain.community.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 帖子实体
 */
@Data
@TableName("posts")
public class Post {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;
    private Long categoryId;
    private String title;
    private String content;
    private String contentHtml;
    private String type;
    private String status;
    private Integer isPinned;
    private Integer isFeatured;
    private Integer isClosed;
    private Integer viewsCount;
    private Integer repliesCount;
    private Integer likesCount;
    private Integer favoritesCount;
    private Integer sharesCount;
    private Long bestReplyId;
    private Long lastReplyUserId;
    private LocalDateTime lastReplyAt;
    private LocalDateTime publishedAt;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private Integer deleted;

    // 非数据库字段
    @TableField(exist = false)
    private User user;

    @TableField(exist = false)
    private Category category;

    @TableField(exist = false)
    private Boolean liked;

    @TableField(exist = false)
    private Boolean favorited;
}
