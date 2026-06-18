// ChainlessChain IDE Bridge — JetBrains plugin.
//
// Build requires the IntelliJ Platform SDK (downloaded by the Gradle plugin at
// build time). The protocol/server/lockfile/tools core under
// com.chainlesschain.ide is pure JDK and is also compiled + interop-tested
// independently (see README "Verification").
import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType

plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "com.chainlesschain"
version = "0.4.11"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.2")
        // Java PSI (PsiShortNamesCache etc.) for @-mention class/method symbols.
        // Compile-time only: plugin.xml does NOT depend on com.intellij.java, so the
        // plugin still loads on non-Java IDEs — the symbol lookup is try/catch-guarded
        // and simply yields no symbols when the Java PSI classes are absent.
        // (The terminal customizer was dropped in 0.4.7 — deprecated API; the
        // discovery lockfile covers the "cc in a terminal auto-connects" case.)
        bundledPlugin("com.intellij.java")
        pluginVerifier() // for ./gradlew verifyPlugin
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

// Windows javac defaults to the platform codepage (GBK) — non-ASCII UI
// strings (✓ ⚠ ℹ …) would be miscompiled into mojibake without this.
tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
}

intellijPlatform {
    // Plain-Java plugin: no UI forms / no @NotNull bytecode instrumentation, so
    // skip code instrumentation (avoids the InstrumentIdeaExtensions ant-task
    // dependency the 2.x plugin otherwise needs).
    instrumentCode = false

    pluginConfiguration {
        ideaVersion {
            sinceBuild = "242"
            untilBuild = provider { null } // no hard upper bound
        }
    }

    // `./gradlew verifyPlugin` runs the JetBrains Plugin Verifier against newer
    // IDE builds to catch internal / scheduled-for-removal / deprecated API usage
    // before they break on those versions.
    pluginVerification {
        ides {
            // 2025.2 is the newest build resolvable via the Gradle repos here;
            // 2026.x artifacts aren't published to the dependency repo yet, so they
            // can only be checked by the Marketplace verifier post-publish.
            ide(IntelliJPlatformType.IntellijIdeaCommunity, "2025.2")
        }
    }

    // `./gradlew publishPlugin` uploads to the JetBrains Marketplace. The token
    // comes from the CI secret JETBRAINS_PUBLISH_TOKEN (never commit it).
    publishing {
        token = providers.environmentVariable("JETBRAINS_PUBLISH_TOKEN")
    }

    // Marketplace requires signed plugins; supply the cert chain + key via env
    // when releasing (CERTIFICATE_CHAIN / PRIVATE_KEY / PRIVATE_KEY_PASSWORD).
    signing {
        certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("PRIVATE_KEY")
        password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
    }
}

tasks {
    // The interop probe main lives under src/test and is not shipped.
    test {
        enabled = false
    }
}
