package com.chainlesschain.community.controller;

import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.dto.LoginRequest;
import com.chainlesschain.community.service.AuthService;
import com.chainlesschain.community.vo.LoginVO;
import com.chainlesschain.community.vo.UserVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;

/**
 * 认证控制器
 */
@RestController
@RequestMapping("/api/auth")
@Tag(name = "认证管理", description = "用户登录、注册、登出等接口")
public class AuthController {

    @Autowired
    private AuthService authService;

    /**
     * U盾/SIMKey登录
     */
    @PostMapping("/login")
    @Operation(summary = "用户登录", description = "使用U盾或SIMKey进行登录")
    public Result<LoginVO> login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }

    /**
     * 获取当前用户信息
     */
    @GetMapping("/current")
    @Operation(summary = "获取当前用户信息", description = "获取当前登录用户的详细信息")
    public Result<UserVO> getCurrentUser() {
        return authService.getCurrentUser();
    }

    /**
     * 登出
     */
    @PostMapping("/logout")
    @Operation(summary = "用户登出", description = "退出登录")
    public Result<Void> logout() {
        return authService.logout();
    }
}
