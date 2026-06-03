package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 同步日志实体
 */
@Data
@TableName("sync_logs")
public class SyncLog {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    @TableField("table_name")
    private String tableName;

    @TableField("record_id")
    private String recordId;

    private String operation;  // create, update, delete

    private String direction;  // upload, download

    private String status;  // success, failed, pending

    @TableField("error_message")
    private String errorMessage;

    @TableField("device_id")
    private String deviceId;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}
