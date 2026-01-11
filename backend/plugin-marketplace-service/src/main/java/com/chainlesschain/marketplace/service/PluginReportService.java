package com.chainlesschain.marketplace.service;

import com.chainlesschain.marketplace.entity.Plugin;
import com.chainlesschain.marketplace.entity.PluginReport;
import com.chainlesschain.marketplace.exception.BusinessException;
import com.chainlesschain.marketplace.exception.ResourceNotFoundException;
import com.chainlesschain.marketplace.mapper.PluginMapper;
import com.chainlesschain.marketplace.mapper.PluginReportMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Plugin Report Service
 * 插件举报服务
 *
 * @author ChainlessChain Team
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PluginReportService {

    private final PluginReportMapper pluginReportMapper;
    private final PluginMapper pluginMapper;

    /**
     * Submit plugin report
     *
     * @param pluginId    Plugin ID
     * @param reporterDid Reporter DID
     * @param reason      Report reason
     * @param description Detailed description
     * @return Created report
     */
    @Transactional
    public PluginReport submitReport(Long pluginId, String reporterDid,
                                     String reason, String description) {
        // Validate plugin exists
        Plugin plugin = pluginMapper.selectById(pluginId);
        if (plugin == null) {
            throw new ResourceNotFoundException("Plugin not found: " + pluginId);
        }

        // Check if user already reported this plugin
        PluginReport existingReport = pluginReportMapper.getReportByPluginAndReporter(pluginId, reporterDid);
        if (existingReport != null && "pending".equals(existingReport.getStatus())) {
            throw new BusinessException("You have already reported this plugin");
        }

        // Create report
        PluginReport report = new PluginReport();
        report.setPluginId(pluginId);
        report.setReporterDid(reporterDid);
        report.setReason(reason);
        report.setDescription(description);
        report.setStatus("pending");
        report.setCreatedAt(LocalDateTime.now());

        pluginReportMapper.insert(report);

        log.info("Report submitted for plugin {} by user {}", pluginId, reporterDid);
        return report;
    }

    /**
     * Get all reports for a plugin
     *
     * @param pluginId Plugin ID
     * @return List of reports
     */
    public List<PluginReport> getReportsByPlugin(Long pluginId) {
        return pluginReportMapper.getReportsByPluginId(pluginId);
    }

    /**
     * Get pending reports
     *
     * @return List of pending reports
     */
    public List<PluginReport> getPendingReports() {
        return pluginReportMapper.getPendingReports();
    }

    /**
     * Get report by ID
     *
     * @param reportId Report ID
     * @return Report
     */
    public PluginReport getReportById(Long reportId) {
        PluginReport report = pluginReportMapper.selectById(reportId);
        if (report == null) {
            throw new ResourceNotFoundException("Report not found: " + reportId);
        }
        return report;
    }

    /**
     * Review report (admin only)
     *
     * @param reportId Report ID
     * @param action   Action (approve/reject)
     * @param response Admin response
     */
    @Transactional
    public void reviewReport(Long reportId, String action, String response) {
        PluginReport report = getReportById(reportId);

        if (!"pending".equals(report.getStatus())) {
            throw new BusinessException("Report has already been reviewed");
        }

        // Update report status
        report.setStatus(action);
        report.setAdminResponse(response);
        report.setReviewedAt(LocalDateTime.now());
        pluginReportMapper.updateById(report);

        // If approved, take action on plugin
        if ("approved".equals(action)) {
            Plugin plugin = pluginMapper.selectById(report.getPluginId());
            if (plugin != null) {
                // Suspend plugin based on report severity
                if (isSevereViolation(report.getReason())) {
                    plugin.setStatus("suspended");
                    pluginMapper.updateById(plugin);
                    log.warn("Plugin {} suspended due to report {}", plugin.getId(), reportId);
                }
            }
        }

        log.info("Report {} reviewed with action: {}", reportId, action);
    }

    /**
     * Delete report
     *
     * @param reportId Report ID
     */
    @Transactional
    public void deleteReport(Long reportId) {
        PluginReport report = getReportById(reportId);
        pluginReportMapper.deleteById(reportId);
        log.info("Report {} deleted", reportId);
    }

    /**
     * Get report statistics
     *
     * @param pluginId Plugin ID
     * @return Report count
     */
    public int getReportCount(Long pluginId) {
        return pluginReportMapper.getReportCountByPluginId(pluginId);
    }

    /**
     * Check if reason indicates severe violation
     *
     * @param reason Report reason
     * @return True if severe
     */
    private boolean isSevereViolation(String reason) {
        return reason != null && (
                reason.contains("malware") ||
                        reason.contains("security") ||
                        reason.contains("illegal") ||
                        reason.contains("copyright")
        );
    }
}
