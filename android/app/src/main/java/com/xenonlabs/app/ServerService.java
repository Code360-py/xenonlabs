package com.xenonlabs.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * Foreground service that keeps the local HTTP server alive when the
 * app is backgrounded. The service owns the LocalServer instance and
 * shows a persistent notification while running.
 *
 * Start with startServer(), stop with stopServer(). Both are static
 * helpers so callers don't need to construct intents by hand.
 */
public class ServerService extends Service {

    public static final String TAG = "XenonServerSvc";

    public static final String ACTION_START = "com.xenonlabs.app.SERVER_START";
    public static final String ACTION_STOP  = "com.xenonlabs.app.SERVER_STOP";

    public static final String PREFS      = "xenon.server";
    public static final String K_PORT     = "port";
    public static final String K_API_KEY  = "api_key";
    public static final String K_ENABLED  = "enabled";

    private static final String CHANNEL_ID = "xenon-server";
    private static final int NOTIF_ID = 77;

    private LocalServer server;

    /* ------------------------------------------------------------------ */
    /* Static helpers                                                      */
    /* ------------------------------------------------------------------ */

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, ServerService.class);
        i.setAction(ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        Intent i = new Intent(ctx, ServerService.class);
        i.setAction(ACTION_STOP);
        ctx.startService(i);
    }

    public static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static int getPort(Context ctx) {
        return prefs(ctx).getInt(K_PORT, 8080);
    }
    public static void setPort(Context ctx, int p) {
        prefs(ctx).edit().putInt(K_PORT, p).apply();
    }

    public static String getApiKey(Context ctx) {
        String k = prefs(ctx).getString(K_API_KEY, null);
        if (k == null || k.isEmpty()) {
            k = generateKey();
            prefs(ctx).edit().putString(K_API_KEY, k).apply();
        }
        return k;
    }
    public static String regenerateKey(Context ctx) {
        String k = generateKey();
        prefs(ctx).edit().putString(K_API_KEY, k).apply();
        return k;
    }

    public static boolean isEnabled(Context ctx) {
        return prefs(ctx).getBoolean(K_ENABLED, false);
    }
    private static void setEnabled(Context ctx, boolean e) {
        prefs(ctx).edit().putBoolean(K_ENABLED, e).apply();
    }

    private static String generateKey() {
        /* 32 hex chars from two random UUIDs */
        String a = java.util.UUID.randomUUID().toString().replace("-", "");
        String b = java.util.UUID.randomUUID().toString().replace("-", "");
        return (a + b).substring(0, 32);
    }

    /* ------------------------------------------------------------------ */
    /* Lifecycle                                                           */
    /* ------------------------------------------------------------------ */

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = (intent != null) ? intent.getAction() : ACTION_START;

        if (ACTION_STOP.equals(action)) {
            stopServer();
            setEnabled(this, false);
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        /* ACTION_START or null */
        startForegroundNotification();
        startServer();
        setEnabled(this, true);
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        stopServer();
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /* Server management                                                   */
    /* ------------------------------------------------------------------ */

    private void startServer() {
        if (server != null && server.isRunning()) {
            Log.i(TAG, "server already running");
            return;
        }

        int port = getPort(this);
        String key = getApiKey(this);

        LocalServer.Generator gen = MainActivity.getGenerator();
        if (gen == null) {
            Log.e(TAG, "no generator available — is a model loaded?");
            updateNotification("No model loaded");
            return;
        }

        server = new LocalServer(port, key, gen);
        if (server.start()) {
            String ip = LocalServer.localIpv4();
            String url = "http://" + (ip != null ? ip : "0.0.0.0") + ":" + port;
            Log.i(TAG, "started: " + url);
            updateNotification(url);
        } else {
            Log.e(TAG, "failed to bind port " + port);
            updateNotification("Bind failed on :" + port);
            server = null;
        }
    }

    private void stopServer() {
        if (server != null) {
            server.stop();
            server = null;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Notification                                                        */
    /* ------------------------------------------------------------------ */

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID,
                    "Local server",
                    NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Shown while the Xenon local API is running");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    private PendingIntent openAppIntent() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(this, 0, i, flags);
    }

    private void startForegroundNotification() {
        ensureChannel();
        String title = "Xenon server";
        String text  = "Starting…";
        Notification n = buildNotification(title, text);
        startForeground(NOTIF_ID, n);
    }

    private void updateNotification(String text) {
        ensureChannel();
        Notification n = buildNotification("Xenon server", text);
        try {
            androidx.core.app.NotificationManagerCompat.from(this).notify(NOTIF_ID, n);
        } catch (SecurityException ignored) {}
    }

    private Notification buildNotification(String title, String text) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openAppIntent())
            .build();
    }
}
