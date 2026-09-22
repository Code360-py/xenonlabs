package com.xenonlabs.app;

import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class ModelsFragment extends Fragment {

    private LinearLayout list;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater,
                             @Nullable ViewGroup container,
                             @Nullable Bundle saved) {
        View v = inflater.inflate(R.layout.fragment_models, container, false);
        list = v.findViewById(R.id.list);
        render();
        return v;
    }

    @Override
    public void onResume() { super.onResume(); render(); }

    private void render() {
        list.removeAllViews();
        String active = AppState.activeModelFilename(requireContext());

        for (AppState.ModelInfo m : AppState.MODELS) {
            list.addView(buildRow(m, active));
        }
    }

    private View buildRow(AppState.ModelInfo m, String active) {
        LinearLayout row = new LinearLayout(requireContext());
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(12, 18, 12, 18);

        TextView title = new TextView(requireContext());
        title.setText(m.name + (m.filename.equals(active) ? "  ★" : ""));
        title.setTextSize(16f);
        row.addView(title);

        TextView status = new TextView(requireContext());
        boolean ready = m.isReady(requireContext());
        File f = m.file(requireContext());
        long mb = f.exists() ? f.length() / (1024 * 1024) : 0;
        status.setText(ready ? ("Installed · " + mb + " MB") : ("Not downloaded · " + (m.approxBytes / (1024 * 1024)) + " MB"));
        status.setTextSize(12f);
        status.setPadding(0, 4, 0, 12);
        row.addView(status);

        ProgressBar bar = new ProgressBar(requireContext(), null,
            android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setVisibility(View.GONE);
        row.addView(bar);

        LinearLayout buttons = new LinearLayout(requireContext());
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setPadding(0, 8, 0, 0);

        if (!ready) {
            Button dl = new Button(requireContext());
            dl.setText("Download");
            dl.setOnClickListener(x -> download(m, bar, status, dl));
            buttons.addView(dl);
        } else {
            Button pick = new Button(requireContext());
            pick.setText(m.filename.equals(active) ? "Selected" : "Use");
            pick.setEnabled(!m.filename.equals(active));
            pick.setOnClickListener(x -> {
                AppState.setActiveModel(requireContext(), m.filename);
                render();
                Toast.makeText(requireContext(), "Selected. Restart Chat to load.", Toast.LENGTH_SHORT).show();
            });
            buttons.addView(pick);

            Button del = new Button(requireContext());
            del.setText("Delete");
            del.setOnClickListener(x -> new AlertDialog.Builder(requireContext())
                .setTitle("Delete " + m.name + "?")
                .setMessage("Frees " + mb + " MB.")
                .setPositiveButton("Delete", (d, w) -> {
                    if (m.file(requireContext()).delete()) render();
                })
                .setNegativeButton("Cancel", null)
                .show());
            buttons.addView(del);
        }

        row.addView(buttons);

        View divider = new View(requireContext());
        divider.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 2));
        row.addView(divider);

        return row;
    }

    private void download(AppState.ModelInfo m, ProgressBar bar, TextView status, Button dl) {
        dl.setEnabled(false);
        bar.setVisibility(View.VISIBLE);

        new Thread(() -> {
            File tmp = new File(requireContext().getFilesDir(), m.filename + ".part");
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(m.url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.connect();
                if (c.getResponseCode() != 200)
                    throw new Exception("HTTP " + c.getResponseCode());

                long total = c.getContentLengthLong();
                long done = 0;
                byte[] buf = new byte[1 << 16];

                try (InputStream in = c.getInputStream();
                     FileOutputStream out = new FileOutputStream(tmp)) {
                    int n; long last = 0;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        long now = System.currentTimeMillis();
                        if (now - last > 400) {
                            last = now;
                            int pct = total > 0 ? (int)(done * 100 / total) : 0;
                            long mb = done / (1024 * 1024);
                            long mt = total / (1024 * 1024);
                            ui.post(() -> {
                                bar.setProgress(pct);
                                status.setText("Downloading " + mb + " / " + mt + " MB (" + pct + "%)");
                            });
                        }
                    }
                }
                tmp.renameTo(m.file(requireContext()));
                ui.post(() -> {
                    status.setText("Installed");
                    bar.setVisibility(View.GONE);
                    render();
                });
            } catch (Exception e) {
                ui.post(() -> {
                    status.setText("Failed: " + e.getMessage());
                    bar.setVisibility(View.GONE);
                    dl.setEnabled(true);
                });
            }
        }).start();
    }
}
