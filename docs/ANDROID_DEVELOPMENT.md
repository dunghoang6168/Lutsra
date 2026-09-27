# Android development status

This branch is `android/development`, forked from the passed `android/spike` checkpoint `e34254e`. It is not a numbered roadmap phase. The desktop `main` worktree remains separate.

## Gate B

Passed on two physical devices: Motorola moto g stylus 5G (2024), Android 15, and Nothing A065, Android 16. The user heard MP3, FLAC, and WAV and confirmed play/pause and track switching through Bluetooth and wired headset controls on both. The native Media3 service owns the playback queue. See `docs/ANDROID_SPIKE.md` for the APK and test details.

## Stage C in progress

- A MediaStore bridge can enumerate all indexed audio after `READ_MEDIA_AUDIO` permission. The Motorola scan returned 448 tracks, 129 albums, and 83 artists. This was a technical check, not the chosen library policy.
- The user chose **only selected folders**. The Android folder bridge uses the system Storage Access Framework picker, persists each selected tree's read grant, and scans audio documents in the selected tree and its descendants. A fresh scan rebuilds the snapshot, so removed files disappear and duplicate document IDs are collapsed. Native metadata extraction tolerates missing or malformed tags.
- The Angular `LibraryGateway` adapter maps document IDs/URIs into tracks, albums, artists, folder records, and basic track details. It does not share the Windows database or path based track IDs.
- The Android `PlaylistGateway` adapter stores playlists and entries in an app private SQLite database. Duplicate tracks within a playlist have distinct entry IDs. Entries reference Android document IDs. The native Media3 queue remains independent of Angular state.
- A folder picker APK is installed on the connected Motorola and available as the ignored `release/Android-Folders-preview.apk`. Selection, rescan, removal, access revocation, and playlist persistence still need physical device verification before C is marked complete. The preview UI is a diagnostic screen, not the mobile shell.

## Next checks

1. Select a folder with music on the Motorola and confirm the displayed folder/track/album/artist counts.
2. Rescan the same folder and confirm the track count does not increase.
3. Remove or add a test file, rescan, and confirm reconciliation.
4. Revoke a selected tree grant in Android settings and confirm the app reports inaccessible content without duplicating or silently substituting an all-device scan.
5. Verify playlist creation, entries, reorder, and persistence across app restart; repeat library and playlist checks on the Nothing device.
