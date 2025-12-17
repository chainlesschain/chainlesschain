package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.community.entity.User;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * 用户Mapper接口
 */
@Mapper
public interface UserMapper extends BaseMapper<User> {

    /**
     * 根据设备ID查询用户
     */
    @Select("SELECT * FROM users WHERE device_id = #{deviceId} AND deleted = 0")
    User findByDeviceId(@Param("deviceId") String deviceId);

    /**
     * 根据DID查询用户
     */
    @Select("SELECT * FROM users WHERE did = #{did} AND deleted = 0")
    User findByDid(@Param("did") String did);

    /**
     * 根据用户名查询用户
     */
    @Select("SELECT * FROM users WHERE username = #{username} AND deleted = 0")
    User findByUsername(@Param("username") String username);

    /**
     * 更新用户统计数
     */
    @Update("UPDATE users SET posts_count = posts_count + #{increment} WHERE id = #{userId}")
    void incrementPostsCount(@Param("userId") Long userId, @Param("increment") int increment);

    @Update("UPDATE users SET replies_count = replies_count + #{increment} WHERE id = #{userId}")
    void incrementRepliesCount(@Param("userId") Long userId, @Param("increment") int increment);

    @Update("UPDATE users SET followers_count = followers_count + #{increment} WHERE id = #{userId}")
    void incrementFollowersCount(@Param("userId") Long userId, @Param("increment") int increment);

    @Update("UPDATE users SET following_count = following_count + #{increment} WHERE id = #{userId}")
    void incrementFollowingCount(@Param("userId") Long userId, @Param("increment") int increment);

    @Update("UPDATE users SET points = points + #{points} WHERE id = #{userId}")
    void incrementPoints(@Param("userId") Long userId, @Param("points") int points);

    @Update("UPDATE users SET reputation = reputation + #{reputation} WHERE id = #{userId}")
    void incrementReputation(@Param("userId") Long userId, @Param("reputation") int reputation);
}
