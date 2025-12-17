package com.chainlesschain.community.dto;

import lombok.Data;
import javax.validation.constraints.Size;

/**
 * 更新用户信息请求DTO
 */
@Data
public class UserUpdateRequest {

    @Size(max = 50, message = "昵称长度不能超过50个字符")
    private String nickname;

    @Size(max = 255, message = "头像URL长度不能超过255个字符")
    private String avatar;

    @Size(max = 500, message = "简介长度不能超过500个字符")
    private String bio;
}
