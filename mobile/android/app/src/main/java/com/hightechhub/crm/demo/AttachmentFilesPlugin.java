package com.hightechhub.crm.demo;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.ClipData;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Map;
import java.util.HashMap;
import java.util.Collections;

@CapacitorPlugin(name = "AttachmentFiles")
public class AttachmentFilesPlugin extends Plugin {
    private static final Map<String,String> EXTENSIONS;
    static {
        Map<String,String> values=new HashMap<>();
        values.put("application/pdf","pdf");
        values.put("text/plain","txt");
        values.put("text/csv","csv");
        values.put("application/msword","doc");
        values.put("application/vnd.openxmlformats-officedocument.wordprocessingml.document","docx");
        values.put("application/vnd.ms-excel","xls");
        values.put("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","xlsx");
        values.put("application/vnd.ms-powerpoint","ppt");
        values.put("application/vnd.openxmlformats-officedocument.presentationml.presentation","pptx");
        EXTENSIONS=Collections.unmodifiableMap(values);
    }
    private File directory() { return new File(getContext().getCacheDir(), "viewed-attachments"); }
    private void purge() {
        File[] files = directory().listFiles();
        if (files != null) for (File file : files) {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            getContext().revokeUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            file.delete();
        }
    }
    private File shareDirectory() { return new File(getContext().getCacheDir(), "shared-quotations"); }
    private void purgeShares(boolean all) {
        File[] files=shareDirectory().listFiles();
        if(files!=null)for(File file:files)if(all||System.currentTimeMillis()-file.lastModified()>60*60*1000L){
            Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file);
            getContext().revokeUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);file.delete();
        }
    }
    @Override public void load() { purge(); purgeShares(true); }
    @PluginMethod public void clear(PluginCall call) { purge(); purgeShares(true); call.resolve(); }
    @PluginMethod public void open(PluginCall call) {
        String mime = call.getString("mime", "");
        String encoded = call.getString("data", "");
        if (!EXTENSIONS.containsKey(mime) || encoded.length() > 22369624) {
            call.reject("Unsupported document format or size"); return;
        }
        try {
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            if (bytes.length == 0 || bytes.length > 16 * 1024 * 1024) throw new IllegalArgumentException();
            purge();
            if (!directory().isDirectory() && !directory().mkdirs()) throw new IllegalStateException();
            File file = new File(directory(), "document." + EXTENSIONS.get(mime));
            try (FileOutputStream stream = new FileOutputStream(file)) { stream.write(bytes); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().runOnUiThread(() -> {
                try { getActivity().startActivity(intent); call.resolve(); }
                catch (ActivityNotFoundException e) { purge(); call.reject("No compatible viewer installed"); }
            });
        } catch (Exception e) { purge(); call.reject("Could not open document"); }
    }
    @PluginMethod public void share(PluginCall call) {
        String encoded=call.getString("data","");
        String filename=call.getString("filename","quotation.pdf").replaceAll("[^a-zA-Z0-9._-]","_");
        if(filename.length()>100)filename=filename.substring(filename.length()-100);
        if(!filename.endsWith(".pdf"))filename+=".pdf";
        if(encoded.length()>22369624){call.reject("PDF is too large to share");return;}
        try {
            byte[] bytes=Base64.decode(encoded,Base64.DEFAULT);
            if(bytes.length<5||bytes.length>16*1024*1024||bytes[0]!=37||bytes[1]!=80||bytes[2]!=68||bytes[3]!=70||bytes[4]!=45)throw new IllegalArgumentException();
            purgeShares(false);
            File dir=shareDirectory();if(!dir.isDirectory()&&!dir.mkdirs())throw new IllegalStateException();
            String hash=android.util.Base64.encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(bytes),android.util.Base64.URL_SAFE|android.util.Base64.NO_WRAP|android.util.Base64.NO_PADDING).substring(0,24);
            File file=new File(dir,hash+"-"+filename);
            File[] existing=dir.listFiles();if(!file.exists()&&existing!=null&&existing.length>=32)throw new IllegalStateException();
            if(!file.exists())try(FileOutputStream stream=new FileOutputStream(file)){stream.write(bytes);}
            file.setLastModified(System.currentTimeMillis());
            Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file,filename);
            Intent send=new Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(ClipData.newUri(getContext().getContentResolver(),"Quotation PDF",uri));
            Intent chooser=Intent.createChooser(send,"Share quotation PDF").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().runOnUiThread(()->{try{getActivity().startActivity(chooser);call.resolve();}catch(Exception e){call.reject("No sharing app is available");}});
        }catch(Exception e){call.reject("Could not prepare quotation sharing");}
    }
}
