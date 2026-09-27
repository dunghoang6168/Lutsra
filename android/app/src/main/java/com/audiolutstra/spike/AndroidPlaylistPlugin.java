package com.audiolutstra.spike;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import java.util.HashSet;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AndroidPlaylists")
public final class AndroidPlaylistPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private PlaylistDatabase helper;

    @Override
    public void load() {
        helper = new PlaylistDatabase(getContext());
    }

    @PluginMethod
    public void list(PluginCall call) {
        executor.execute(() -> {
            try {
                SQLiteDatabase db = helper.getReadableDatabase();
                JSONArray playlists = new JSONArray();
                try (Cursor cursor = db.query("playlists", null, null, null, null, null, "created_at ASC")) {
                    while (cursor.moveToNext()) playlists.put(readPlaylist(db, cursor.getString(0)));
                }
                JSObject result = new JSObject();
                result.put("playlists", playlists);
                call.resolve(result);
            } catch (Exception error) { call.reject("Could not read Android playlists", error); }
        });
    }

    @PluginMethod
    public void create(PluginCall call) {
        String name = cleanName(call.getString("name"));
        if (name == null) { call.reject("Playlist name is required"); return; }
        executor.execute(() -> {
            try {
                SQLiteDatabase db = helper.getWritableDatabase();
                long now = System.currentTimeMillis();
                String id = UUID.randomUUID().toString();
                ContentValues values = new ContentValues();
                values.put("id", id); values.put("name", name);
                values.put("created_at", now); values.put("updated_at", now);
                db.insertOrThrow("playlists", null, values);
                resolvePlaylist(call, db, id);
            } catch (Exception error) { call.reject("Could not create playlist", error); }
        });
    }

    @PluginMethod
    public void rename(PluginCall call) {
        String id = call.getString("id");
        String name = cleanName(call.getString("name"));
        if (id == null || name == null) { call.reject("Playlist ID and name are required"); return; }
        executor.execute(() -> {
            try {
                SQLiteDatabase db = helper.getWritableDatabase();
                ContentValues values = new ContentValues();
                values.put("name", name); values.put("updated_at", System.currentTimeMillis());
                if (db.update("playlists", values, "id=?", new String[]{id}) == 0) throw new IllegalArgumentException("Playlist not found");
                resolvePlaylist(call, db, id);
            } catch (Exception error) { call.reject("Could not rename playlist", error); }
        });
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("Playlist ID is required"); return; }
        executor.execute(() -> {
            try {
                SQLiteDatabase db = helper.getWritableDatabase();
                if (db.delete("playlists", "id=?", new String[]{id}) == 0) throw new IllegalArgumentException("Playlist not found");
                call.resolve();
            } catch (Exception error) { call.reject("Could not delete playlist", error); }
        });
    }

    @PluginMethod
    public void addTracks(PluginCall call) {
        String id = call.getString("id");
        JSArray trackIds = call.getArray("trackIds");
        if (id == null || trackIds == null) { call.reject("Playlist ID and track IDs are required"); return; }
        executor.execute(() -> {
            SQLiteDatabase db = helper.getWritableDatabase();
            db.beginTransaction();
            try {
                requirePlaylist(db, id);
                int position;
                try (Cursor cursor = db.rawQuery("SELECT COALESCE(MAX(position), -1) + 1 FROM entries WHERE playlist_id=?", new String[]{id})) {
                    cursor.moveToFirst(); position = cursor.getInt(0);
                }
                long now = System.currentTimeMillis();
                for (int i = 0; i < trackIds.length(); i++) {
                    String trackId = trackIds.getString(i);
                    if (trackId.isEmpty()) throw new IllegalArgumentException("Track ID is empty");
                    ContentValues values = new ContentValues();
                    values.put("id", UUID.randomUUID().toString());
                    values.put("playlist_id", id); values.put("track_id", trackId);
                    values.put("position", position++); values.put("added_at", now);
                    db.insertOrThrow("entries", null, values);
                }
                touch(db, id);
                db.setTransactionSuccessful();
            } catch (Exception error) { call.reject("Could not add tracks", error); return; }
            finally { db.endTransaction(); }
            try { resolvePlaylist(call, db, id); }
            catch (Exception error) { call.reject("Could not read playlist", error); }
        });
    }

    @PluginMethod
    public void removeEntry(PluginCall call) {
        String id = call.getString("id");
        String entryId = call.getString("entryId");
        if (id == null || entryId == null) { call.reject("Playlist and entry IDs are required"); return; }
        executor.execute(() -> {
            try {
                SQLiteDatabase db = helper.getWritableDatabase();
                requirePlaylist(db, id);
                if (db.delete("entries", "id=? AND playlist_id=?", new String[]{entryId, id}) == 0)
                    throw new IllegalArgumentException("Entry not found");
                touch(db, id);
                resolvePlaylist(call, db, id);
            } catch (Exception error) { call.reject("Could not remove playlist entry", error); }
        });
    }

    @PluginMethod
    public void reorder(PluginCall call) {
        String id = call.getString("id");
        JSArray entryIds = call.getArray("entryIds");
        if (id == null || entryIds == null) { call.reject("Playlist and entry IDs are required"); return; }
        executor.execute(() -> {
            SQLiteDatabase db = helper.getWritableDatabase();
            db.beginTransaction();
            try {
                requirePlaylist(db, id);
                int count;
                try (Cursor cursor = db.rawQuery("SELECT COUNT(*) FROM entries WHERE playlist_id=?", new String[]{id})) {
                    cursor.moveToFirst(); count = cursor.getInt(0);
                }
                if (count != entryIds.length()) throw new IllegalArgumentException("Reorder must include every entry");
                HashSet<String> seen = new HashSet<>();
                for (int i = 0; i < entryIds.length(); i++) {
                    String entryId = entryIds.getString(i);
                    if (!seen.add(entryId)) throw new IllegalArgumentException("Duplicate entry ID");
                    ContentValues values = new ContentValues(); values.put("position", i);
                    if (db.update("entries", values, "id=? AND playlist_id=?", new String[]{entryId, id}) == 0)
                        throw new IllegalArgumentException("Entry not found");
                }
                touch(db, id);
                db.setTransactionSuccessful();
            } catch (Exception error) { call.reject("Could not reorder playlist", error); return; }
            finally { db.endTransaction(); }
            try { resolvePlaylist(call, db, id); }
            catch (Exception error) { call.reject("Could not read playlist", error); }
        });
    }

    private void resolvePlaylist(PluginCall call, SQLiteDatabase db, String id) throws JSONException {
        JSObject result = new JSObject(); result.put("playlist", readPlaylist(db, id)); call.resolve(result);
    }

    private JSObject readPlaylist(SQLiteDatabase db, String id) throws JSONException {
        JSObject playlist = new JSObject();
        try (Cursor cursor = db.query("playlists", null, "id=?", new String[]{id}, null, null, null)) {
            if (!cursor.moveToFirst()) throw new IllegalArgumentException("Playlist not found");
            playlist.put("id", cursor.getString(0)); playlist.put("name", cursor.getString(1));
            playlist.put("createdAt", cursor.getLong(2)); playlist.put("updatedAt", cursor.getLong(3));
        }
        JSONArray entries = new JSONArray();
        try (Cursor cursor = db.query("entries", null, "playlist_id=?", new String[]{id}, null, null, "position ASC")) {
            while (cursor.moveToNext()) {
                JSObject entry = new JSObject();
                entry.put("id", cursor.getString(0)); entry.put("trackId", cursor.getString(2));
                entry.put("addedAt", cursor.getLong(4)); entries.put(entry);
            }
        }
        playlist.put("entries", entries);
        return playlist;
    }

    private void requirePlaylist(SQLiteDatabase db, String id) {
        try (Cursor cursor = db.rawQuery("SELECT 1 FROM playlists WHERE id=?", new String[]{id})) {
            if (!cursor.moveToFirst()) throw new IllegalArgumentException("Playlist not found");
        }
    }

    private void touch(SQLiteDatabase db, String id) {
        ContentValues values = new ContentValues(); values.put("updated_at", System.currentTimeMillis());
        db.update("playlists", values, "id=?", new String[]{id});
    }

    private String cleanName(String name) {
        if (name == null) return null;
        String trimmed = name.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
        if (helper != null) helper.close();
        super.handleOnDestroy();
    }

    private static final class PlaylistDatabase extends SQLiteOpenHelper {
        PlaylistDatabase(Context context) { super(context, "android-playlists.db", null, 1); }
        @Override
        public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
            db.execSQL("CREATE TABLE entries (id TEXT PRIMARY KEY, playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, track_id TEXT NOT NULL, position INTEGER NOT NULL, added_at INTEGER NOT NULL)");
            db.execSQL("CREATE INDEX entries_playlist_position ON entries(playlist_id, position)");
        }
        @Override
        public void onConfigure(SQLiteDatabase db) { db.setForeignKeyConstraintsEnabled(true); }
        @Override
        public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { throw new IllegalStateException("No playlist migration defined"); }
    }
}
