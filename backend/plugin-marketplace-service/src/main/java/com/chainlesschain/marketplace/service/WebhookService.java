package com.chainlesschain.marketplace.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * Webhook Notification Service
 * Webhook 通知服务
 *
 * @author ChainlessChain Team
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WebhookService {

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Send webhook notification
     *
     * @param webhookUrl Webhook URL
     * @param event      Event type
     * @param payload    Event payload
     */
    @Async
    public void sendWebhook(String webhookUrl, String event, Object payload) {
        try {
            WebhookPayload webhookPayload = new WebhookPayload();
            webhookPayload.setEvent(event);
            webhookPayload.setTimestamp(LocalDateTime.now().toString());
            webhookPayload.setData(payload);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("X-Webhook-Event", event);

            HttpEntity<WebhookPayload> request = new HttpEntity<>(webhookPayload, headers);

            restTemplate.postForEntity(webhookUrl, request, String.class);

            log.info("Webhook sent successfully to {} for event: {}", webhookUrl, event);

        } catch (Exception e) {
            log.error("Failed to send webhook to {}: {}", webhookUrl, e.getMessage(), e);
        }
    }

    /**
     * Send plugin published notification
     *
     * @param webhookUrl Webhook URL
     * @param pluginId   Plugin ID
     * @param pluginName Plugin name
     * @param version    Version
     */
    public void notifyPluginPublished(String webhookUrl, Long pluginId, String pluginName, String version) {
        Map<String, Object> data = new HashMap<>();
        data.put("pluginId", pluginId);
        data.put("pluginName", pluginName);
        data.put("version", version);
        data.put("action", "published");

        sendWebhook(webhookUrl, "plugin.published", data);
    }

    /**
     * Send plugin updated notification
     *
     * @param webhookUrl Webhook URL
     * @param pluginId   Plugin ID
     * @param pluginName Plugin name
     * @param version    Version
     */
    public void notifyPluginUpdated(String webhookUrl, Long pluginId, String pluginName, String version) {
        Map<String, Object> data = new HashMap<>();
        data.put("pluginId", pluginId);
        data.put("pluginName", pluginName);
        data.put("version", version);
        data.put("action", "updated");

        sendWebhook(webhookUrl, "plugin.updated", data);
    }

    /**
     * Send plugin downloaded notification
     *
     * @param webhookUrl Webhook URL
     * @param pluginId   Plugin ID
     * @param pluginName Plugin name
     * @param version    Version
     * @param userDid    User DID
     */
    public void notifyPluginDownloaded(String webhookUrl, Long pluginId, String pluginName,
                                       String version, String userDid) {
        Map<String, Object> data = new HashMap<>();
        data.put("pluginId", pluginId);
        data.put("pluginName", pluginName);
        data.put("version", version);
        data.put("userDid", userDid);
        data.put("action", "downloaded");

        sendWebhook(webhookUrl, "plugin.downloaded", data);
    }

    /**
     * Send rating submitted notification
     *
     * @param webhookUrl Webhook URL
     * @param pluginId   Plugin ID
     * @param pluginName Plugin name
     * @param rating     Rating value
     * @param userDid    User DID
     */
    public void notifyRatingSubmitted(String webhookUrl, Long pluginId, String pluginName,
                                      Integer rating, String userDid) {
        Map<String, Object> data = new HashMap<>();
        data.put("pluginId", pluginId);
        data.put("pluginName", pluginName);
        data.put("rating", rating);
        data.put("userDid", userDid);
        data.put("action", "rating_submitted");

        sendWebhook(webhookUrl, "rating.submitted", data);
    }

    /**
     * Send plugin approved notification
     *
     * @param webhookUrl Webhook URL
     * @param pluginId   Plugin ID
     * @param pluginName Plugin name
     */
    public void notifyPluginApproved(String webhookUrl, Long pluginId, String pluginName) {
        Map<String, Object> data = new HashMap<>();
        data.put("pluginId", pluginId);
        data.put("pluginName", pluginName);
        data.put("action", "approved");

        sendWebhook(webhookUrl, "plugin.approved", data);
    }

    /**
     * Send plugin rejected notification
     *
     * @param webhookUrl Webhook URL
     * @param pluginId   Plugin ID
     * @param pluginName Plugin name
     * @param reason     Rejection reason
     */
    public void notifyPluginRejected(String webhookUrl, Long pluginId, String pluginName, String reason) {
        Map<String, Object> data = new HashMap<>();
        data.put("pluginId", pluginId);
        data.put("pluginName", pluginName);
        data.put("reason", reason);
        data.put("action", "rejected");

        sendWebhook(webhookUrl, "plugin.rejected", data);
    }

    /**
     * Webhook payload structure
     */
    @Data
    public static class WebhookPayload {
        private String event;
        private String timestamp;
        private Object data;
    }
}
