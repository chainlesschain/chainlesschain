package com.chainlesschain.marketplace.controller;

import com.chainlesschain.marketplace.dto.ApiResponse;
import com.chainlesschain.marketplace.entity.PluginReport;
import com.chainlesschain.marketplace.service.PluginReportService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Plugin Report Controller
 * 插件举报REST API控制器
 *
 * @author ChainlessChain Team
 */
@Slf4j
@RestController
@RequestMapping("/reports")
@RequiredArgsConstructor
public class PluginReportController {

    private final PluginReportService pluginReportService;

    /**
     * Submit plugin report
     * POST /reports
     */
    @PostMapping
    public ApiResponse<PluginReport> submitReport(
            @Valid @RequestBody ReportRequest request,
            Authentication authentication) {
        log.info("Submit report for plugin: {}", request.getPluginId());

        String reporterDid = authentication.getName();
        PluginReport report = pluginReportService.submitReport(
                request.getPluginId(),
                reporterDid,
                request.getReason(),
                request.getDescription()
        );

        return ApiResponse.success(report);
    }

    /**
     * Get reports for a plugin
     * GET /reports/plugin/{pluginId}
     */
    @GetMapping("/plugin/{pluginId}")
    @PreAuthorize("hasRole('ADMIN') or hasRole('MODERATOR')")
    public ApiResponse<List<PluginReport>> getReportsByPlugin(@PathVariable Long pluginId) {
        log.info("Get reports for plugin: {}", pluginId);
        List<PluginReport> reports = pluginReportService.getReportsByPlugin(pluginId);
        return ApiResponse.success(reports);
    }

    /**
     * Get pending reports (admin/moderator only)
     * GET /reports/pending
     */
    @GetMapping("/pending")
    @PreAuthorize("hasRole('ADMIN') or hasRole('MODERATOR')")
    public ApiResponse<List<PluginReport>> getPendingReports() {
        log.info("Get pending reports");
        List<PluginReport> reports = pluginReportService.getPendingReports();
        return ApiResponse.success(reports);
    }

    /**
     * Get report by ID
     * GET /reports/{id}
     */
    @GetMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN') or hasRole('MODERATOR')")
    public ApiResponse<PluginReport> getReport(@PathVariable Long id) {
        log.info("Get report: {}", id);
        PluginReport report = pluginReportService.getReportById(id);
        return ApiResponse.success(report);
    }

    /**
     * Review report (admin/moderator only)
     * POST /reports/{id}/review
     */
    @PostMapping("/{id}/review")
    @PreAuthorize("hasRole('ADMIN') or hasRole('MODERATOR')")
    public ApiResponse<Void> reviewReport(
            @PathVariable Long id,
            @Valid @RequestBody ReviewRequest request) {
        log.info("Review report: {} with action: {}", id, request.getAction());

        pluginReportService.reviewReport(id, request.getAction(), request.getResponse());
        return ApiResponse.successMessage("Report reviewed successfully");
    }

    /**
     * Delete report (admin only)
     * DELETE /reports/{id}
     */
    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<Void> deleteReport(@PathVariable Long id) {
        log.info("Delete report: {}", id);
        pluginReportService.deleteReport(id);
        return ApiResponse.successMessage("Report deleted successfully");
    }

    /**
     * Report request DTO
     */
    @Data
    public static class ReportRequest {
        @NotBlank(message = "Plugin ID is required")
        private Long pluginId;

        @NotBlank(message = "Reason is required")
        private String reason;

        private String description;
    }

    /**
     * Review request DTO
     */
    @Data
    public static class ReviewRequest {
        @NotBlank(message = "Action is required")
        private String action;  // approved, rejected

        private String response;
    }
}
