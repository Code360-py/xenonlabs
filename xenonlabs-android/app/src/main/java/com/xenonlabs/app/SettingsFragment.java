package com.xenonlabs.app;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

public class SettingsFragment extends Fragment {

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater,
                             @Nullable ViewGroup container,
                             @Nullable Bundle saved) {
        View v = inflater.inflate(R.layout.fragment_settings, container, false);

        SeekBar  maxTokBar = v.findViewById(R.id.maxTokens);
        TextView maxTokLbl = v.findViewById(R.id.maxTokensLabel);

        SeekBar  tempBar   = v.findViewById(R.id.temperature);
        TextView tempLbl   = v.findViewById(R.id.temperatureLabel);

        SeekBar  topPBar   = v.findViewById(R.id.topP);
        TextView topPLbl   = v.findViewById(R.id.topPLabel);

        SeekBar  topKBar   = v.findViewById(R.id.topK);
        TextView topKLbl   = v.findViewById(R.id.topKLabel);

        EditText sysField  = v.findViewById(R.id.systemPrompt);
        Button   saveBtn   = v.findViewById(R.id.save);

        int   maxTok = AppState.maxTokens(requireContext());
        float temp   = AppState.temperature(requireContext());
        float topP   = AppState.topP(requireContext());
        int   topK   = AppState.topK(requireContext());
        String sys   = AppState.systemPrompt(requireContext());

        maxTokBar.setMax(1024); maxTokBar.setProgress(maxTok);
        maxTokLbl.setText("Max tokens: " + maxTok);
        maxTokBar.setOnSeekBarChangeListener(new SimpleSeek(l -> maxTokLbl.setText("Max tokens: " + l)));

        tempBar.setMax(150); tempBar.setProgress((int)(temp * 100));
        tempLbl.setText("Temperature: " + String.format("%.2f", temp));
        tempBar.setOnSeekBarChangeListener(new SimpleSeek(l ->
            tempLbl.setText("Temperature: " + String.format("%.2f", l / 100f))));

        topPBar.setMax(100); topPBar.setProgress((int)(topP * 100));
        topPLbl.setText("Top-p: " + String.format("%.2f", topP));
        topPBar.setOnSeekBarChangeListener(new SimpleSeek(l ->
            topPLbl.setText("Top-p: " + String.format("%.2f", l / 100f))));

        topKBar.setMax(100); topKBar.setProgress(topK);
        topKLbl.setText("Top-k: " + topK);
        topKBar.setOnSeekBarChangeListener(new SimpleSeek(l -> topKLbl.setText("Top-k: " + l)));

        sysField.setText(sys);

        saveBtn.setOnClickListener(x -> {
            AppState.save(requireContext(),
                maxTokBar.getProgress(),
                tempBar.getProgress() / 100f,
                topPBar.getProgress() / 100f,
                topKBar.getProgress(),
                sysField.getText().toString());
            Toast.makeText(requireContext(), "Saved", Toast.LENGTH_SHORT).show();
        });

        return v;
    }

    private interface OnProgress { void onChange(int value); }
    private static class SimpleSeek implements SeekBar.OnSeekBarChangeListener {
        private final OnProgress cb;
        SimpleSeek(OnProgress cb) { this.cb = cb; }
        @Override public void onProgressChanged(SeekBar s, int v, boolean u) { cb.onChange(v); }
        @Override public void onStartTrackingTouch(SeekBar s) {}
        @Override public void onStopTrackingTouch(SeekBar s) {}
    }
}
