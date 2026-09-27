package com.audiolutstra.spike;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AndroidFolders")
public final class AndroidFolderPlugin extends Plugin {
    private static final String PREFS = "android-music-folders";
    private static final String KEY = "uris";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void choose(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "chosenFolder");
    }

    @ActivityCallback
    private void chosenFolder(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("FOLDER_SELECTION_CANCELLED", "FOLDER_SELECTION_CANCELLED");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            JSONArray saved = savedUris();
            boolean exists = false;
            for (int i = 0; i < saved.length(); i++) if (uri.toString().equals(saved.getString(i))) exists = true;
            if (!exists) { saved.put(uri.toString()); saveUris(saved); }
            JSObject response = new JSObject(); response.put("folders", folders(saved)); call.resolve(response);
        } catch (Exception error) { call.reject("Could not retain folder access", error); }
    }

    @PluginMethod
    public void list(PluginCall call) {
        try {
            JSObject response = new JSObject(); response.put("folders", folders(savedUris())); call.resolve(response);
        } catch (Exception error) { call.reject("Could not list folders", error); }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("Folder ID required"); return; }
        try {
            JSONArray existing = savedUris(); JSONArray kept = new JSONArray();
            for (int i = 0; i < existing.length(); i++) {
                String value = existing.getString(i);
                if (value.equals(id)) {
                    Uri uri = Uri.parse(value);
                    try { getContext().getContentResolver().releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
                    catch (SecurityException ignored) { /* Already revoked by Android. */ }
                } else kept.put(value);
            }
            saveUris(kept); call.resolve();
        } catch (Exception error) { call.reject("Could not remove folder", error); }
    }

    @PluginMethod
    public void scan(PluginCall call) {
        executor.execute(() -> {
            try {
                JSONArray saved = savedUris();
                JSONArray tracks = new JSONArray();
                HashSet<String> seen = new HashSet<>();
                for (int i = 0; i < saved.length(); i++) {
                    Uri tree = Uri.parse(saved.getString(i));
                    if (!hasReadGrant(tree)) throw new SecurityException("FOLDER_PERMISSION_REVOKED: " + tree);
                    String rootId = DocumentsContract.getTreeDocumentId(tree);
                    walk(tree, rootId, tracks, seen);
                }
                JSObject response = new JSObject(); response.put("tracks", tracks);
                call.resolve(response);
            } catch (SecurityException error) {
                call.reject("FOLDER_PERMISSION_REVOKED", "FOLDER_PERMISSION_REVOKED", error);
            } catch (Exception error) { call.reject("Folder scan failed", error); }
        });
    }

    private void walk(Uri tree, String parentId, JSONArray tracks, HashSet<String> seen) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        String[] columns = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED
        };
        try (Cursor cursor = getContext().getContentResolver().query(children, columns, null, null, null)) {
            if (cursor == null) throw new SecurityException("Folder is no longer accessible");
            while (cursor.moveToNext()) {
                String documentId = cursor.getString(0);
                String name = cursor.getString(1);
                String mime = cursor.getString(2);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    walk(tree, documentId, tracks, seen);
                    continue;
                }
                if (!isAudio(name, mime)) continue;
                String id = "android:document:" + tree.getAuthority() + ":" + documentId;
                if (!seen.add(id)) continue;
                Uri uri = DocumentsContract.buildDocumentUriUsingTree(tree, documentId);
                JSObject row = new JSObject();
                row.put("id", id); row.put("uri", uri.toString()); row.put("fileName", name);
                row.put("mimeType", mime); row.put("fileSize", cursor.isNull(3) ? null : cursor.getLong(3));
                row.put("lastModified", cursor.isNull(4) ? null : cursor.getLong(4));
                row.put("relativePath", documentId);
                readMetadata(uri, row);
                tracks.put(row);
            }
        }
    }

    private void readMetadata(Uri uri, JSObject row) {
        MediaMetadataRetriever reader = new MediaMetadataRetriever();
        try {
            reader.setDataSource(getContext(), uri);
            row.put("title", reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE));
            row.put("artist", reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
            row.put("album", reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM));
            row.put("durationMs", number(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)));
            row.put("trackNumber", number(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER)));
            row.put("year", number(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR)));
        } catch (RuntimeException ignored) {
            // A malformed file still appears in the library with its document name.
        } finally { try { reader.release(); } catch (Exception ignored) { } }
    }

    private static Long number(String value) {
        if (value == null) return null;
        try { return Long.parseLong(value); } catch (NumberFormatException ignored) { return null; }
    }

    private static boolean isAudio(String name, String mime) {
        String lower = name == null ? "" : name.toLowerCase(java.util.Locale.ROOT);
        return (mime != null && mime.startsWith("audio/")) || lower.endsWith(".mp3")
            || lower.endsWith(".flac") || lower.endsWith(".wav") || lower.endsWith(".m4a")
            || lower.endsWith(".ogg") || lower.endsWith(".opus");
    }

    private boolean hasReadGrant(Uri tree) {
        for (android.content.UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.isReadPermission() && permission.getUri().equals(tree)) return true;
        }
        return false;
    }

    private JSONArray folders(JSONArray saved) throws JSONException {
        JSONArray folders = new JSONArray();
        for (int i = 0; i < saved.length(); i++) {
            Uri tree = Uri.parse(saved.getString(i));
            String documentId = DocumentsContract.getTreeDocumentId(tree);
            String name = documentId.substring(documentId.lastIndexOf('/') + 1);
            JSObject folder = new JSObject();
            folder.put("id", tree.toString()); folder.put("path", tree.toString());
            folder.put("name", name.isEmpty() ? documentId : name); folder.put("addedAt", 0);
            folder.put("available", hasReadGrant(tree));
            folders.put(folder);
        }
        return folders;
    }

    private JSONArray savedUris() throws JSONException {
        return new JSONArray(getContext().getSharedPreferences(PREFS, 0).getString(KEY, "[]"));
    }

    private void saveUris(JSONArray uris) {
        getContext().getSharedPreferences(PREFS, 0).edit().putString(KEY, uris.toString()).apply();
    }

    @Override
    protected void handleOnDestroy() { executor.shutdown(); super.handleOnDestroy(); }
}
