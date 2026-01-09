package com.chainlesschain.project.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.UserCreateRequest;
import com.chainlesschain.project.dto.UserDTO;
import com.chainlesschain.project.dto.UserUpdateRequest;
import com.chainlesschain.project.entity.Role;
import com.chainlesschain.project.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 用户管理控制器
 */
@RestController
@RequestMapping("/api/users")
@Tag(name = "用户管理", description = "用户CRUD和管理相关接口")
public class UserController {

    @Autowired
    private UserService userService;

    /**
     * 创建用户
     */
    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(summary = "创建用户", description = "创建新用户（需要管理员权限）")
    public ResponseEntity<?> createUser(@Valid @RequestBody UserCreateRequest request) {
        try {
            UserDTO user = userService.createUser(request);
            return ResponseEntity.ok(user);
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 更新用户
     */
    @PutMapping("/{userId}")
    @Operation(summary = "更新用户", description = "更新用户信息")
    public ResponseEntity<?> updateUser(
            @PathVariable String userId,
            @Valid @RequestBody UserUpdateRequest request,
            Authentication authentication) {
        try {
            // 检查权限：只能更新自己的信息，或者管理员可以更新任何人
            String currentUsername = authentication.getName();
            UserDTO currentUser = userService.getUserByUsername(currentUsername);

            if (!currentUser.getId().equals(userId) &&
                !currentUser.getRoles().contains("ROLE_ADMIN")) {
                return ResponseEntity.status(403)
                    .body(Map.of("error", "无权修改其他用户信息"));
            }

            UserDTO user = userService.updateUser(userId, request);
            return ResponseEntity.ok(user);
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 删除用户
     */
    @DeleteMapping("/{userId}")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(summary = "删除用户", description = "删除用户（需要管理员权限）")
    public ResponseEntity<?> deleteUser(@PathVariable String userId) {
        try {
            userService.deleteUser(userId);
            return ResponseEntity.ok(Map.of("success", true, "message", "用户已删除"));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 获取用户详情
     */
    @GetMapping("/{userId}")
    @Operation(summary = "获取用户详情", description = "根据ID获取用户详细信息")
    public ResponseEntity<?> getUserById(@PathVariable String userId) {
        try {
            UserDTO user = userService.getUserById(userId);
            return ResponseEntity.ok(user);
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 获取当前用户信息
     */
    @GetMapping("/me")
    @Operation(summary = "获取当前用户", description = "获取当前登录用户的信息")
    public ResponseEntity<?> getCurrentUser(Authentication authentication) {
        try {
            String username = authentication.getName();
            UserDTO user = userService.getUserByUsername(username);
            return ResponseEntity.ok(user);
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 获取用户列表
     */
    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(summary = "获取用户列表", description = "分页获取用户列表（需要管理员权限）")
    public ResponseEntity<?> getUserList(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String status) {
        try {
            Page<UserDTO> userPage = userService.getUserList(page, pageSize, keyword, status);
            return ResponseEntity.ok(Map.of(
                "records", userPage.getRecords(),
                "total", userPage.getTotal(),
                "page", userPage.getCurrent(),
                "pageSize", userPage.getSize(),
                "totalPages", userPage.getPages()
            ));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 修改密码
     */
    @PostMapping("/change-password")
    @Operation(summary = "修改密码", description = "修改当前用户密码")
    public ResponseEntity<?> changePassword(
            @RequestBody Map<String, String> request,
            Authentication authentication) {
        try {
            String username = authentication.getName();
            UserDTO user = userService.getUserByUsername(username);

            String oldPassword = request.get("oldPassword");
            String newPassword = request.get("newPassword");

            if (oldPassword == null || newPassword == null) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "旧密码和新密码不能为空"));
            }

            userService.changePassword(user.getId(), oldPassword, newPassword);
            return ResponseEntity.ok(Map.of("success", true, "message", "密码修改成功"));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 重置密码（管理员）
     */
    @PostMapping("/{userId}/reset-password")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(summary = "重置密码", description = "重置用户密码（需要管理员权限）")
    public ResponseEntity<?> resetPassword(
            @PathVariable String userId,
            @RequestBody Map<String, String> request) {
        try {
            String newPassword = request.get("newPassword");
            if (newPassword == null) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "新密码不能为空"));
            }

            userService.resetPassword(userId, newPassword);
            return ResponseEntity.ok(Map.of("success", true, "message", "密码重置成功"));
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 获取用户角色
     */
    @GetMapping("/{userId}/roles")
    @Operation(summary = "获取用户角色", description = "获取用户的角色列表")
    public ResponseEntity<?> getUserRoles(@PathVariable String userId) {
        try {
            List<Role> roles = userService.getUserRoles(userId);
            return ResponseEntity.ok(roles);
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
}
