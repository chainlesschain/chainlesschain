package com.chainlesschain.community.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 回复实体
 */
@Data
@TableName("replies")
public class Reply {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long postId;
    private Long userId;
    private Long parentId;
    private Long replyToUserId;
    private String content;
    private String contentHtml;
    private Integer isBestAnswer;
    private Integer isAuthor;
    private Integer likesCount;

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
    private User replyToUser;

    @TableField(exist = false)
    private Boolean liked;
}
