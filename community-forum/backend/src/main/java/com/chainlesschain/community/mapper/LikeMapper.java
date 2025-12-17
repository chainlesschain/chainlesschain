package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.community.entity.Like;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 点赞Mapper接口
 */
@Mapper
public interface LikeMapper extends BaseMapper<Like> {

    /**
     * 查询用户是否点赞
     */
    @Select("SELECT COUNT(*) FROM likes WHERE user_id = #{userId} " +
            "AND target_type = #{targetType} AND target_id = #{targetId}")
    int checkUserLiked(@Param("userId") Long userId,
                       @Param("targetType") String targetType,
                       @Param("targetId") Long targetId);

    /**
     * 取消点赞
     */
    @Delete("DELETE FROM likes WHERE user_id = #{userId} " +
            "AND target_type = #{targetType} AND target_id = #{targetId}")
    int unlike(@Param("userId") Long userId,
               @Param("targetType") String targetType,
               @Param("targetId") Long targetId);
}
