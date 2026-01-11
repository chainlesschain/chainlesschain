package com.chainlesschain.marketplace.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.chainlesschain.marketplace.entity.PluginReport;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * Plugin Report Mapper
 */
@Mapper
public interface PluginReportMapper extends BaseMapper<PluginReport> {

    /**
     * Find reports by plugin ID
     */
    @Select("SELECT * FROM plugin_reports WHERE plugin_id = #{pluginId} AND deleted = false ORDER BY created_at DESC")
    List<PluginReport> findByPluginId(Long pluginId);

    /**
     * Find reports by status
     */
    @Select("SELECT * FROM plugin_reports WHERE status = #{status} AND deleted = false ORDER BY created_at DESC")
    List<PluginReport> findByStatus(String status);

    /**
     * Find reports by reporter DID
     */
    @Select("SELECT * FROM plugin_reports WHERE reporter_did = #{reporterDid} AND deleted = false ORDER BY created_at DESC")
    List<PluginReport> findByReporterDid(String reporterDid);

    /**
     * Get report by plugin ID and reporter DID
     */
    @Select("SELECT * FROM plugin_reports WHERE plugin_id = #{pluginId} AND reporter_did = #{reporterDid} AND deleted = false LIMIT 1")
    PluginReport getReportByPluginAndReporter(Long pluginId, String reporterDid);

    /**
     * Get reports by plugin ID
     */
    @Select("SELECT * FROM plugin_reports WHERE plugin_id = #{pluginId} AND deleted = false ORDER BY created_at DESC")
    List<PluginReport> getReportsByPluginId(Long pluginId);

    /**
     * Get pending reports
     */
    @Select("SELECT * FROM plugin_reports WHERE status = 'pending' AND deleted = false ORDER BY created_at DESC")
    List<PluginReport> getPendingReports();

    /**
     * Get report count by plugin ID
     */
    @Select("SELECT COUNT(*) FROM plugin_reports WHERE plugin_id = #{pluginId} AND deleted = false")
    Integer getReportCountByPluginId(Long pluginId);
}
