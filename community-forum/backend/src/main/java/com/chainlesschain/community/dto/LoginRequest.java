package com.chainlesschain.community.dto;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;

/**
 * 登录请求DTO
 */
@Data
public class LoginRequest {

    @NotBlank(message = "设备ID不能为空")
    private String deviceId;

    @NotBlank(message = "PIN码不能为空")
    private String pin;

    private String deviceType; // UKEY / SIMKEY

    /**
     * 设备签名（生产模式必需）
     * 使用设备私钥对challenge进行签名
     */
    private String signature;

    /**
     * 挑战值（生产模式必需）
     * 由服务器生成，客户端签名后返回
     */
    private String challenge;
}
