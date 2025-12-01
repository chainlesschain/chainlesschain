package com.chainlesschain;

import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;

/**
 * Application Class
 * 应用全局类
 */
public class ChainlessChainApp extends Application {
    private static final String PREFS_NAME = "chainlesschain_prefs";
    private static final String KEY_DEVICE_ID = "device_id";
    private static final String KEY_LOGGED_IN = "is_logged_in";
    private static final String KEY_DB_PASSWORD = "db_password";

    private static ChainlessChainApp instance;
    private SharedPreferences prefs;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        // 生成设备ID（如果不存在）
        if (getDeviceId() == null) {
            String deviceId = "device_" + System.currentTimeMillis() + "_" +
                            Integer.toHexString((int) (Math.random() * 100000));
            setDeviceId(deviceId);
        }
    }

    public static ChainlessChainApp getInstance() {
        return instance;
    }

    // Device ID
    public String getDeviceId() {
        return prefs.getString(KEY_DEVICE_ID, null);
    }

    public void setDeviceId(String deviceId) {
        prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply();
    }

    // Login State
    public boolean isLoggedIn() {
        return prefs.getBoolean(KEY_LOGGED_IN, false);
    }

    public void setLoggedIn(boolean loggedIn) {
        prefs.edit().putBoolean(KEY_LOGGED_IN, loggedIn).apply();
    }

    // Database Password
    public String getDbPassword() {
        return prefs.getString(KEY_DB_PASSWORD, "default_password");
    }

    public void setDbPassword(String password) {
        prefs.edit().putString(KEY_DB_PASSWORD, password).apply();
    }

    // Logout
    public void logout() {
        prefs.edit()
            .putBoolean(KEY_LOGGED_IN, false)
            .remove(KEY_DB_PASSWORD)
            .apply();
    }
}
