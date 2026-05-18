# v1.2 #20 P0.2 Wear OS — release proguard rules.
# Phase 0 scaffold: keep Compose runtime + Wearable Data Layer reflection.

# Wearable Data Layer 内部用反射查 listener 实现
-keep class com.google.android.gms.wearable.** { *; }

# Compose runtime metadata
-keep class androidx.compose.runtime.** { *; }
-keep class androidx.wear.compose.** { *; }

# Application / ComponentActivity (so manifest android:name 不被 strip)
-keep class com.chainlesschain.android.wear.WearApplication { *; }
-keep class com.chainlesschain.android.wear.WearMainActivity { *; }
