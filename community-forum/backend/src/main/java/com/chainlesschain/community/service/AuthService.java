package com.chainlesschain.community.service;

import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.dto.LoginRequest;
import com.chainlesschain.community.entity.User;
import com.chainlesschain.community.mapper.UserMapper;
import com.chainlesschain.community.util.JwtUtil;
import com.chainlesschain.community.util.SecurityUtil;
import com.chainlesschain.community.vo.LoginVO;
import com.chainlesschain.community.vo.UserVO;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * 认证服务
 */
@Service
public class AuthService {

    @Autowired
    private UserMapper userMapper;

    @Autowired
    private JwtUtil jwtUtil;

    /**
     * U盾/SIMKey登录
     */
    @Transactional
    public Result<LoginVO> login(LoginRequest request) {
        try {
            // 1. 验证设备ID（实际应用中需要验证U盾/SIMKey的PIN码）
            // TODO: 集成U盾/SIMKey验证逻辑

            // 2. 查询或创建用户
            User user = userMapper.findByDeviceId(request.getDeviceId());

            if (user == null) {
                // 首次登录，创建新用户
                user = createNewUser(request);
            } else {
                // 更新最后登录时间
                user.setLastLoginAt(LocalDateTime.now());
                userMapper.updateById(user);
            }

            // 3. 检查用户状态
            if ("BANNED".equals(user.getStatus())) {
                return Result.error(403, "账号已被封禁");
            }

            // 4. 生成JWT Token
            String token = jwtUtil.generateToken(user.getId(), user.getUsername(), user.getRole());

            // 5. 构建响应
            UserVO userVO = new UserVO();
            BeanUtils.copyProperties(user, userVO);

            LoginVO loginVO = new LoginVO(token, userVO);

            return Result.success(loginVO);

        } catch (Exception e) {
            e.printStackTrace();
            return Result.error("登录失败: " + e.getMessage());
        }
    }

    /**
     * 创建新用户
     */
    private User createNewUser(LoginRequest request) {
        User user = new User();
        user.setDeviceId(request.getDeviceId());
        user.setDeviceType(request.getDeviceType() != null ? request.getDeviceType() : "UKEY");
        user.setUsername("user_" + System.currentTimeMillis());
        user.setNickname("新用户");
        user.setRole("USER");
        user.setStatus("NORMAL");
        user.setPoints(100);
        user.setReputation(0);
        user.setLastLoginAt(LocalDateTime.now());

        userMapper.insert(user);
        return user;
    }

    /**
     * 获取当前用户信息
     */
    public Result<UserVO> getCurrentUser() {
        Long userId = SecurityUtil.getCurrentUserId();

        if (userId == null) {
            return Result.unauthorized();
        }

        User user = userMapper.selectById(userId);

        if (user == null) {
            return Result.error("用户不存在");
        }

        UserVO userVO = new UserVO();
        BeanUtils.copyProperties(user, userVO);

        return Result.success(userVO);
    }

    /**
     * 登出
     */
    public Result<Void> logout() {
        // JWT是无状态的，登出主要在前端清除token
        // 可以在这里添加token黑名单逻辑（如果需要）
        return Result.success();
    }
}
