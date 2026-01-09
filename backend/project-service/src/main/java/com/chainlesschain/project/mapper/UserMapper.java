package com.chainlesschain.project.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.project.entity.User;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 用户Mapper
 */
@Mapper
public interface UserMapper extends BaseMapper<User> {

    /**
     * 根据用户名查询用户
     */
    @Select("SELECT * FROM users WHERE username = #{username} AND deleted = 0")
    User findByUsername(@Param("username") String username);

    /**
     * 根据邮箱查询用户
     */
    @Select("SELECT * FROM users WHERE email = #{email} AND deleted = 0")
    User findByEmail(@Param("email") String email);

    /**
     * 根据DID查询用户
     */
    @Select("SELECT * FROM users WHERE did = #{did} AND deleted = 0")
    User findByDid(@Param("did") String did);

    /**
     * 更新最后登录信息
     */
    @Select("UPDATE users SET last_login_at = #{loginTime}, last_login_ip = #{loginIp} WHERE id = #{userId}")
    void updateLastLogin(@Param("userId") String userId,
                        @Param("loginTime") String loginTime,
                        @Param("loginIp") String loginIp);
}
