package com.chainlesschain.community.dto;

import lombok.Data;
import javax.validation.constraints.NotBlank;

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
}
