package com.chainlesschain.project.dto;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;

/**
 * 添加协作者请求DTO
 */
@Data
public class CollaboratorAddRequest {

    @NotBlank(message = "协作者DID不能为空")
    private String collaboratorDid;

    @NotBlank(message = "权限不能为空")
    private String permissions;  // read, write, admin

    private String invitationMessage;
}
