package com.chainlesschain.manufacturer.dto;

import lombok.Data;

/**
 * 设备查询请求
 */
@Data
public class DeviceQueryRequest {
    private String deviceType;
    private String status;
    private String keyword;
    private Integer page = 1;
    private Integer size = 20;
}
