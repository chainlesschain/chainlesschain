package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.UserCreateRequest;
import com.chainlesschain.project.dto.UserDTO;
import com.chainlesschain.project.dto.UserUpdateRequest;
import com.chainlesschain.project.entity.Role;
import com.chainlesschain.project.entity.User;
import com.chainlesschain.project.mapper.RoleMapper;
import com.chainlesschain.project.mapper.UserMapper;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 用户服务
 */
@Service
public class UserService {

    @Autowired
    private UserMapper userMapper;

    @Autowired
    private RoleMapper roleMapper;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /**
     * 创建用户
     */
    @Transactional
    public UserDTO createUser(UserCreateRequest request) {
        // 检查用户名是否已存在
        User existingUser = userMapper.findByUsername(request.getUsername());
        if (existingUser != null) {
            throw new RuntimeException("用户名已存在");
        }

        // 检查邮箱是否已存在
        if (request.getEmail() != null) {
            existingUser = userMapper.findByEmail(request.getEmail());
            if (existingUser != null) {
                throw new RuntimeException("邮箱已被使用");
            }
        }

        // 创建用户
        User user = new User();
        user.setUsername(request.getUsername());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setEmail(request.getEmail());
        user.setPhone(request.getPhone());
        user.setNickname(request.getNickname() != null ? request.getNickname() : request.getUsername());
        user.setAvatar(request.getAvatar());
        user.setStatus("active");
        user.setRoles(request.getRoles() != null ? request.getRoles() : "ROLE_USER");
        user.setDid(request.getDid());
        user.setCreatedAt(LocalDateTime.now());
        user.setUpdatedAt(LocalDateTime.now());

        userMapper.insert(user);

        return convertToDTO(user);
    }

    /**
     * 更新用户
     */
    @Transactional
    public UserDTO updateUser(String userId, UserUpdateRequest request) {
        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new RuntimeException("用户不存在");
        }

        // 更新字段
        if (request.getEmail() != null) {
            user.setEmail(request.getEmail());
        }
        if (request.getPhone() != null) {
            user.setPhone(request.getPhone());
        }
        if (request.getNickname() != null) {
            user.setNickname(request.getNickname());
        }
        if (request.getAvatar() != null) {
            user.setAvatar(request.getAvatar());
        }
        if (request.getStatus() != null) {
            user.setStatus(request.getStatus());
        }
        if (request.getRoles() != null) {
            user.setRoles(request.getRoles());
        }
        user.setUpdatedAt(LocalDateTime.now());

        userMapper.updateById(user);

        return convertToDTO(user);
    }

    /**
     * 删除用户（逻辑删除）
     */
    @Transactional
    public void deleteUser(String userId) {
        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new RuntimeException("用户不存在");
        }

        userMapper.deleteById(userId);
    }

    /**
     * 获取用户详情
     */
    public UserDTO getUserById(String userId) {
        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new RuntimeException("用户不存在");
        }

        return convertToDTO(user);
    }

    /**
     * 根据用户名获取用户
     */
    public UserDTO getUserByUsername(String username) {
        User user = userMapper.findByUsername(username);
        if (user == null) {
            throw new RuntimeException("用户不存在");
        }

        return convertToDTO(user);
    }

    /**
     * 获取用户列表（分页）
     */
    public Page<UserDTO> getUserList(int page, int pageSize, String keyword, String status) {
        Page<User> userPage = new Page<>(page, pageSize);
        QueryWrapper<User> queryWrapper = new QueryWrapper<>();

        if (keyword != null && !keyword.isEmpty()) {
            queryWrapper.and(wrapper -> wrapper
                .like("username", keyword)
                .or()
                .like("email", keyword)
                .or()
                .like("nickname", keyword)
            );
        }

        if (status != null && !status.isEmpty()) {
            queryWrapper.eq("status", status);
        }

        queryWrapper.orderByDesc("created_at");

        Page<User> result = userMapper.selectPage(userPage, queryWrapper);

        Page<UserDTO> dtoPage = new Page<>(result.getCurrent(), result.getSize(), result.getTotal());
        List<UserDTO> dtoList = result.getRecords().stream()
            .map(this::convertToDTO)
            .collect(Collectors.toList());
        dtoPage.setRecords(dtoList);

        return dtoPage;
    }

    /**
     * 修改密码
     */
    @Transactional
    public void changePassword(String userId, String oldPassword, String newPassword) {
        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new RuntimeException("用户不存在");
        }

        // 验证旧密码
        if (!passwordEncoder.matches(oldPassword, user.getPassword())) {
            throw new RuntimeException("原密码不正确");
        }

        // 更新密码
        user.setPassword(passwordEncoder.encode(newPassword));
        user.setUpdatedAt(LocalDateTime.now());
        userMapper.updateById(user);
    }

    /**
     * 重置密码（管理员操作）
     */
    @Transactional
    public void resetPassword(String userId, String newPassword) {
        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new RuntimeException("用户不存在");
        }

        user.setPassword(passwordEncoder.encode(newPassword));
        user.setUpdatedAt(LocalDateTime.now());
        userMapper.updateById(user);
    }

    /**
     * 更新最后登录信息
     */
    @Transactional
    public void updateLastLogin(String userId, String loginIp) {
        String loginTime = LocalDateTime.now().format(FORMATTER);
        userMapper.updateLastLogin(userId, loginTime, loginIp);
    }

    /**
     * 获取用户角色列表
     */
    public List<Role> getUserRoles(String userId) {
        return roleMapper.findByUserId(userId);
    }

    /**
     * 转换为DTO
     */
    private UserDTO convertToDTO(User user) {
        UserDTO dto = new UserDTO();
        BeanUtils.copyProperties(user, dto);

        if (user.getCreatedAt() != null) {
            dto.setCreatedAt(user.getCreatedAt().format(FORMATTER));
        }
        if (user.getUpdatedAt() != null) {
            dto.setUpdatedAt(user.getUpdatedAt().format(FORMATTER));
        }
        if (user.getLastLoginAt() != null) {
            dto.setLastLoginAt(user.getLastLoginAt().format(FORMATTER));
        }

        return dto;
    }
}
