# Android technical spike

This is a separate Android development branch, **not Phase 5**. The first product target is reliable offline listening on a phone. Work on the full library, playback adapters, and phone UI starts only after this spike passes on real devices.

## Checkpoint and current result

- Branch: `android/spike`, created from desktop commit `1bc32fa`. Uncommitted desktop changes remain in the `main` worktree.
- On the desktop working tree with uncommitted changes, 184 Angular tests and 33 backend tests passed; its Angular and Electron production build passed on 2026-09-27. On this Android branch, 177 Angular tests and 33 backend tests passed, and both the Android spike web build/sync and default Angular/Electron production build passed. The Angular tests used Edge as `CHROME_BIN` because Chrome is absent.
- Capacitor 8 Android project and a dedicated Angular spike entry have been generated. `npm run build:android:spike` is the web build and Capacitor sync command.
- The current debug APK is in the workspace's ignored `release/Android-Spike-debug.apk` (SHA-256 `CAC3B73E29372AA650B21ED7F6C04D9756F2FCAA116003E3DA00DCEFDCF9004B`). It installed and launched on a Motorola moto g stylus 5G (2024), Android 15/API 35, WebView 153.0.8010.36. The first build showed a blank screen because the Angular index retained the desktop root selector; a dedicated spike index fixed it. The WebView baseline played a selected FLAC file with advancing time, but the user reported that lock-screen/headset controls did not work. A separate Media3 1.11.1 `MediaSessionService` and Capacitor bridge now own a native queue; the service generated two 30-second WAV test tones. On the locked device, ADB media key events changed PLAYING to PAUSED, resumed PLAYING, and moved between the two queue items. Android registered a foreground media notification with transport actions. The user confirmed working Bluetooth headset media buttons and wired-headset play/pause with the Media3 build. Wired next/previous could not be tested because that headset has no track-skip buttons. Audible output and real MP3/FLAC through the native picker still need explicit confirmation. This host's bundled JDK 25 is incompatible with this project's Gradle 8.14.3; a JDK 21 copy was extracted under the user's temporary directory for the successful build. Gradle installed SDK Platform 36 and Build Tools 35 automatically.
- The same APK installed and launched on a second device, Nothing A065 with Android 16/API 36 and WebView 153.0.8010.36. Its native test queue reached PLAYING, registered a foreground media notification, and switched from the first to second test item by an ADB media-next command while the screen was locked. A separate ADB media-pause command reached PAUSED. Audible output, physical headset controls, and real MP3/FLAC/WAV via the native document picker remain to be checked by the user on this device.

## What this spike measures

The spike has a separate Angular entry so the desktop interface is never squeezed into the Android test. The WebView baseline uses the system file picker, `HTMLAudioElement`, and Web Media Session. The native Media3 section uses Android's document picker to select one or more audio URIs and attempts to persist read grants, then puts the items in a service-owned queue. It can also generate two app-owned WAV test tones without reading personal files. Neither picker demonstrates broad MediaStore access or a complete library permission model. `canPlayType` is a hint, not evidence that a particular file decodes or outputs at its source resolution.

For each device, record model, Android version/API, WebView version, audio route, file container/codec/bit depth/sample rate, pick result, play result, seek result, lock-screen behavior, headset/Bluetooth actions, and any error code. Test actual MP3, FLAC, and WAV files, including a FLAC variant with tags and one with missing metadata. Repeat after process/background pressure and after revoking file access if the picker/provider allows it.

| Device | Android/API | WebView | MP3 | FLAC | WAV | Locked screen | Wired headset | Bluetooth | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Motorola moto g stylus 5G (2024) | 15 / API 35 | 153.0.8010.36 | pending | WebView timer advances; native playback pending | Native test tones enter PLAYING; audio unconfirmed | Media3 responds to ADB keys while locked; physical controls confirmed | play/pause confirmed; headset has no skip buttons | media buttons confirmed by user | partial |
| Nothing A065 | 16 / API 36 | 153.0.8010.36 | pending | pending | Native test tones reach PLAYING; audio unconfirmed | ADB media next/pause work while locked; physical controls pending | pending | pending | partial |

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

Set `JAVA_HOME` to a JDK 21 directory and `ANDROID_HOME` to the Android SDK directory before the Gradle command if they are not configured globally. The debug APK is at `android/app/build/outputs/apk/debug/app-debug.apk`. After `adb devices` shows the phone as `device`, install with `adb install -r <apk path>` and open **Audio Lutstra Spike**. Use **Phát 2 âm mẫu** in the Media3 section to test lock-screen notification and headset/Bluetooth buttons. Then use **Chọn nhạc cho Media3** to test real MP3, FLAC, and WAV via the document picker. This test project contains no MediaStore permission yet; a native MediaStore permission probe is still needed before the C adapter.
