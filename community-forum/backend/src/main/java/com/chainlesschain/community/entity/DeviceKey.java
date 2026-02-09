package com.chainlesschain.community.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 设备公钥实体
 * 用于存储U盾/SIMKey设备的公钥信息
 */
@Data
@TableName("device_keys")
public class DeviceKey {

    @TableId(type = IdType.AUTO)
    private Long id;

    /**
     * 设备ID（唯一标识）
     */
    private String deviceId;

    /**
     * 设备类型（UKEY/SIMKEY）
     */
    private String deviceType;

    /**
     * 公钥（Base64编码）
     */
    private String publicKey;

    /**
     * 设备状态（active/revoked/expired）
     */
    private String status;

    /**
     * 关联的用户ID
     */
    private Long userId;

    /**
     * 设备备注/别名
     */
    private String alias;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private Integer deleted;
}
