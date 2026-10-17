package io.github.adarshjkalathil.personalai;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeRecorderPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = bridge.getWebView();
        // Keep the page that transcribes audio at full priority while the app is in the background.
        webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);

        // Back goes to the previous screen; on the first screen it sends the app to the
        // background instead of closing it, so a recording keeps going.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack();
                else moveTaskToBack(true);
            }
        });
    }
}
