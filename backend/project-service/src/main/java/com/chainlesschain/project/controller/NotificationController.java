package com.chainlesschain.project.controller;

import com.chainlesschain.project.websocket.NotificationMessage;
import com.chainlesschain.project.websocket.NotificationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.Map;

/**
 * WebSocket通知控制器
 * 处理WebSocket消息和通知
 */
@Controller
@Tag(name = "WebSocket通知", description = "实时通知相关接口")
public class NotificationController {

    @Autowired
    private NotificationService notificationService;

    /**
     * 处理客户端发送的消息
     */
    @MessageMapping("/send")
    @SendTo("/topic/messages")
    public NotificationMessage sendMessage(@Payload NotificationMessage message, Principal principal) {
        if (principal != null) {
            message.setSender(principal.getName());
        }
        return message;
    }

    /**
     * 处理私聊消息
     */
    @MessageMapping("/private")
    public void sendPrivateMessage(@Payload Map<String, Object> payload, Principal principal) {
        String recipient = (String) payload.get("recipient");
        String content = (String) payload.get("content");

        if (principal != null && recipient != null) {
            notificationService.notifyNewMessage(recipient, principal.getName(), content);
        }
    }

    /**
     * 测试通知端点（REST API）
     */
    @PostMapping("/api/notifications/test")
    @Operation(summary = "测试通知", description = "发送测试通知到指定用户")
    public ResponseEntity<?> testNotification(@RequestBody Map<String, String> request) {
        String username = request.get("username");
        String message = request.getOrDefault("message", "这是一条测试通知");

        notificationService.notifySystem(username, "测试通知", message);

        return ResponseEntity.ok(Map.of(
            "success", true,
            "message", "通知已发送到用户: " + username
        ));
    }

    /**
     * 广播通知端点（REST API）
     */
    @PostMapping("/api/notifications/broadcast")
    @Operation(summary = "广播通知", description = "向所有在线用户广播通知")
    public ResponseEntity<?> broadcastNotification(@RequestBody Map<String, String> request) {
        String title = request.getOrDefault("title", "系统通知");
        String content = request.getOrDefault("content", "这是一条广播通知");

        NotificationMessage notification = new NotificationMessage(
            NotificationMessage.NotificationType.SYSTEM,
            title,
            content
        );

        notificationService.broadcast(notification);

        return ResponseEntity.ok(Map.of(
            "success", true,
            "message", "通知已广播"
        ));
    }

    /**
     * WebSocket连接事件处理
     */
    @MessageMapping("/connect")
    public void handleConnect(SimpMessageHeaderAccessor headerAccessor, Principal principal) {
        if (principal != null) {
            String username = principal.getName();
            // 可以在这里记录用户上线状态
            notificationService.notifySystem(username, "连接成功", "欢迎回来！");
        }
    }
}
