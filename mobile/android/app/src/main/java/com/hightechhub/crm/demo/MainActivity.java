package com.hightechhub.crm.demo;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureSessionPlugin.class);
        registerPlugin(AttachmentFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
