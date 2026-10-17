package io.github.adarshjkalathil.personalai;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Records the microphone in a foreground service, so recording keeps going with the
 * screen off or another app open. Audio is 16 kHz mono PCM, handed to the web app
 * in ~200 ms batches; the web app does voice detection and transcription as usual.
 */
public class RecorderService extends Service {

    public static final int SAMPLE_RATE = 16000;
    private static final int BATCH_SAMPLES = SAMPLE_RATE / 5;
    private static final String CHANNEL_ID = "recording";
    private static final int NOTIFICATION_ID = 1;
    static final String ACTION_STOP = "io.github.adarshjkalathil.personalai.STOP";

    public interface Listener {
        void onStarted();
        void onAudio(short[] samples, int length);
        /** Recording ended without the app asking (the notification's Stop button, or an error). */
        void onEnded(String error);
    }

    static volatile Listener listener;
    private static volatile boolean running;

    private AudioRecord record;
    private Thread thread;
    private PowerManager.WakeLock wakeLock;
    private volatile boolean stopRequested;

    static boolean isRunning() {
        return running;
    }

    static void start(Context context) {
        Intent intent = new Intent(context, RecorderService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, RecorderService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            finish(null);
            return START_NOT_STICKY;
        }
        if (running) return START_NOT_STICKY;

        try {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type);
        } catch (RuntimeException e) {
            finish("Android didn't allow recording in the background: " + e.getMessage());
            return START_NOT_STICKY;
        }

        int minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        try {
            record = new AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                Math.max(minBuffer, BATCH_SAMPLES * 4)
            );
        } catch (SecurityException e) {
            finish("Microphone permission was denied. Allow it in Android Settings → Apps → Personal AI → Permissions.");
            return START_NOT_STICKY;
        }
        if (record.getState() != AudioRecord.STATE_INITIALIZED) {
            finish("The microphone couldn't be opened. Another app may be using it.");
            return START_NOT_STICKY;
        }

        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PersonalAI:recording");
        wakeLock.acquire();

        record.startRecording();
        running = true;
        stopRequested = false;
        thread = new Thread(this::readLoop, "recorder");
        thread.start();
        Listener l = listener;
        if (l != null) l.onStarted();
        return START_NOT_STICKY;
    }

    private void readLoop() {
        short[] buffer = new short[BATCH_SAMPLES];
        while (!stopRequested) {
            int filled = 0;
            while (filled < buffer.length && !stopRequested) {
                int read = record.read(buffer, filled, buffer.length - filled);
                if (read < 0) {
                    if (!stopRequested) new Handler(getMainLooper()).post(() -> finish("The microphone stopped working (error " + read + ")."));
                    return;
                }
                filled += read;
            }
            Listener l = listener;
            if (l != null && filled > 0) l.onAudio(buffer, filled);
        }
    }

    /** Ends recording on the service's own initiative and tells the app why (null: the user tapped Stop). */
    private void finish(String error) {
        Listener l = listener;
        stopSelf();
        if (l != null) l.onEnded(error);
    }

    @Override
    public void onDestroy() {
        stopRequested = true;
        running = false;
        if (record != null) {
            try {
                record.stop();
            } catch (IllegalStateException ignored) {}
        }
        if (thread != null) {
            try {
                thread.join(1000);
            } catch (InterruptedException ignored) {}
        }
        if (record != null) record.release();
        record = null;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    /** Swiping the app away closes the page that transcribes the audio, so recording stops too. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    private Notification buildNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Recording", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while Personal AI is recording");
            manager.createNotificationChannel(channel);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openApp = PendingIntent.getActivity(this, 0, open, flags);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, RecorderService.class).setAction(ACTION_STOP), flags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Personal AI is recording")
            .setContentText("Keep the app in your recent apps. Swiping it away stops recording.")
            .setContentIntent(openApp)
            .addAction(0, "Stop", stop)
            .setOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
