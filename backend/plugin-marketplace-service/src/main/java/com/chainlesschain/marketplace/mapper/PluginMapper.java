package com.chainlesschain.marketplace.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.marketplace.entity.Plugin;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * Plugin Mapper
 * 插件数据访问接口
 *
 * @author ChainlessChain Team
 */
@Mapper
public interface PluginMapper extends BaseMapper<Plugin> {

    /**
     * Increment download count
     */
    @Update("UPDATE plugins SET downloads = downloads + 1 WHERE id = #{id}")
    int incrementDownloads(@Param("id") Long id);

    /**
     * Get featured plugins
     */
    @Select("SELECT * FROM featured_plugins LIMIT #{limit}")
    List<Plugin> getFeaturedPlugins(@Param("limit") Integer limit);

    /**
     * Get popular plugins
     */
    @Select("SELECT * FROM popular_plugins LIMIT #{limit}")
    List<Plugin> getPopularPlugins(@Param("limit") Integer limit);

    /**
     * Get recent plugins
     */
    @Select("SELECT * FROM recent_plugins LIMIT #{limit}")
    List<Plugin> getRecentPlugins(@Param("limit") Integer limit);

    /**
     * Search plugins by keyword
     */
    @Select("<script>" +
            "SELECT p.*, c.name as category_name FROM plugins p " +
            "LEFT JOIN categories c ON p.category = c.code " +
            "WHERE p.deleted = false AND p.status = 'approved' " +
            "<if test='keyword != null and keyword != \"\"'>" +
            "AND (p.name ILIKE CONCAT('%', #{keyword}, '%') " +
            "OR p.description ILIKE CONCAT('%', #{keyword}, '%') " +
            "OR #{keyword} = ANY(p.tags)) " +
            "</if>" +
            "<if test='category != null and category != \"\"'>" +
            "AND p.category = #{category} " +
            "</if>" +
            "<if test='verified != null'>" +
            "AND p.verified = #{verified} " +
            "</if>" +
            "ORDER BY " +
            "<choose>" +
            "<when test='sort == \"recent\"'>p.published_at DESC</when>" +
            "<when test='sort == \"rating\"'>p.rating DESC, p.rating_count DESC</when>" +
            "<when test='sort == \"downloads\"'>p.downloads DESC</when>" +
            "<otherwise>p.downloads DESC, p.rating DESC</otherwise>" +
            "</choose>" +
            "</script>")
    List<Plugin> searchPlugins(@Param("keyword") String keyword,
                               @Param("category") String category,
                               @Param("verified") Boolean verified,
                               @Param("sort") String sort);
}
