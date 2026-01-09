package com.chainlesschain.project.dto;

import lombok.Data;

/**
 * 用户DTO
 */
@Data
public class UserDTO {

    private String id;
    private String username;
    private String email;
    private String phone;
    private String nickname;
    private String avatar;
    private String status;
    private String roles;
    private String did;
    private String lastLoginAt;
    private String lastLoginIp;
    private String createdAt;
    private String updatedAt;
}
