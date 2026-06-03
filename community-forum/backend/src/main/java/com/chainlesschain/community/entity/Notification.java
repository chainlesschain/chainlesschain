package com.chainlesschain.community.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 通知实体
 */
@Data
@TableName("notifications")
public class Notification {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;
    private Long senderId;
    private String type;  // REPLY, LIKE, FAVORITE, FOLLOW, MENTION, SYSTEM
    private String title;
    private String content;
    private String link;
    private Integer isRead;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    // 非数据库字段
    @TableField(exist = false)
    private User sender;
}
