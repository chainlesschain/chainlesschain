package com.chainlesschain.project.security;

import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;

/**
 * 自定义用户详情服务
 * 用于加载用户信息（后续可集成数据库）
 */
@Service
public class CustomUserDetailsService implements UserDetailsService {

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        // TODO: 从数据库加载用户信息
        // 目前返回模拟用户，实际应用中应该查询数据库

        // 模拟用户验证
        if (username == null || username.isEmpty()) {
            throw new UsernameNotFoundException("用户名不能为空");
        }

        // 返回用户详情（密码已加密）
        // 实际应用中应该从数据库查询用户信息
        return User.builder()
                .username(username)
                .password("") // 密码在JWT验证中不需要
                .authorities(new ArrayList<>())
                .build();
    }
}
