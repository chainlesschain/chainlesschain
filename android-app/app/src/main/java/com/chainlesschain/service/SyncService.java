package com.chainlesschain.service;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.chainlesschain.model.KnowledgeItem;
import com.google.gson.Gson;
import com.google.gson.annotations.SerializedName;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Sync Service
 * 数据同步服务
 */
public class SyncService {
    private static final String TAG = "SyncService";
    private static final String PREFS_NAME = "sync_config";
    private static final String KEY_ENABLED = "sync_enabled";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_AUTO_SYNC = "auto_sync";
    private static final String KEY_LAST_SYNC = "last_sync";

    private static SyncService instance;
    private Context context;
    private OkHttpClient client;
    private Gson gson;
    private SharedPreferences prefs;

    private SyncService(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.client = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(60, TimeUnit.SECONDS)
                .build();
        this.gson = new Gson();
    }

    public static synchronized SyncService getInstance(Context context) {
        if (instance == null) {
            instance = new SyncService(context);
        }
        return instance;
    }

    /**
     * 同步数据
     */
    public SyncResult sync(List<KnowledgeItem> items) {
        SyncResult result = new SyncResult();

        if (!isSyncEnabled()) {
            result.errors.add("Sync not enabled");
            return result;
        }

        String serverUrl = getServerUrl();
        if (serverUrl == null || serverUrl.isEmpty()) {
            result.errors.add("Server URL not configured");
            return result;
        }

        try {
            Log.d(TAG, "Starting sync...");

            // 获取待同步的项目
            List<KnowledgeItem> pendingItems = new ArrayList<>();
            for (KnowledgeItem item : items) {
                if ("pending".equals(item.getSyncStatus()) ||
                    "local".equals(item.getSyncStatus())) {
                    pendingItems.add(item);
                }
            }

            if (pendingItems.isEmpty()) {
                Log.d(TAG, "No items to sync");
                result.success = true;
                return result;
            }

            // 上传数据
            UploadResult uploadResult = uploadItems(serverUrl, pendingItems);
            result.synced = uploadResult.synced;
            result.conflicts = uploadResult.conflicts;
            result.errors.addAll(uploadResult.errors);

            // 下载数据
            DownloadResult downloadResult = downloadItems(serverUrl);
            if (downloadResult.success) {
                Log.d(TAG, "Downloaded " + downloadResult.items.size() + " items");
            }

            // 更新最后同步时间
            setLastSyncTime(new Date());

            result.success = result.errors.isEmpty();
            return result;
        } catch (Exception e) {
            Log.e(TAG, "Sync failed", e);
            result.errors.add(e.getMessage());
            return result;
        }
    }

    /**
     * 上传数据
     */
    private UploadResult uploadItems(String serverUrl, List<KnowledgeItem> items) {
        UploadResult result = new UploadResult();

        try {
            UploadRequest uploadRequest = new UploadRequest();
            uploadRequest.items = items;

            String jsonRequest = gson.toJson(uploadRequest);
            RequestBody body = RequestBody.create(
                    jsonRequest,
                    MediaType.parse("application/json")
            );

            Request request = new Request.Builder()
                    .url(serverUrl + "/api/sync/upload")
                    .post(body)
                    .build();

            Response response = client.newCall(request).execute();
            if (!response.isSuccessful()) {
                result.errors.add("Upload failed: " + response.code());
                response.close();
                return result;
            }

            String responseBody = response.body().string();
            UploadResponse uploadResponse = gson.fromJson(responseBody, UploadResponse.class);
            response.close();

            if (uploadResponse != null && uploadResponse.success) {
                result.synced = uploadResponse.synced;
                result.conflicts = uploadResponse.conflicts;
            }

            return result;
        } catch (Exception e) {
            Log.e(TAG, "Upload failed", e);
            result.errors.add("Upload error: " + e.getMessage());
            return result;
        }
    }

    /**
     * 下载数据
     */
    private DownloadResult downloadItems(String serverUrl) {
        DownloadResult result = new DownloadResult();

        try {
            Date lastSync = getLastSyncTime();
            String url = serverUrl + "/api/sync/download";
            if (lastSync != null) {
                url += "?since=" + lastSync.getTime();
            }

            Request request = new Request.Builder()
                    .url(url)
                    .get()
                    .build();

            Response response = client.newCall(request).execute();
            if (!response.isSuccessful()) {
                response.close();
                return result;
            }

            String responseBody = response.body().string();
            DownloadResponse downloadResponse = gson.fromJson(responseBody, DownloadResponse.class);
            response.close();

            if (downloadResponse != null && downloadResponse.success) {
                result.success = true;
                result.items = downloadResponse.items != null ? downloadResponse.items : new ArrayList<>();
            }

            return result;
        } catch (Exception e) {
            Log.e(TAG, "Download failed", e);
            return result;
        }
    }

    /**
     * 测试连接
     */
    public boolean testConnection(String serverUrl) {
        try {
            Request request = new Request.Builder()
                    .url(serverUrl + "/api/ping")
                    .get()
                    .build();

            Response response = client.newCall(request).execute();
            boolean success = response.isSuccessful();
            response.close();

            return success;
        } catch (Exception e) {
            Log.e(TAG, "Connection test failed", e);
            return false;
        }
    }

    // Configuration methods
    public void setSyncEnabled(boolean enabled) {
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    public boolean isSyncEnabled() {
        return prefs.getBoolean(KEY_ENABLED, false);
    }

    public void setServerUrl(String url) {
        prefs.edit().putString(KEY_SERVER_URL, url).apply();
    }

    public String getServerUrl() {
        return prefs.getString(KEY_SERVER_URL, null);
    }

    public void setAutoSync(boolean enabled) {
        prefs.edit().putBoolean(KEY_AUTO_SYNC, enabled).apply();
    }

    public boolean isAutoSyncEnabled() {
        return prefs.getBoolean(KEY_AUTO_SYNC, false);
    }

    public void setLastSyncTime(Date date) {
        prefs.edit().putLong(KEY_LAST_SYNC, date.getTime()).apply();
    }

    public Date getLastSyncTime() {
        long time = prefs.getLong(KEY_LAST_SYNC, 0);
        return time > 0 ? new Date(time) : null;
    }

    // Data classes
    public static class SyncResult {
        public boolean success = false;
        public int synced = 0;
        public int conflicts = 0;
        public List<String> errors = new ArrayList<>();
    }

    private static class UploadResult {
        int synced = 0;
        int conflicts = 0;
        List<String> errors = new ArrayList<>();
    }

    private static class DownloadResult {
        boolean success = false;
        List<KnowledgeItem> items = new ArrayList<>();
    }

    private static class UploadRequest {
        List<KnowledgeItem> items;
    }

    private static class UploadResponse {
        boolean success;
        int synced;
        int conflicts;
    }

    private static class DownloadResponse {
        boolean success;
        List<KnowledgeItem> items;
    }
}
