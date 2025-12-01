package com.chainlesschain.ui;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.appcompat.app.AppCompatActivity;

import com.chainlesschain.ChainlessChainApp;
import com.chainlesschain.R;

/**
 * Splash Activity
 * 启动界面
 */
public class SplashActivity extends AppCompatActivity {

    private static final long SPLASH_DELAY = 1500; // 1.5秒

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_splash);

        // 延迟跳转
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            Intent intent;

            if (ChainlessChainApp.getInstance().isLoggedIn()) {
                // 已登录，跳转到主界面
                intent = new Intent(SplashActivity.this, MainActivity.class);
            } else {
                // 未登录，跳转到登录界面
                intent = new Intent(SplashActivity.this, LoginActivity.class);
            }

            startActivity(intent);
            finish();
        }, SPLASH_DELAY);
    }
}
