package com.chainlesschain.project.controller;

import com.chainlesschain.project.dto.AuthResponse;
import com.chainlesschain.project.dto.LoginRequest;
import com.chainlesschain.project.dto.RegisterRequest;
import com.chainlesschain.project.security.JwtUtil;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * 认证控制器
 * 处理用户登录、注册、令牌刷新等认证相关操作
 */
@RestController
@RequestMapping("/api/auth")
@Tag(name = "认证管理", description = "用户认证和授权相关接口")
public class AuthController {

    @Autowired
    private JwtUtil jwtUtil;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Value("${jwt.expiration:86400000}")
    private Long jwtExpiration;

    /**
     * 用户登录
     */
    @PostMapping("/login")
    @Operation(summary = "用户登录", description = "使用用户名和密码登录，返回JWT令牌")
    public ResponseEntity<?> login(@Valid @RequestBody LoginRequest request) {
        try {
            // TODO: 实际应用中应该验证用户名和密码
            // 目前为演示目的，接受任何非空用户名和密码

            // 生成JWT令牌
            Map<String, Object> claims = new HashMap<>();
            if (request.getDeviceId() != null) {
                claims.put("deviceId", request.getDeviceId());
            }

            String token = jwtUtil.generateToken(request.getUsername(), claims);

            // 返回认证响应
            AuthResponse response = new AuthResponse(
                token,
                request.getUsername(),
                jwtExpiration
            );

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "登录失败: " + e.getMessage()));
        }
    }

    /**
     * 用户注册
     */
    @PostMapping("/register")
    @Operation(summary = "用户注册", description = "注册新用户账号")
    public ResponseEntity<?> register(@Valid @RequestBody RegisterRequest request) {
        try {
            // TODO: 实际应用中应该保存用户到数据库
            // 目前为演示目的，直接返回成功

            // 加密密码（演示）
            String encodedPassword = passwordEncoder.encode(request.getPassword());

            // 生成JWT令牌
            Map<String, Object> claims = new HashMap<>();
            if (request.getDeviceId() != null) {
                claims.put("deviceId", request.getDeviceId());
            }
            if (request.getEmail() != null) {
                claims.put("email", request.getEmail());
            }

            String token = jwtUtil.generateToken(request.getUsername(), claims);

            // 返回认证响应
            AuthResponse response = new AuthResponse(
                token,
                request.getUsername(),
                jwtExpiration
            );

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "注册失败: " + e.getMessage()));
        }
    }

    /**
     * 刷新令牌
     */
    @PostMapping("/refresh")
    @Operation(summary = "刷新令牌", description = "使用现有令牌刷新获取新令牌")
    public ResponseEntity<?> refreshToken(@RequestHeader("Authorization") String authHeader) {
        try {
            if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "无效的Authorization头"));
            }

            String token = authHeader.substring(7);
            String username = jwtUtil.extractUsername(token);

            // 刷新令牌
            String newToken = jwtUtil.refreshToken(token);

            // 返回新令牌
            AuthResponse response = new AuthResponse(
                newToken,
                username,
                jwtExpiration
            );

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "刷新令牌失败: " + e.getMessage()));
        }
    }

    /**
     * 验证令牌
     */
    @GetMapping("/validate")
    @Operation(summary = "验证令牌", description = "验证JWT令牌是否有效")
    public ResponseEntity<?> validateToken(@RequestHeader("Authorization") String authHeader) {
        try {
            if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                return ResponseEntity.badRequest()
                    .body(Map.of("valid", false, "error", "无效的Authorization头"));
            }

            String token = authHeader.substring(7);
            String username = jwtUtil.extractUsername(token);
            boolean isValid = jwtUtil.validateToken(token, username);

            return ResponseEntity.ok(Map.of(
                "valid", isValid,
                "username", username
            ));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of(
                "valid", false,
                "error", e.getMessage()
            ));
        }
    }

    /**
     * 登出（客户端删除令牌即可）
     */
    @PostMapping("/logout")
    @Operation(summary = "用户登出", description = "登出当前用户（客户端应删除令牌）")
    public ResponseEntity<?> logout() {
        // JWT是无状态的，登出只需要客户端删除令牌
        // 如果需要服务端黑名单功能，可以将令牌加入Redis黑名单
        return ResponseEntity.ok(Map.of("message", "登出成功"));
    }
}
