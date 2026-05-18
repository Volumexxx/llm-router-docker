plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.plugin.compose")
  id("org.jetbrains.kotlin.plugin.serialization")
}

android {
  namespace = "com.longhu.llmrouter.chat"
  compileSdk = 36

  defaultConfig {
    applicationId = "com.longhu.llmrouter.chat"
    minSdk = 26
    targetSdk = 36
    versionCode = 1
    versionName = "0.1.0"

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  buildFeatures {
    compose = true
  }

  packaging {
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
  }
}

dependencies {
  implementation(platform("androidx.compose:compose-bom:2026.05.00"))
  implementation("androidx.activity:activity-compose:1.12.0")
  implementation("androidx.compose.foundation:foundation")
  implementation("androidx.compose.material:material-icons-extended")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-tooling-preview")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
  implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("net.zetetic:sqlcipher-android:4.15.0@aar")
  implementation("androidx.sqlite:sqlite:2.6.1")

  debugImplementation("androidx.compose.ui:ui-tooling")

  testImplementation("junit:junit:4.13.2")
  testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
  testImplementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
}
