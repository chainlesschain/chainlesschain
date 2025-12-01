package com.chainlesschain.service;

import android.content.Context;
import android.util.Log;

import com.chainlesschain.model.ChatMessage;
import com.google.gson.Gson;
import com.google.gson.annotations.SerializedName;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * LLM Service
 * AI大语言模型服务（Ollama集成）
 */
public class LLMService {
    private static final String TAG = "LLMService";
    private static LLMService instance;
    private String serverUrl = "http://10.0.2.2:11434"; // Android emulator访问localhost
    private String model = "qwen2:7b";
    private OkHttpClient client;
    private Gson gson;

    private LLMService() {
        client = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(60, TimeUnit.SECONDS)
                .build();
        gson = new Gson();
    }

    public static synchronized LLMService getInstance() {
        if (instance == null) {
            instance = new LLMService();
        }
        return instance;
    }

    /**
     * 设置服务器地址
     */
    public void setServerUrl(String url) {
        this.serverUrl = url;
    }

    /**
     * 设置模型
     */
    public void setModel(String model) {
        this.model = model;
    }

    /**
     * 检查连接
     */
    public boolean checkConnection() {
        try {
            Request request = new Request.Builder()
                    .url(serverUrl + "/api/tags")
                    .get()
                    .build();

            Response response = client.newCall(request).execute();
            boolean isConnected = response.isSuccessful();
            response.close();

            Log.d(TAG, "Connection check: " + isConnected);
            return isConnected;
        } catch (Exception e) {
            Log.e(TAG, "Connection check failed", e);
            return false;
        }
    }

    /**
     * 发送查询
     */
    public String query(String message, String context, List<ChatMessage> history) throws IOException {
        List<OllamaMessage> messages = new ArrayList<>();

        // 添加历史消息
        if (history != null) {
            for (ChatMessage msg : history) {
                if (!"system".equals(msg.getRole())) {
                    messages.add(new OllamaMessage(msg.getRole(), msg.getContent()));
                }
            }
        }

        // 添加当前消息
        String content = message;
        if (context != null && !context.isEmpty()) {
            content = "Context:\n" + context + "\n\nQuestion: " + message;
        }
        messages.add(new OllamaMessage("user", content));

        // 构建请求
        OllamaChatRequest chatRequest = new OllamaChatRequest();
        chatRequest.model = model;
        chatRequest.messages = messages;
        chatRequest.stream = false;

        String jsonRequest = gson.toJson(chatRequest);
        Log.d(TAG, "Sending request: " + jsonRequest);

        RequestBody body = RequestBody.create(
                jsonRequest,
                MediaType.parse("application/json")
        );

        Request request = new Request.Builder()
                .url(serverUrl + "/api/chat")
                .post(body)
                .build();

        Response response = client.newCall(request).execute();
        if (!response.isSuccessful()) {
            throw new IOException("Request failed: " + response.code());
        }

        String responseBody = response.body().string();
        Log.d(TAG, "Response: " + responseBody);

        OllamaChatResponse chatResponse = gson.fromJson(responseBody, OllamaChatResponse.class);
        response.close();

        if (chatResponse != null && chatResponse.message != null) {
            return chatResponse.message.content;
        }

        throw new IOException("Invalid response from LLM service");
    }

    /**
     * 获取可用模型列表
     */
    public List<String> getAvailableModels() {
        try {
            Request request = new Request.Builder()
                    .url(serverUrl + "/api/tags")
                    .get()
                    .build();

            Response response = client.newCall(request).execute();
            if (!response.isSuccessful()) {
                response.close();
                return new ArrayList<>();
            }

            String responseBody = response.body().string();
            OllamaModelsResponse modelsResponse = gson.fromJson(responseBody, OllamaModelsResponse.class);
            response.close();

            List<String> models = new ArrayList<>();
            if (modelsResponse != null && modelsResponse.models != null) {
                for (OllamaModel model : modelsResponse.models) {
                    models.add(model.name);
                }
            }

            return models;
        } catch (Exception e) {
            Log.e(TAG, "Failed to get models", e);
            return new ArrayList<>();
        }
    }

    // Ollama API数据类
    private static class OllamaMessage {
        String role;
        String content;

        OllamaMessage(String role, String content) {
            this.role = role;
            this.content = content;
        }
    }

    private static class OllamaChatRequest {
        String model;
        List<OllamaMessage> messages;
        boolean stream;
    }

    private static class OllamaChatResponse {
        OllamaMessage message;
        @SerializedName("done")
        boolean done;
    }

    private static class OllamaModelsResponse {
        List<OllamaModel> models;
    }

    private static class OllamaModel {
        String name;
        @SerializedName("modified_at")
        String modifiedAt;
    }
}
