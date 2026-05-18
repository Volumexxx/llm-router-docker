pluginManagement {
  repositories {
    google()
    maven {
      url = uri("https://dl.google.com/dl/android/maven2/")
      metadataSources {
        google()
        mavenPom()
        artifact()
      }
    }
    mavenCentral()
    gradlePluginPortal()
  }
  resolutionStrategy {
    eachPlugin {
      if (requested.id.id.startsWith("com.android.")) {
        useModule("com.android.tools.build:gradle:${requested.version}")
      }
    }
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    maven {
      url = uri("https://dl.google.com/dl/android/maven2/")
      metadataSources {
        google()
        mavenPom()
        artifact()
      }
    }
    mavenCentral()
  }
}

rootProject.name = "LLMRouterAndroid"
include(":app")
