package com.adddots.pdf;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // the app's own plugin (opening and saving files), before the bridge starts
        registerPlugin(AddDotsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
