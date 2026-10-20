package com.adddots.pdf;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * What the web app cannot do by itself in an Android WebView.
 *
 * Opening: a PDF opened from another app (Files, Gmail, WhatsApp...) starts
 * this app with a VIEW intent. The page asks for it once (launchFile), or
 * hears of it (openFile) when the app was already running. Only the file the
 * system handed over is read, never any other.
 *
 * Saving: the page sends the file's bytes (saveFile) and Android's own
 * "save to" picker asks where. Cancelling resolves { cancelled: true }.
 *
 * Sharing: the page sends the file's bytes (shareFile) and Android's share
 * sheet offers the apps that take it (WhatsApp, Gmail, Drive...). The copy
 * lives in the app's cache, under shared/, and is replaced by the next one.
 */
@CapacitorPlugin(name = "AddDots")
public class AddDotsPlugin extends Plugin {

    /** the file this start was asked to open, until the page takes it */
    private Uri pending;
    /** the bytes waiting for the picker's answer */
    private byte[] toSave;

    @Override
    public void load() {
        pending = pdfUri(getActivity().getIntent());
    }

    private static Uri pdfUri(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return null;
        return intent.getData();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        final Uri uri = pdfUri(intent);
        if (uri == null) return;
        // reading a large file is not for the UI thread
        new Thread(() -> {
            try {
                notifyListeners("openFile", read(uri), true);
            } catch (IOException e) {
                JSObject err = new JSObject();
                err.put("error", e.getMessage());
                notifyListeners("openFile", err, true);
            }
        }).start();
    }

    private JSObject read(Uri uri) throws IOException {
        byte[] bytes;
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("could not open the file");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            bytes = out.toByteArray();
        }
        JSObject o = new JSObject();
        o.put("name", displayName(uri));
        o.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
        return o;
    }

    private String displayName(Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = getContext().getContentResolver()
                    .query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (RuntimeException ignored) {
                // a provider that will not say: fall back to the path
            }
        }
        if (name == null) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "document.pdf";
        return name;
    }

    /** The PDF this start was asked to open, once; {} when there is none. */
    @PluginMethod
    public void launchFile(PluginCall call) {
        Uri uri = pending;
        pending = null;
        if (uri == null) {
            call.resolve(new JSObject());
            return;
        }
        try {
            call.resolve(read(uri));
        } catch (IOException e) {
            call.reject("Could not open the file: " + e.getMessage());
        }
    }

    private boolean debuggable() {
        return (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /** The bytes (base64) written where the reader picks. */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "document.pdf");
        String type = call.getString("type", "application/pdf");
        String data = call.getString("data");
        if (data == null) {
            call.reject("nothing to save");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        // For the tests, in a debug build only: into the app's own folder
        // without the picker, which a test cannot press.
        if (debuggable() && call.getBoolean("test", false)) {
            File dir = new File(getContext().getFilesDir(), "saved");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File f = new File(dir, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
            try (OutputStream out = new FileOutputStream(f)) {
                out.write(bytes);
            } catch (IOException e) {
                call.reject("Could not save: " + e.getMessage());
                return;
            }
            JSObject r = new JSObject();
            r.put("name", f.getName());
            r.put("uri", Uri.fromFile(f).toString());
            call.resolve(r);
            return;
        }
        toSave = bytes;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(type);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "saved");
    }

    /** The bytes (base64) handed to the app the reader picks from the share sheet. */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("name", "document.pdf").replaceAll("[\\\\/:*?\"<>|]", "_");
        String type = call.getString("type", "application/pdf");
        String data = call.getString("data");
        if (data == null) {
            call.reject("nothing to share");
            return;
        }
        File dir = new File(getContext().getCacheDir(), "shared");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
        File f = new File(dir, name);
        try (OutputStream out = new FileOutputStream(f)) {
            out.write(Base64.decode(data, Base64.DEFAULT));
        } catch (IOException e) {
            call.reject("Could not share: " + e.getMessage());
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(type);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(send, name);
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().startActivity(chooser);
        call.resolve(new JSObject());
    }

    @ActivityCallback
    private void saved(PluginCall call, ActivityResult result) {
        byte[] bytes = toSave;
        toSave = null;
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null || bytes == null) {
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        Uri uri = data.getData();
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new IOException("could not write there");
            out.write(bytes);
        } catch (IOException e) {
            call.reject("Could not save: " + e.getMessage());
            return;
        }
        JSObject r = new JSObject();
        r.put("name", displayName(uri));
        r.put("uri", uri.toString());
        call.resolve(r);
    }
}
