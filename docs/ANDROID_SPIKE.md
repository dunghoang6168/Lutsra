# Android technical spike

This is a separate Android development branch, **not Phase 5**. The first product target is reliable offline listening on a phone. Work on the full library, playback adapters, and phone UI starts only after this spike passes on real devices.

## Checkpoint and current result

- Branch: `android/spike`, created from desktop commit `1bc32fa`. Uncommitted desktop changes remain in the `main` worktree.
- On the desktop working tree with uncommitted changes, 184 Angular tests and 33 backend tests passed; its Angular and Electron production build passed on 2026-09-27. On this Android branch, 177 Angular tests and 33 backend tests passed, and both the Android spike web build/sync and default Angular/Electron production build passed. The Angular tests used Edge as `CHROME_BIN` because Chrome is absent.
- Capacitor 8 Android project and a dedicated Angular spike entry have been generated. `npm run build:android:spike` is the web build and Capacitor sync command.
- A debug APK was built successfully on 2026-09-27 and copied to the workspace's ignored `release/Android-Spike-debug.apk` (SHA-256 `03D6E007DCF69FFC23E17BFDBF201F74FA26FB4626F2E3B43282BD2AC997F19B`). No device is connected to `adb`, so it has not been installed or tested on a phone. This host now has Android Studio/SDK. Its bundled JDK 25 is incompatible with this project's Gradle 8.14.3; a JDK 21 copy was extracted under the user's temporary directory for the successful build. Gradle installed SDK Platform 36 and Build Tools 35 automatically.

## What this spike measures

The spike has a separate Angular entry so the desktop interface is never squeezed into the Android test. It uses the Android system file picker to select one file, then a WebView `HTMLAudioElement` and Web Media Session to probe playback and system controls. Selecting a file this way grants access to that picked file; it does **not** demonstrate broad MediaStore access or persistent library permission. `canPlayType` is a hint, not evidence that a particular file decodes or outputs at its source resolution.

For each device, record model, Android version/API, WebView version, audio route, file container/codec/bit depth/sample rate, pick result, play result, seek result, lock-screen behavior, headset/Bluetooth actions, and any error code. Test actual MP3, FLAC, and WAV files, including a FLAC variant with tags and one with missing metadata. Repeat after process/background pressure and after revoking file access if the picker/provider allows it.

| Device | Android/API | WebView | MP3 | FLAC | WAV | Locked screen | Wired headset | Bluetooth | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Device 1 | pending | pending | pending | pending | pending | pending | pending | pending | pending |
| Device 2 | pending | pending | pending | pending | pending | pending | pending | pending | pending |

### Acceptance gate for continuing to C–F

An installable test APK, results from at least two physical devices or Android versions, a codec and permission matrix, and documented limits are required. If WebView playback or system controls are unreliable, the result still informs the decision, but the native Media3 service must be proven before full Android development proceeds. Do not label the spike complete based on a successful web build.

## Architecture decisions

1. Android stores its own library and playlists. Desktop track IDs derive from file paths; Android tracks are identified by media content URIs. Windows SQLite data must not be opened or copied as the Android database, and playlists cannot be assumed to synchronize between devices.
2. The Android `MediaSessionService` owns playback and the queue. Angular is a UI client of that service. The existing `PlayerService` queue cannot be the authority after the WebView stops running. See [Android Media3 background playback](https://developer.android.com/media/media3/session/background-playback).
3. For the Android library adapter, start with [MediaStore audio](https://developer.android.com/training/data-storage/shared/media). Add Storage Access Framework folder selection only if a demonstrated library access gap requires it. Keep stable Android IDs, handle revoked permission/deleted media, and tolerate absent metadata.

## Build and device run

Install Android Studio and SDK Platform 36, select JDK 21 for Gradle, then connect a phone with USB debugging. From this branch's worktree:

```powershell
npm ci
npm run build:android:spike
cd android
.\gradlew.bat assembleDebug
```

Set `JAVA_HOME` to a JDK 21 directory and `ANDROID_HOME` to the Android SDK directory before the Gradle command if they are not configured globally. The debug APK is at `android/app/build/outputs/apk/debug/app-debug.apk`. After `adb devices` shows the phone as `device`, install with `adb install -r <apk path>` and open **Audio Lutstra Spike**. Use the on-screen log to record headset and lock-screen actions. This test project contains no MediaStore permission yet; the permission findings at this stage concern the system picker. A follow-up native MediaStore permission probe is needed before the C adapter.
