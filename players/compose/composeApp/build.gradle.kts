import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.composeHotReload)
}

kotlin {
    jvm()

    sourceSets {
        commonMain.dependencies {
            implementation(libs.compose.runtime)
            implementation(libs.compose.foundation)
            implementation(libs.compose.material3)
            implementation(libs.compose.ui)
            implementation(libs.compose.components.resources)
            implementation(libs.compose.uiToolingPreview)
            implementation(libs.androidx.lifecycle.viewmodelCompose)
            implementation(libs.androidx.lifecycle.runtimeCompose)
        }
        commonTest.dependencies {
            implementation(libs.kotlin.test)
        }
        jvmMain.dependencies {
            implementation(compose.desktop.currentOs)
            implementation(libs.kotlinx.coroutinesSwing)
            implementation(project(":remote-player"))
        }
    }
}


compose.desktop {
    application {
        mainClass = "com.example.remotecomposeplayer.MainKt"

        nativeDistributions {
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            packageName = "com.example.remotecomposeplayer"
            packageVersion = "1.0.0"
        }
    }
}

tasks.register<JavaExec>("snapshot") {
    group = "application"
    description = "Render a .rc example headlessly and save it as a PNG via RemoteDocumentPlayerState.snapshotPng()."
    dependsOn("jvmMainClasses")
    mainClass.set("com.example.remotecomposeplayer.SnapshotCheckKt")
    classpath = kotlin.jvm().compilations.getByName("main").runtimeDependencyFiles +
        files(kotlin.jvm().compilations.getByName("main").output.allOutputs)
    workingDir = rootProject.projectDir
    args = (project.findProperty("snapshotArgs") as String?)?.split(" ") ?: listOf()
}
