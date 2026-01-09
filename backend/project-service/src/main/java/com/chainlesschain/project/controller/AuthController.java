package com.chainlesschain.project.controller;

import com.chainlesschain.project.annotation.OperationLog;
import com.chainlesschain.project.annotation.RateLimit;
import com.chainlesschain.project.dto.AuthResponse;
import com.chainlesschain.project.dto.LoginRequest;
import com.chainlesschain.project.dto.RegisterRequest;
import com.chainlesschain.project.dto.UserCreateRequest;
import com.chainlesschain.project.dto.UserDTO;
import com.chainlesschain.project.entity.User;
import com.chainlesschain.project.mapper.UserMapper;
import com.chainlesschain.project.security.JwtUtil;
import com.chainlesschain.project.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
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

    @Autowired
    private UserService userService;

    @Autowired
    private UserMapper userMapper;

    @Value("${jwt.expiration:86400000}")
    private Long jwtExpiration;

    /**
     * 用户登录
     */
    @PostMapping("/login")
    @RateLimit(key = "auth:login", time = 60, count = 5, limitType = RateLimit.LimitType.IP)
    @OperationLog(module = "认证", type = OperationLog.OperationType.LOGIN, description = "用户登录")
    @Operation(summary = "用户登录", description = "使用用户名和密码登录，返回JWT令牌")
    public ResponseEntity<?> login(@Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest) {
        try {
            // 验证用户名和密码
            User user = userMapper.findByUsername(request.getUsername());
            if (user == null) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "用户名或密码错误"));
            }

            // 验证密码
            if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "用户名或密码错误"));
            }

            // 检查用户状态
            if (!"active".equals(user.getStatus())) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "用户已被禁用"));
            }

            // 更新最后登录信息
            String clientIp = getClientIP(httpRequest);
            userService.updateLastLogin(user.getId(), clientIp);

            // 生成JWT令牌
            Map<String, Object> claims = new HashMap<>();
            claims.put("userId", user.getId());
            if (request.getDeviceId() != null) {
                claims.put("deviceId", request.getDeviceId());
            }
            if (user.getRoles() != null) {
                claims.put("roles", user.getRoles());
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
    @RateLimit(key = "auth:register", time = 60, count = 3, limitType = RateLimit.LimitType.IP)
    @OperationLog(module = "认证", type = OperationLog.OperationType.CREATE, description = "用户注册")
    @Operation(summary = "用户注册", description = "注册新用户账号")
    public ResponseEntity<?> register(@Valid @RequestBody RegisterRequest request) {
        try {
            // 创建用户
            UserCreateRequest createRequest = new UserCreateRequest();
            createRequest.setUsername(request.getUsername());
            createRequest.setPassword(request.getPassword());
            createRequest.setEmail(request.getEmail());
            createRequest.setNickname(request.getUsername());
            createRequest.setDid(request.getDid());

            UserDTO user = userService.createUser(createRequest);

            // 生成JWT令牌
            Map<String, Object> claims = new HashMap<>();
            claims.put("userId", user.getId());
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
    @OperationLog(module = "认证", type = OperationLog.OperationType.LOGOUT, description = "用户登出")
    @Operation(summary = "用户登出", description = "登出当前用户（客户端应删除令牌）")
    public ResponseEntity<?> logout() {
        // JWT是无状态的，登出只需要客户端删除令牌
        // 如果需要服务端黑名单功能，可以将令牌加入Redis黑名单
        return ResponseEntity.ok(Map.of("message", "登出成功"));
    }

    /**
     * 获取客户端IP
     */
    private String getClientIP(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");

        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("X-Real-IP");
        }

        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }

        // 处理多个IP的情况（取第一个）
        if (ip != null && ip.contains(",")) {
            ip = ip.split(",")[0].trim();
        }

        return ip != null ? ip : "unknown";
    }
}
