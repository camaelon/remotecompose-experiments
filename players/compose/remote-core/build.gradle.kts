plugins {
    `java-library`
    kotlin("jvm")
    `maven-publish`
}

group = "org.nirensei"
version = "0.1.0"

val androidxRoot = "/Users/nico/androidx/frameworks/support/compose/remote/remote-core/src/main/java"

// Files in androidxRoot that are replaced by local overrides under src/main/java.
// Entries are paths relative to androidxRoot.
val upstreamOverrides = listOf(
    "androidx/compose/remote/core/Limits.java",
    "androidx/compose/remote/core/operations/PaintData.java",
)

val patchedUpstream = layout.buildDirectory.dir("patched-upstream").get().asFile

val patchUpstreamRemoteCore = tasks.register<Sync>("patchUpstreamRemoteCore") {
    description = "Mirror the androidx remote-core source, dropping files we override locally."
    from(androidxRoot) {
        exclude(upstreamOverrides)
    }
    into(patchedUpstream)
}

kotlin {
    sourceSets.main {
        kotlin.srcDirs(patchedUpstream, "src/main/java")
    }
}

java {
    sourceSets.main.get().java.srcDirs(patchedUpstream, "src/main/java")
}

tasks.withType<JavaCompile>().configureEach { dependsOn(patchUpstreamRemoteCore) }
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    dependsOn(patchUpstreamRemoteCore)
}

dependencies {
    api("org.jspecify:jspecify:1.0.0")
    api("androidx.annotation:annotation-jvm:1.9.1")
    api("org.jetbrains.kotlin:kotlin-stdlib")
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
            artifactId = "remote-core"
            pom {
                name.set("remote-core")
                description.set(
                    "androidx.compose.remote.core classes built from a local source " +
                        "checkout (with local Limits override)."
                )
            }
        }
    }
}
