package com.chainlesschain.marketplace.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.marketplace.entity.PluginVersion;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * Plugin Version Mapper
 * 插件版本数据访问接口
 *
 * @author ChainlessChain Team
 */
@Mapper
public interface PluginVersionMapper extends BaseMapper<PluginVersion> {

    /**
     * Get versions by plugin ID
     */
    @Select("SELECT * FROM plugin_versions WHERE plugin_id = #{pluginId} AND deleted = false ORDER BY created_at DESC")
    List<PluginVersion> getVersionsByPluginId(@Param("pluginId") Long pluginId);

    /**
     * Get latest version
     */
    @Select("SELECT * FROM plugin_versions WHERE plugin_id = #{pluginId} AND status = 'active' AND deleted = false ORDER BY created_at DESC LIMIT 1")
    PluginVersion getLatestVersion(@Param("pluginId") Long pluginId);

    /**
     * Get version by plugin ID and version string
     */
    @Select("SELECT * FROM plugin_versions WHERE plugin_id = #{pluginId} AND version = #{version} AND deleted = false LIMIT 1")
    PluginVersion getVersionByPluginIdAndVersion(@Param("pluginId") Long pluginId, @Param("version") String version);

    /**
     * Increment download count
     */
    @Update("UPDATE plugin_versions SET downloads = downloads + 1 WHERE id = #{id}")
    int incrementDownloads(@Param("id") Long id);
}
