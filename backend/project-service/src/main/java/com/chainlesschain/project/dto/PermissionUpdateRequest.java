package com.chainlesschain.project.dto;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;

/**
 * 权限更新请求DTO
 */
@Data
public class PermissionUpdateRequest {

    @NotBlank(message = "权限不能为空")
    private String permissions;  // read, write, admin
}
