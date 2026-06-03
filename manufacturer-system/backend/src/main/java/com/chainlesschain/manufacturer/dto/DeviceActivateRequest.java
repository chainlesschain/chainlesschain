package com.chainlesschain.manufacturer.dto;

import lombok.Data;
import jakarta.validation.constraints.NotNull;

/**
 * 设备激活请求
 */
@Data
public class DeviceActivateRequest {

    @NotNull(message = "激活码不能为空")
    private String activationCode;

    @NotNull(message = "设备ID不能为空")
    private String deviceId;

    @NotNull(message = "用户ID不能为空")
    private Long userId;

    private String masterKeyEncrypted;  // 加密的主密钥
}
