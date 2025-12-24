package com.chainlesschain.project.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import lombok.Data;
import jakarta.validation.constraints.NotBlank;

import java.util.List;

/**
 * 添加协作者请求DTO
 */
@Data
public class CollaboratorAddRequest {

    @NotBlank(message = "协作者DID不能为空")
    @JsonAlias({"userDid", "user_did"})  // 兼容多种命名方式
    private String collaboratorDid;

    @NotBlank(message = "角色不能为空")
    private String role;  // owner, admin, developer, viewer

    // 支持字符串或数组格式
    private Object permissions;  // 可以是String "read,write" 或 List<String> ["read", "write"]

    private String invitationMessage;

    /**
     * 获取权限字符串（逗号分隔）
     */
    public String getPermissionsString() {
        if (permissions == null) {
            return "";
        }
        if (permissions instanceof String) {
            return (String) permissions;
        }
        if (permissions instanceof List) {
            return String.join(",", (List<String>) permissions);
        }
        return permissions.toString();
    }
}
