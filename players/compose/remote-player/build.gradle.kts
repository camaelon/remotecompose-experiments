plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    `maven-publish`
}

group = "org.nirensei"
version = "0.1.0"

val bundledPlayerCoreJar = file("libs/remote-player-core-1.0.0-alpha08.jar")

kotlin {
    jvm()

    sourceSets {
        commonMain.dependencies {
            implementation(libs.compose.runtime)
            implementation(libs.compose.foundation)
            implementation(libs.compose.ui)
        }
        jvmMain.dependencies {
            implementation(compose.desktop.currentOs)
            api(project(":remote-core"))
            // Local file dep keeps in-repo consumers (e.g. :composeApp) working via
            // the project dependency. External Maven consumers get the classes
            // shaded into jvmJar below.
            implementation(files(bundledPlayerCoreJar))
        }
    }
}

// Shade the vendored upstream jar AND the sibling :remote-core jar into our
// jvmJar so the published artifact is self-contained. External consumers that
// only pull remote-player-jvm (e.g. via a local file drop, without mavenLocal
// in their repositories) still find every class they need at runtime.
// Using a plain File avoids capturing a cross-project task reference inside
// the task configuration action, which is incompatible with the configuration
// cache.
val remoteCoreJarFile = rootProject.file(
    "remote-core/build/libs/remote-core-${project.version}.jar"
)
tasks.named<Jar>("jvmJar") {
    dependsOn(":remote-core:jar")
    from(zipTree(bundledPlayerCoreJar)) {
        exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "META-INF/MANIFEST.MF")
    }
    from(zipTree(remoteCoreJarFile)) {
        exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "META-INF/MANIFEST.MF")
    }
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
}
