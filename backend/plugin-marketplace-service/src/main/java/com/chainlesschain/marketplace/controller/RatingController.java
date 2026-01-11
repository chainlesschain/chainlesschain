package com.chainlesschain.marketplace.controller;

import com.chainlesschain.marketplace.dto.ApiResponse;
import com.chainlesschain.marketplace.entity.PluginRating;
import com.chainlesschain.marketplace.service.RatingService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Rating Controller
 * 评分REST API控制器
 *
 * @author ChainlessChain Team
 */
@Slf4j
@RestController
@RequestMapping("/plugins/{pluginId}/ratings")
@RequiredArgsConstructor
public class RatingController {

    private final RatingService ratingService;

    /**
     * Get ratings by plugin ID
     * GET /plugins/{pluginId}/ratings
     */
    @GetMapping
    public ApiResponse<List<PluginRating>> getRatings(@PathVariable Long pluginId) {
        log.info("Get ratings for plugin: {}", pluginId);
        List<PluginRating> ratings = ratingService.getRatingsByPluginId(pluginId);
        return ApiResponse.success(ratings);
    }

    /**
     * Submit rating
     * POST /plugins/{pluginId}/ratings
     */
    @PostMapping
    public ApiResponse<PluginRating> submitRating(
            @PathVariable Long pluginId,
            @RequestParam @Min(1) @Max(5) Integer rating,
            @RequestParam(required = false) String comment,
            Authentication authentication) {
        log.info("Submit rating: plugin=, rating={}", pluginId, rating);

        String userDid = authentication.getName();
        PluginRating result = ratingService.submitRating(pluginId, userDid, rating, comment);
        return ApiResponse.success(result, "Rating submitted successfully");
    }

    /**
     * Delete rating
     * DELETE /ratings/{id}
     */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> deleteRating(
            @PathVariable Long id,
            Authentication authentication) {
        log.info("Delete rating: {}", id);

        String userDid = authentication.getName();
        ratingService.deleteRating(id, userDid);
        return ApiResponse.successMessage("Rating deleted successfully");
    }
}
