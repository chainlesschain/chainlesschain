package com.chainlesschain.manufacturer.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 设备实体类
 */
@Data
@TableName("devices")
public class Device {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String deviceId;

    private String deviceType;  // UKEY, SIMKEY

    private String serialNumber;

    private String manufacturer;

    private String model;

    private String hardwareVersion;

    private String firmwareVersion;

    private String status;  // INACTIVE, ACTIVE, LOCKED, DEACTIVATED

    private String activationCode;

    private LocalDateTime activationExpiresAt;

    private LocalDateTime activatedAt;

    private Long userId;

    private Long distributorId;

    private String masterKeyEncrypted;

    private String backupDataEncrypted;

    private LocalDateTime lastSeenAt;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private Integer deleted;
}
