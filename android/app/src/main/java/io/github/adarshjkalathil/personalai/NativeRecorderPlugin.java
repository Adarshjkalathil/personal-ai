package io.github.adarshjkalathil.personalai;

import android.Manifest;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;

/**
 * Bridge between the web app and RecorderService, plus Android's text-to-speech
 * (the WebView has no working speechSynthesis).
 *
 * Events: "audio" { data: base64 16 kHz mono PCM16 }, "ended" { error?: string }.
 */
@CapacitorPlugin(
    name = "NativeRecorder",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone"),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications"),
    }
)
public class NativeRecorderPlugin extends Plugin implements RecorderService.Listener {

    private PluginCall pendingStart;
    private TextToSpeech tts;
    private boolean ttsReady;

    @Override
    public void load() {
        RecorderService.listener = this;
        tts = new TextToSpeech(getContext(), (status) -> ttsReady = status == TextToSpeech.SUCCESS);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (RecorderService.isRunning()) {
            call.resolve();
            return;
        }
        List<String> missing = new ArrayList<>();
        if (getPermissionState("microphone") != PermissionState.GRANTED) missing.add("microphone");
        // The recording notification (with its Stop button) needs this on Android 13+.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") == PermissionState.PROMPT) {
            missing.add("notifications");
        }
        if (missing.isEmpty()) begin(call);
        else requestPermissionForAliases(missing.toArray(new String[0]), call, "permissionsAnswered");
    }

    @PermissionCallback
    private void permissionsAnswered(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission was denied. Allow it in Android Settings → Apps → Personal AI → Permissions.", "NotAllowedError");
            return;
        }
        begin(call);
    }

    private void begin(PluginCall call) {
        RecorderService.listener = this;
        pendingStart = call;
        RecorderService.start(getContext());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        RecorderService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (ttsReady && !text.isEmpty()) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "reply");
        call.resolve();
    }

    @Override
    public void onStarted() {
        PluginCall call = pendingStart;
        pendingStart = null;
        if (call != null) call.resolve();
    }

    @Override
    public void onAudio(short[] samples, int length) {
        byte[] bytes = new byte[length * 2];
        for (int i = 0; i < length; i++) {
            bytes[i * 2] = (byte) samples[i];
            bytes[i * 2 + 1] = (byte) (samples[i] >> 8);
        }
        JSObject data = new JSObject();
        data.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
        notifyListeners("audio", data);
    }

    @Override
    public void onEnded(String error) {
        PluginCall call = pendingStart;
        pendingStart = null;
        if (call != null) {
            call.reject(error != null ? error : "Recording was stopped.");
            return;
        }
        JSObject data = new JSObject();
        if (error != null) data.put("error", error);
        notifyListeners("ended", data);
    }

    @Override
    protected void handleOnDestroy() {
        // The page that transcribes the audio is going away, so stop recording with it.
        RecorderService.stop(getContext());
        if (RecorderService.listener == this) RecorderService.listener = null;
        if (tts != null) tts.shutdown();
    }
}
