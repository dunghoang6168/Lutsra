package com.audiolutstra.spike;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SpikePlaybackPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
