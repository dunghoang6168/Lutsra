package com.audiolutstra.spike;

import android.app.Activity;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.function.Consumer;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "SpikePlayback")
public final class SpikePlaybackPlugin extends Plugin {
    private ListenableFuture<MediaController> controllerFuture;
    private MediaController controller;
    private final Player.Listener listener = new Player.Listener() {
        @Override
        public void onEvents(Player player, Player.Events events) {
            notifyListeners("state", stateOf(player));
        }
    };

    @PluginMethod
    public void pickAndPlay(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("audio/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickedAudio");
    }

    @ActivityCallback
    private void pickedAudio(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("File selection cancelled");
            return;
        }
        Intent data = result.getData();
        List<Uri> uris = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        if (uris.isEmpty()) {
            call.reject("No audio URI returned");
            return;
        }

        List<MediaItem> items = new ArrayList<>();
        for (Uri uri : uris) {
            try {
                getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // Playback can still use the temporary picker grant; the spike records persistence separately.
            }
            String title = displayName(uri);
            items.add(new MediaItem.Builder()
                .setMediaId(uri.toString())
                .setUri(uri)
                .setMediaMetadata(new MediaMetadata.Builder().setTitle(title).build())
                .build());
        }
        withController(call, mediaController -> {
            mediaController.setMediaItems(items);
            mediaController.prepare();
            mediaController.play();
            call.resolve(stateOf(mediaController));
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        withController(call, mediaController -> call.resolve(stateOf(mediaController)));
    }

    @PluginMethod
    public void playTestQueue(PluginCall call) {
        try {
            List<MediaItem> items = new ArrayList<>();
            items.add(testItem(440));
            items.add(testItem(660));
            withController(call, mediaController -> {
                mediaController.setMediaItems(items);
                mediaController.prepare();
                mediaController.play();
                call.resolve(stateOf(mediaController));
            });
        } catch (IOException error) {
            call.reject("Could not create test audio", error);
        }
    }

    @PluginMethod
    public void play(PluginCall call) {
        withController(call, mediaController -> {
            mediaController.play();
            call.resolve(stateOf(mediaController));
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        withController(call, mediaController -> {
            mediaController.pause();
            call.resolve(stateOf(mediaController));
        });
    }

    @PluginMethod
    public void next(PluginCall call) {
        withController(call, mediaController -> {
            mediaController.seekToNextMediaItem();
            call.resolve(stateOf(mediaController));
        });
    }

    @PluginMethod
    public void previous(PluginCall call) {
        withController(call, mediaController -> {
            mediaController.seekToPreviousMediaItem();
            call.resolve(stateOf(mediaController));
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Double positionMs = call.getDouble("positionMs");
        if (positionMs == null || positionMs < 0 || !Double.isFinite(positionMs)) {
            call.reject("Invalid positionMs");
            return;
        }
        withController(call, mediaController -> {
            mediaController.seekTo(positionMs.longValue());
            call.resolve(stateOf(mediaController));
        });
    }

    private void withController(PluginCall call, Consumer<MediaController> action) {
        getActivity().runOnUiThread(() -> {
            if (controller != null) {
                action.accept(controller);
                return;
            }
            if (controllerFuture == null) {
                SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), SpikePlaybackService.class));
                controllerFuture = new MediaController.Builder(getContext(), token).buildAsync();
            }
            controllerFuture.addListener(() -> {
                try {
                    MediaController connected = controllerFuture.get();
                    if (controller == null) {
                        controller = connected;
                        controller.addListener(listener);
                    }
                    action.accept(connected);
                } catch (ExecutionException | InterruptedException error) {
                    call.reject("Media3 controller connection failed", error);
                } catch (RuntimeException error) {
                    call.reject("Media3 playback command failed", error);
                }
            }, ContextCompat.getMainExecutor(getContext()));
        });
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (RuntimeException ignored) {
            // A provider may omit metadata while still allowing the file to be opened.
        }
        return uri.getLastPathSegment() == null ? "Unknown audio" : uri.getLastPathSegment();
    }

    private MediaItem testItem(int frequencyHz) throws IOException {
        File file = new File(getContext().getCacheDir(), "spike-" + frequencyHz + "hz.wav");
        if (!file.exists()) {
            int sampleRate = 44100;
            int sampleCount = sampleRate * 30;
            ByteBuffer wave = ByteBuffer.allocate(44 + sampleCount * 2).order(ByteOrder.LITTLE_ENDIAN);
            wave.put("RIFF".getBytes(StandardCharsets.US_ASCII));
            wave.putInt(36 + sampleCount * 2);
            wave.put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII));
            wave.putInt(16);
            wave.putShort((short) 1);
            wave.putShort((short) 1);
            wave.putInt(sampleRate);
            wave.putInt(sampleRate * 2);
            wave.putShort((short) 2);
            wave.putShort((short) 16);
            wave.put("data".getBytes(StandardCharsets.US_ASCII));
            wave.putInt(sampleCount * 2);
            for (int i = 0; i < sampleCount; i++) {
                wave.putShort((short) Math.round(Math.sin(2 * Math.PI * frequencyHz * i / sampleRate) * 12000));
            }
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(wave.array());
            }
        }
        String title = "Test " + frequencyHz + " Hz";
        return new MediaItem.Builder()
            .setMediaId(title)
            .setUri(Uri.fromFile(file))
            .setMediaMetadata(new MediaMetadata.Builder().setTitle(title).build())
            .build();
    }

    private JSObject stateOf(Player player) {
        JSObject state = new JSObject();
        state.put("playing", player.isPlaying());
        state.put("playWhenReady", player.getPlayWhenReady());
        state.put("playbackState", player.getPlaybackState());
        state.put("positionMs", player.getCurrentPosition());
        state.put("durationMs", player.getDuration());
        state.put("index", player.getCurrentMediaItemIndex());
        state.put("count", player.getMediaItemCount());
        MediaItem item = player.getCurrentMediaItem();
        state.put("title", item == null || item.mediaMetadata.title == null ? "" : item.mediaMetadata.title.toString());
        return state;
    }

    @Override
    protected void handleOnDestroy() {
        if (controller != null) controller.removeListener(listener);
        if (controllerFuture != null) MediaController.releaseFuture(controllerFuture);
        controller = null;
        controllerFuture = null;
        super.handleOnDestroy();
    }
}
