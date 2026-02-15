# ============================================================
# ChainlessChain Android R8/ProGuard Rules
# ============================================================

# ============== Basic Rules ==============
-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-verbose

# Keep line numbers for debugging (Crashlytics stack traces)
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep annotations
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# ============== Kotlin ==============
# Only keep Metadata for reflection; R8 handles Kotlin stdlib properly
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**
-keepclassmembers class **$WhenMappings {
    <fields>;
}

# Kotlin coroutines - only keep service-loader and reflection classes
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keepclassmembers class kotlinx.coroutines.** {
    volatile <fields>;
}
-dontwarn kotlinx.coroutines.**

# Kotlin serialization
-keep @kotlinx.serialization.Serializable class * { *; }
-keepattributes InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keep,includedescriptorclasses class com.chainlesschain.android.**$$serializer { *; }
-keepclassmembers class com.chainlesschain.android.** {
    *** Companion;
}
-keepclasseswithmembers class com.chainlesschain.android.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# ============== AndroidX & Jetpack ==============
# AndroidX libraries ship their own consumer ProGuard rules via AAR.
# Only add rules here for reflection-based usage not covered by library rules.
-dontwarn androidx.**

# Lifecycle
-keep class * implements androidx.lifecycle.LifecycleObserver {
    <init>(...);
}
-keep class * extends androidx.lifecycle.ViewModel {
    <init>(...);
}

# Room entities
-keep @androidx.room.Entity class * { *; }
-keep class * extends androidx.room.RoomDatabase
-dontwarn androidx.room.paging.**

# ============== Dependency Injection ==============
# Hilt generated classes
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }
-keep class * extends dagger.hilt.android.internal.managers.ViewComponentManager$FragmentContextWrapper { *; }
-keepclassmembers,allowobfuscation class * {
    @javax.inject.* *;
    @dagger.* *;
    <init>();
}
-keep @dagger.hilt.InstallIn class * { *; }
-keep @dagger.hilt.android.lifecycle.HiltViewModel class * { *; }
-keep class **_HiltModules { *; }
-keep class **_Factory { *; }
-keep class **_MembersInjector { *; }

# ============== Network ==============
# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**

# ============== Security & Crypto ==============
# SQLCipher (accessed via reflection)
-keep class net.sqlcipher.** { *; }
-keep class net.sqlcipher.database.** { *; }

# Bouncy Castle (crypto provider loaded via reflection)
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# Google Tink
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**

# ============== Data Models ==============
# Keep data classes used for serialization/deserialization
-keep class com.chainlesschain.android.data.** { *; }
-keep class com.chainlesschain.android.*.data.** { *; }
-keep class com.chainlesschain.android.**.entity.** { *; }
-keep class com.chainlesschain.android.**.model.** { *; }
-keep class com.chainlesschain.android.**.dto.** { *; }

# ============== General Android ==============
# Native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Enum
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Parcelable
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}

# Serializable
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# Keep custom exceptions
-keep public class * extends java.lang.Exception

# ============== Performance Optimization ==============
# Remove logging in release builds
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
}

# Timber
-assumenosideeffects class timber.log.Timber* {
    public static *** v(...);
    public static *** d(...);
    public static *** i(...);
}

# ============== R8 Optimization ==============
-allowaccessmodification
-repackageclasses

# ============== Moderation System ==============
# Keep moderation models for JSON serialization
-keep class com.chainlesschain.android.feature.p2p.moderation.** { *; }
-keep class com.chainlesschain.android.core.database.entity.ModerationQueueEntity { *; }
-keep class com.chainlesschain.android.core.database.entity.ContentType { *; }
-keep class com.chainlesschain.android.core.database.entity.ModerationStatus { *; }

# ============== WebRTC ==============
# WebRTC uses JNI extensively
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# ============== Markwon (Markdown) ==============
# Markwon uses reflection for plugin loading
-keep class io.noties.markwon.** { *; }
-dontwarn io.noties.markwon.**

# ============== ZXing (QR Codes) ==============
-dontwarn com.google.zxing.**

# ============== ML Kit ==============
-dontwarn com.google.mlkit.**
