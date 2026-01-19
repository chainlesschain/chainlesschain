# ============================================================
# ChainlessChain Android 混淆规则
# ============================================================

# ============== 基础规则 ==============
-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-verbose

# Keep line numbers for debugging
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep annotations
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# ============== Kotlin ==============
-keep class kotlin.** { *; }
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**
-keepclassmembers class **$WhenMappings {
    <fields>;
}

# Keep Kotlin coroutines
-keep class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keepclassmembers class kotlinx.coroutines.** {
    volatile <fields>;
}

# Keep serialization
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
-keep class androidx.** { *; }
-keep interface androidx.** { *; }
-dontwarn androidx.**

# Lifecycle
-keep class * implements androidx.lifecycle.LifecycleObserver {
    <init>(...);
}
-keep class * extends androidx.lifecycle.ViewModel {
    <init>(...);
}

# Compose
-keep class androidx.compose.** { *; }
-dontwarn androidx.compose.**

# Room entities
-keep @androidx.room.Entity class * { *; }
-keep class * extends androidx.room.RoomDatabase
-dontwarn androidx.room.paging.**

# ============== Dependency Injection ==============
# Keep Hilt generated classes
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
# Keep Retrofit interfaces
-keep interface com.chainlesschain.android.**.api.** { *; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}
-keep class retrofit2.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Gson
-keepattributes Signature
-keepattributes *Annotation*
-keep class sun.misc.Unsafe { *; }

# ============== Security & Crypto ==============
# SQLCipher
-keep class net.sqlcipher.** { *; }
-keep class net.sqlcipher.database.** { *; }

# Bouncy Castle
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# Google Tink
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**

# ============== Data Models ==============
# Keep data classes
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

