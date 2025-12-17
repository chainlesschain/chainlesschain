package com.chainlesschain.community.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.community.entity.PostTag;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 帖子标签关联Mapper接口
 */
@Mapper
public interface PostTagMapper extends BaseMapper<PostTag> {

    /**
     * 删除帖子的所有标签关联
     */
    @Delete("DELETE FROM post_tags WHERE post_id = #{postId}")
    int deleteByPostId(@Param("postId") Long postId);
}
