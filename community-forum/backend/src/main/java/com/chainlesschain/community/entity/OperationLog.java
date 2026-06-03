package com.chainlesschain.community.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 操作日志实体
 */
@Data
@TableName("operation_logs")
public class OperationLog {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;
    private String action;
    private String targetType;
    private Long targetId;
    private String ipAddress;
    private String userAgent;
    private String details;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
}
