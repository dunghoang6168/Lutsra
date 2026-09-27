package com.audiolutstra.spike;

import android.Manifest;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AndroidLibrary", permissions = {
    @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
    @Permission(alias = "legacyAudio", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
})
public final class AndroidLibraryPlugin extends Plugin {
    private final ExecutorService scanExecutor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void scan(PluginCall call) {
        String permission = Build.VERSION.SDK_INT >= 33
            ? Manifest.permission.READ_MEDIA_AUDIO : Manifest.permission.READ_EXTERNAL_STORAGE;
        if (ContextCompat.checkSelfPermission(getContext(), permission) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias(Build.VERSION.SDK_INT >= 33 ? "audio" : "legacyAudio", call, "permissionResult");
            return;
        }
        runScan(call);
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        String permission = Build.VERSION.SDK_INT >= 33
            ? Manifest.permission.READ_MEDIA_AUDIO : Manifest.permission.READ_EXTERNAL_STORAGE;
        if (ContextCompat.checkSelfPermission(getContext(), permission) != PackageManager.PERMISSION_GRANTED) {
            call.reject("AUDIO_PERMISSION_DENIED", "AUDIO_PERMISSION_DENIED");
            return;
        }
        runScan(call);
    }

    private void runScan(PluginCall call) {
        scanExecutor.execute(() -> {
            JSONArray tracks = new JSONArray();
            boolean scoped = Build.VERSION.SDK_INT >= 29;
            String[] columns = scoped ? new String[] {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.VOLUME_NAME,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.DATE_MODIFIED,
                MediaStore.Audio.Media.TRACK,
                MediaStore.Audio.Media.YEAR,
                MediaStore.Audio.Media.RELATIVE_PATH
            } : new String[] {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.DATE_MODIFIED,
                MediaStore.Audio.Media.TRACK,
                MediaStore.Audio.Media.YEAR
            };
            try (Cursor cursor = getContext().getContentResolver().query(
                scoped ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                    : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                columns, null, null, MediaStore.Audio.Media._ID + " ASC")) {
                if (cursor == null) throw new IllegalStateException("MediaStore returned no cursor");
                while (cursor.moveToNext()) {
                    long id = cursor.getLong(0);
                    int offset = scoped ? 1 : 0;
                    String volume = scoped ? cursor.getString(1) : null;
                    Uri baseUri = scoped
                        ? MediaStore.Audio.Media.getContentUri(volume == null || volume.isEmpty()
                            ? MediaStore.VOLUME_EXTERNAL_PRIMARY : volume)
                        : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
                    Uri uri = ContentUris.withAppendedId(baseUri, id);
                    JSObject track = new JSObject();
                    track.put("id", uri.toString());
                    track.put("uri", uri.toString());
                    track.put("fileName", cursor.getString(1 + offset));
                    track.put("title", cursor.getString(2 + offset));
                    track.put("artist", cursor.getString(3 + offset));
                    track.put("album", cursor.getString(4 + offset));
                    track.put("durationMs", nullableLong(cursor, 5 + offset));
                    track.put("mimeType", cursor.getString(6 + offset));
                    track.put("fileSize", nullableLong(cursor, 7 + offset));
                    Long modifiedSeconds = nullableLong(cursor, 8 + offset);
                    track.put("lastModified", modifiedSeconds == null ? null : modifiedSeconds * 1000);
                    track.put("trackNumber", nullableInt(cursor, 9 + offset));
                    track.put("year", nullableInt(cursor, 10 + offset));
                    track.put("relativePath", scoped ? cursor.getString(12) : null);
                    tracks.put(track);
                }
                JSObject result = new JSObject();
                result.put("tracks", tracks);
                call.resolve(result);
            } catch (SecurityException error) {
                call.reject("AUDIO_PERMISSION_REVOKED", "AUDIO_PERMISSION_REVOKED", error);
            } catch (Exception error) {
                call.reject("MediaStore scan failed", error);
            }
        });
    }

    private static Long nullableLong(Cursor cursor, int column) {
        return cursor.isNull(column) ? null : cursor.getLong(column);
    }

    private static Integer nullableInt(Cursor cursor, int column) {
        return cursor.isNull(column) ? null : cursor.getInt(column);
    }

    @Override
    protected void handleOnDestroy() {
        scanExecutor.shutdown();
        super.handleOnDestroy();
    }
}
