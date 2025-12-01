package com.chainlesschain.ui;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.chainlesschain.ChainlessChainApp;
import com.chainlesschain.R;
import com.chainlesschain.service.SIMKeyService;
import com.chainlesschain.util.UIUtils;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Login Activity
 * 登录界面
 */
public class LoginActivity extends AppCompatActivity {

    private TextView tvStatus;
    private EditText etPin;
    private Button btnLogin;
    private ProgressBar progressBar;

    private SIMKeyService simKeyService;
    private ExecutorService executorService;
    private Handler mainHandler;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);

        initViews();
        initServices();
        checkSIMKey();
    }

    private void initViews() {
        tvStatus = findViewById(R.id.tv_status);
        etPin = findViewById(R.id.et_pin);
        btnLogin = findViewById(R.id.btn_login);
        progressBar = findViewById(R.id.progress_bar);

        btnLogin.setOnClickListener(v -> handleLogin());
    }

    private void initServices() {
        simKeyService = SIMKeyService.getInstance(this);
        executorService = Executors.newSingleThreadExecutor();
        mainHandler = new Handler(Looper.getMainLooper());
    }

    private void checkSIMKey() {
        setLoading(true);
        tvStatus.setText("正在检测 SIMKey...");

        executorService.execute(() -> {
            SIMKeyService.SIMKeyStatus status = simKeyService.detectSIMKey();

            mainHandler.post(() -> {
                setLoading(false);
                if (status.connected) {
                    tvStatus.setText("✅ SIMKey 已连接");
                    btnLogin.setEnabled(true);
                } else {
                    tvStatus.setText("❌ SIMKey 未连接");
                    btnLogin.setEnabled(false);
                }
            });
        });
    }

    private void handleLogin() {
        String pin = etPin.getText().toString().trim();

        if (TextUtils.isEmpty(pin)) {
            UIUtils.showToast(this, "请输入 PIN 码");
            return;
        }

        if (pin.length() < 4) {
            UIUtils.showToast(this, "PIN 码至少 4 位");
            return;
        }

        setLoading(true);
        btnLogin.setEnabled(false);

        executorService.execute(() -> {
            boolean verified = simKeyService.verifyPIN(pin);

            mainHandler.post(() -> {
                setLoading(false);

                if (verified) {
                    // 保存登录状态
                    ChainlessChainApp.getInstance().setLoggedIn(true);
                    ChainlessChainApp.getInstance().setDbPassword(pin);

                    UIUtils.showToast(this, "登录成功");

                    // 跳转到主界面
                    Intent intent = new Intent(this, MainActivity.class);
                    startActivity(intent);
                    finish();
                } else {
                    UIUtils.showToast(this, "PIN 码错误");
                    btnLogin.setEnabled(true);
                }
            });
        });
    }

    private void setLoading(boolean loading) {
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        btnLogin.setEnabled(!loading);
        etPin.setEnabled(!loading);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (executorService != null) {
            executorService.shutdown();
        }
    }
}
