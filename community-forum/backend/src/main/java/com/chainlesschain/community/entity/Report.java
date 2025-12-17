package com.chainlesschain.community.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 举报实体
 */
@Data
@TableName("reports")
public class Report {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;
    private String targetType;  // POST, REPLY, USER
    private Long targetId;
    private String reason;      // SPAM, ABUSE, INAPPROPRIATE, COPYRIGHT, OTHER
    private String description;
    private String status;      // PENDING, PROCESSING, RESOLVED, REJECTED
    private Long handlerId;
    private String result;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    // 非数据库字段
    @TableField(exist = false)
    private User user;

    @TableField(exist = false)
    private User handler;
}
