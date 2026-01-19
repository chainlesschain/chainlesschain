# Add project specific ProGuard rules here.

# Keep data classes
-keep class com.chainlesschain.android.data.** { *; }
-keep class com.chainlesschain.android.*.data.** { *; }

# Keep Retrofit interfaces
-keep interface com.chainlesschain.android.**.api.** { *; }

# Keep Room entities
-keep @androidx.room.Entity class * { *; }

# Keep Kotlin coroutines
-keep class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**

# Keep serialization
-keep @kotlinx.serialization.Serializable class * { *; }

# Keep Hilt generated classes
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }
-keep class * extends dagger.hilt.android.internal.managers.ViewComponentManager$FragmentContextWrapper { *; }

# Gson
-keepattributes Signature
-keepattributes *Annotation*
-keep class sun.misc.Unsafe { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# Retrofit
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# Keep custom exceptions
-keep public class * extends java.lang.Exception

# Keep line numbers for debugging
-keepattributes SourceFile,LineNumberTable
