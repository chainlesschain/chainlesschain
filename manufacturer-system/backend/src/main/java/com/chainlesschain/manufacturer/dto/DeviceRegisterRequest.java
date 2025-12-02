package com.chainlesschain.manufacturer.dto;

import lombok.Data;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * 设备注册请求
 */
@Data
public class DeviceRegisterRequest {

    @NotEmpty(message = "设备列表不能为空")
    private List<DeviceInfo> devices;

    @Data
    public static class DeviceInfo {
        @NotNull(message = "设备类型不能为空")
        private String deviceType;  // UKEY, SIMKEY

        @NotNull(message = "序列号不能为空")
        private String serialNumber;

        private String manufacturer;
        private String model;
        private String hardwareVersion;
        private String firmwareVersion;
    }
}
