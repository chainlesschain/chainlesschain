package com.chainlesschain.marketplace.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.marketplace.entity.PluginRating;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * Plugin Rating Mapper
 * 插件评分数据访问接口
 *
 * @author ChainlessChain Team
 */
@Mapper
public interface PluginRatingMapper extends BaseMapper<PluginRating> {

    /**
     * Get ratings by plugin ID
     */
    @Select("SELECT r.*, u.username, u.avatar_url FROM plugin_ratings r " +
            "LEFT JOIN users u ON r.user_did = u.did " +
            "WHERE r.plugin_id = #{pluginId} AND r.deleted = false " +
            "ORDER BY r.created_at DESC")
    List<PluginRating> getRatingsByPluginId(@Param("pluginId") Long pluginId);

    /**
     * Get user rating for plugin
     */
    @Select("SELECT * FROM plugin_ratings WHERE plugin_id = #{pluginId} AND user_did = #{userDid} AND deleted = false")
    PluginRating getUserRating(@Param("pluginId") Long pluginId, @Param("userDid") String userDid);
}
