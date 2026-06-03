package com.chainlesschain.community.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 登录响应VO
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class LoginVO {
    private String token;
    private UserVO user;
}
