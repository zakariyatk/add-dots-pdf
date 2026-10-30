package com.adddots.pdf;

import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // the app's own plugin (opening and saving files), before the bridge starts
        registerPlugin(AddDotsPlugin.class);
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // the app decides (js/phone.js). With nothing left it goes to the
                // background rather than closing, so an open document stays open.
                getBridge().getWebView().evaluateJavascript(
                    "!!(window.ADDPDF && window.ADDPDF.back && window.ADDPDF.back())",
                    used -> {
                        if (!"true".equals(used)) moveTaskToBack(true);
                    }
                );
            }
        });
    }
}
