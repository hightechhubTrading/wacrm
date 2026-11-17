package com.hightechhub.crm.demo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SecureSession")
public class SecureSessionPlugin extends Plugin {
    private SessionVault vault;
    @Override public void load() { vault = new SessionVault(getContext(), "secure-session"); }
    private String name(PluginCall call) {
        String key = call.getString("key", "");
        if (!key.matches("hth-mobile-(session(-user|-code-verifier)?|pending-send)")) throw new IllegalArgumentException();
        return key;
    }
    @PluginMethod public void get(PluginCall call) {
        try { String value = vault.get(name(call)); JSObject result = new JSObject(); result.put("value", value == null ? org.json.JSONObject.NULL : value); call.resolve(result); }
        catch (Exception e) { call.reject("Secure session unavailable"); }
    }
    @PluginMethod public void set(PluginCall call) {
        try { String value = call.getString("value"); if (value == null || value.length() > 131072) throw new IllegalArgumentException(); vault.set(name(call), value); call.resolve(); }
        catch (Exception e) { call.reject("Secure session could not be saved"); }
    }
    @PluginMethod public void remove(PluginCall call) {
        try { vault.remove(name(call)); call.resolve(); }
        catch (Exception e) { call.reject("Secure session could not be removed"); }
    }
}
