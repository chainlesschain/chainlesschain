package com.chainlesschain.marketplace.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.marketplace.entity.User;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * User Mapper
 * 用户数据访问接口
 *
 * @author ChainlessChain Team
 */
@Mapper
public interface UserMapper extends BaseMapper<User> {

    /**
     * Find user by username
     */
    @Select("SELECT * FROM users WHERE username = #{username} AND deleted = false")
    User findByUsername(@Param("username") String username);

    /**
     * Find user by email
     */
    @Select("SELECT * FROM users WHERE email = #{email} AND deleted = false")
    User findByEmail(@Param("email") String email);

    /**
     * Find user by DID
     */
    @Select("SELECT * FROM users WHERE did = #{did} AND deleted = false")
    User findByDid(@Param("did") String did);
}
