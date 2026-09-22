package com.xenonlabs.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.widget.RemoteViews;

public class XenonWidget extends AppWidgetProvider {

    public static final String PREFS = "xenon.widget";
    public static final String KEY_LAST = "last_reply";

    /* Called when the widget is first added, on periodic refresh, and on manual update. */
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) {
            updateWidget(ctx, mgr, id);
        }
    }

    /** Public helper — the app calls this whenever a reply completes. */
    public static void refresh(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(
            new android.content.ComponentName(ctx, XenonWidget.class));
        for (int id : ids) {
            updateWidget(ctx, mgr, id);
        }
    }

    private static void updateWidget(Context ctx, AppWidgetManager mgr, int widgetId) {
        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.widget_layout);

        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String last = sp.getString(KEY_LAST, "Open XenonLabs and start chatting");
        views.setTextViewText(R.id.widget_last_reply, last);

        /* Tapping the title or reply opens the app */
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, flags);
        views.setOnClickPendingIntent(R.id.widget_title, pi);
        views.setOnClickPendingIntent(R.id.widget_last_reply, pi);

        /* New chat button */
        Intent newChat = new Intent(ctx, MainActivity.class);
        newChat.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        newChat.putExtra("xenon_new_chat", true);
        PendingIntent piNew = PendingIntent.getActivity(ctx, 1, newChat, flags);
        views.setOnClickPendingIntent(R.id.widget_new_chat, piNew);

        mgr.updateAppWidget(widgetId, views);
    }
}
