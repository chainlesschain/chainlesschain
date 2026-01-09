package com.chainlesschain.project.dto;

import lombok.Data;

/**
 * 用户更新请求DTO
 */
@Data
public class UserUpdateRequest {

    private String email;
    private String phone;
    private String nickname;
    private String avatar;
    private String status;
    private String roles;
}
