package com.chainlesschain.marketplace.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.chainlesschain.marketplace.entity.PluginRating;
import com.chainlesschain.marketplace.mapper.PluginRatingMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Rating Service
 * 评分服务
 *
 * @author ChainlessChain Team
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RatingService {

    private final PluginRatingMapper ratingMapper;

    /**
     * Get ratings by plugin ID
     */
    public List<PluginRating> getRatingsByPluginId(Long pluginId) {
        return ratingMapper.getRatingsByPluginId(pluginId);
    }

    /**
     * Get user rating for plugin
     */
    public PluginRating getUserRating(Long pluginId, String userDid) {
        return ratingMapper.getUserRating(pluginId, userDid);
    }

    /**
     * Submit rating
     */
    @Transactional
    public PluginRating submitRating(Long pluginId, String userDid, Integer rating, String comment) {
        // Check if user already rated
        PluginRating existing = getUserRating(pluginId, userDid);

        if (existing != null) {
            // Update existing rating
            existing.setRating(rating);
            existing.setComment(comment);
            ratingMapper.updateById(existing);
            log.info("Rating updated: plugin={}, user={}, rating={}", pluginId, userDid, rating);
            return existing;
        } else {
            // Create new rating
            PluginRating newRating = new PluginRating();
            newRating.setPluginId(pluginId);
            newRating.setUserDid(userDid);
            newRating.setRating(rating);
            newRating.setComment(comment);
            newRating.setHelpfulCount(0);
            ratingMapper.insert(newRating);
            log.info("Rating submitted: plugin={}, user={}, rating={}", pluginId, userDid, rating);
            return newRating;
        }
    }

    /**
     * Delete rating
     */
    @Transactional
    public void deleteRating(Long id, String userDid) {
        PluginRating rating = ratingMapper.selectById(id);
        if (rating == null) {
            throw new RuntimeException("Rating not found");
        }

        if (!rating.getUserDid().equals(userDid)) {
            throw new RuntimeException("Permission denied");
        }

        ratingMapper.deleteById(id);
        log.info("Rating deleted: id={}", id);
    }
}
