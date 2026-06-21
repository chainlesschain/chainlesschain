package com.chainlesschain.project.service;

import com.chainlesschain.project.dto.UserCreateRequest;
import com.chainlesschain.project.dto.UserDTO;
import com.chainlesschain.project.dto.UserUpdateRequest;
import com.chainlesschain.project.entity.User;
import com.chainlesschain.project.mapper.RoleMapper;
import com.chainlesschain.project.mapper.UserMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link UserService} 测试（先前零覆盖）。
 *
 * 用户服务涉及密码加密、用户名/邮箱查重、改密旧密码校验等安全相关分支，此前没有
 * 任何测试。纯 Mockito 单元（mapper/PasswordEncoder 全 mock），不需 Spring/DB。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class UserServiceTest {

    @Mock private UserMapper userMapper;
    @Mock private RoleMapper roleMapper;
    @Mock private PasswordEncoder passwordEncoder;

    @InjectMocks private UserService userService;

    private UserCreateRequest createReq(String username) {
        UserCreateRequest r = new UserCreateRequest();
        r.setUsername(username);
        r.setPassword("plain-pw");
        return r;
    }

    // ----------------------------------------------------------------- //
    // createUser
    // ----------------------------------------------------------------- //
    @org.junit.jupiter.api.Test
    void createUser_duplicateUsername_throws_andDoesNotInsert() {
        when(userMapper.findByUsername("bob")).thenReturn(new User());
        assertThrows(RuntimeException.class, () -> userService.createUser(createReq("bob")));
        verify(userMapper, never()).insert(any(User.class));
    }

    @Test
    void createUser_duplicateEmail_throws() {
        UserCreateRequest r = createReq("new");
        r.setEmail("taken@x.com");
        when(userMapper.findByUsername("new")).thenReturn(null);
        when(userMapper.findByEmail("taken@x.com")).thenReturn(new User());
        assertThrows(RuntimeException.class, () -> userService.createUser(r));
        verify(userMapper, never()).insert(any(User.class));
    }

    @Test
    void createUser_encodesPassword_andAppliesDefaults() {
        when(userMapper.findByUsername("alice")).thenReturn(null);
        when(passwordEncoder.encode("plain-pw")).thenReturn("ENC(plain-pw)");

        UserDTO dto = userService.createUser(createReq("alice"));

        ArgumentCaptor<User> cap = ArgumentCaptor.forClass(User.class);
        verify(userMapper).insert(cap.capture());
        User saved = cap.getValue();
        assertEquals("ENC(plain-pw)", saved.getPassword());   // 明文不入库
        assertEquals("alice", saved.getNickname());           // nickname 默认=username
        assertEquals("active", saved.getStatus());
        assertEquals("ROLE_USER", saved.getRoles());          // roles 默认
        assertEquals("alice", dto.getUsername());
    }

    @Test
    void createUser_keepsExplicitNicknameAndRoles() {
        UserCreateRequest r = createReq("carol");
        r.setNickname("Caz");
        r.setRoles("ROLE_ADMIN");
        when(userMapper.findByUsername("carol")).thenReturn(null);
        when(passwordEncoder.encode(anyString())).thenReturn("ENC");

        userService.createUser(r);

        ArgumentCaptor<User> cap = ArgumentCaptor.forClass(User.class);
        verify(userMapper).insert(cap.capture());
        assertEquals("Caz", cap.getValue().getNickname());
        assertEquals("ROLE_ADMIN", cap.getValue().getRoles());
    }

    @Test
    void createUser_nullEmail_skipsEmailDuplicateCheck() {
        when(userMapper.findByUsername("dan")).thenReturn(null);
        when(passwordEncoder.encode(anyString())).thenReturn("ENC");
        userService.createUser(createReq("dan"));  // email 为 null
        verify(userMapper, never()).findByEmail(any());
    }

    // ----------------------------------------------------------------- //
    // updateUser
    // ----------------------------------------------------------------- //
    @Test
    void updateUser_notFound_throws() {
        when(userMapper.selectById("x")).thenReturn(null);
        assertThrows(RuntimeException.class, () -> userService.updateUser("x", new UserUpdateRequest()));
    }

    @Test
    void updateUser_onlyNonNullFieldsApplied() {
        User existing = new User();
        existing.setEmail("old@x.com");
        existing.setPhone("123");
        when(userMapper.selectById("u1")).thenReturn(existing);

        UserUpdateRequest r = new UserUpdateRequest();
        r.setEmail("new@x.com");   // phone left null
        userService.updateUser("u1", r);

        ArgumentCaptor<User> cap = ArgumentCaptor.forClass(User.class);
        verify(userMapper).updateById(cap.capture());
        assertEquals("new@x.com", cap.getValue().getEmail());
        assertEquals("123", cap.getValue().getPhone());   // 未传 → 保持原值
    }

    // ----------------------------------------------------------------- //
    // deleteUser / getters
    // ----------------------------------------------------------------- //
    @Test
    void deleteUser_notFound_throws_elseDeletes() {
        when(userMapper.selectById("gone")).thenReturn(null);
        assertThrows(RuntimeException.class, () -> userService.deleteUser("gone"));

        when(userMapper.selectById("u2")).thenReturn(new User());
        userService.deleteUser("u2");
        verify(userMapper).deleteById("u2");
    }

    @Test
    void getUserById_notFound_throws() {
        when(userMapper.selectById("nope")).thenReturn(null);
        assertThrows(RuntimeException.class, () -> userService.getUserById("nope"));
    }

    @Test
    void getUserById_formatsTimestamps() {
        User u = new User();
        u.setUsername("ed");
        u.setCreatedAt(LocalDateTime.of(2026, 1, 2, 3, 4, 5));
        when(userMapper.selectById("u3")).thenReturn(u);
        UserDTO dto = userService.getUserById("u3");
        assertEquals("ed", dto.getUsername());
        assertEquals("2026-01-02 03:04:05", dto.getCreatedAt());
    }

    @Test
    void getUserByUsername_notFound_throws() {
        when(userMapper.findByUsername("ghost")).thenReturn(null);
        assertThrows(RuntimeException.class, () -> userService.getUserByUsername("ghost"));
    }

    // ----------------------------------------------------------------- //
    // changePassword / resetPassword
    // ----------------------------------------------------------------- //
    @Test
    void changePassword_wrongOldPassword_throws_andNoUpdate() {
        User u = new User();
        u.setPassword("ENC(current)");
        when(userMapper.selectById("u4")).thenReturn(u);
        when(passwordEncoder.matches("wrong", "ENC(current)")).thenReturn(false);

        assertThrows(RuntimeException.class,
                () -> userService.changePassword("u4", "wrong", "newpw"));
        verify(userMapper, never()).updateById(any(User.class));
    }

    @Test
    void changePassword_correctOld_encodesAndUpdates() {
        User u = new User();
        u.setPassword("ENC(current)");
        when(userMapper.selectById("u5")).thenReturn(u);
        when(passwordEncoder.matches("current", "ENC(current)")).thenReturn(true);
        when(passwordEncoder.encode("newpw")).thenReturn("ENC(newpw)");

        userService.changePassword("u5", "current", "newpw");

        ArgumentCaptor<User> cap = ArgumentCaptor.forClass(User.class);
        verify(userMapper).updateById(cap.capture());
        assertEquals("ENC(newpw)", cap.getValue().getPassword());
    }

    @Test
    void resetPassword_notFound_throws() {
        when(userMapper.selectById("x")).thenReturn(null);
        assertThrows(RuntimeException.class, () -> userService.resetPassword("x", "n"));
    }

    @Test
    void resetPassword_encodesWithoutOldPasswordCheck() {
        when(userMapper.selectById("u6")).thenReturn(new User());
        when(passwordEncoder.encode("admin-set")).thenReturn("ENC(admin-set)");
        userService.resetPassword("u6", "admin-set");
        ArgumentCaptor<User> cap = ArgumentCaptor.forClass(User.class);
        verify(userMapper).updateById(cap.capture());
        assertEquals("ENC(admin-set)", cap.getValue().getPassword());
        verify(passwordEncoder, never()).matches(anyString(), anyString());
    }

    // ----------------------------------------------------------------- //
    // updateLastLogin / getUserRoles
    // ----------------------------------------------------------------- //
    @Test
    void updateLastLogin_passesFormattedTimeAndIp() {
        userService.updateLastLogin("u7", "10.0.0.1");
        verify(userMapper).updateLastLogin(eq("u7"), anyString(), eq("10.0.0.1"));
    }

    @Test
    void getUserRoles_delegatesToRoleMapper() {
        userService.getUserRoles("u8");
        verify(roleMapper).findByUserId("u8");
    }
}
