package com.chainlesschain.manufacturer.dto;

import lombok.Data;
import jakarta.validation.constraints.NotNull;

/**
 * 检查更新请求
 */
@Data
public class CheckUpdateRequest {

    @NotNull(message = "设备ID不能为空")
    private String deviceId;

    @NotNull(message = "APP类型不能为空")
    private String appType;  // PC_WINDOWS, PC_MAC, MOBILE_ANDROID, MOBILE_IOS

    @NotNull(message = "当前版本不能为空")
    private String currentVersion;

    private String channel;  // stable, beta, alpha
}
