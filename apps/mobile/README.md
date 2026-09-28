# ADD DOTS PDF for Android (and later iOS)

The web app (`apps/web/dist`) in a Capacitor 8 shell. On Android the app runs
in the system WebView, which is Chromium, the engine the web app's smoke test
runs in. iOS comes next (Stage G3), from the same project.

## What the phone app adds

The web app runs unchanged. The app's own plugin
(`android/app/src/main/java/com/adddots/pdf/AddDotsPlugin.java`) adds only
what a WebView cannot do; `apps/web/public/js/mobile.js` is its other half and
does nothing outside the app.

- **"Open with ADD DOTS PDF".** A PDF opened from Files, Gmail, WhatsApp and
  the like starts the app with a VIEW intent, or reaches it when already open.
  The page asks for it once (`launchFile`) or is told of it (`openFile`). Only
  the file the system handed over is read.
- **Saving.** Save sends the file's bytes to `saveFile`, and Android's own
  "save to" picker asks where (Downloads, Drive, a folder...). Cancelling it
  leaves the document unsaved: the Save popover stays open and crash recovery
  keeps the work.
- **No service worker.** The app carries every file, and a new version comes
  as an app update.
- Files cross between the page and the plugin as base64.

Not in the phone app yet: share links (they need the web server's API).

## Commands

```bash
npm ci                                         # once, at the repo root
npx turbo run build --filter=@adddots/web...   # the engine, then the web app
cd apps/mobile
npx cap sync android                           # copy the web app into the Android project
cd android && ./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
cd .. && node e2e-android.mjs                  # end-to-end, on a device or emulator (adb)
```

Needs JDK 21 and the Android SDK (Android Studio installs both). Open
`apps/mobile/android` in Android Studio to run it on a phone.

## The end-to-end test (`e2e-android.mjs`)

The installed app, driven through Playwright's Android support (the app's
WebView, over adb):

- "Open with" a PDF (a VIEW intent with a content:// URI, as Files or Gmail
  send it): it opens and page 1 is drawn, in the render worker
- the phone app, with the engine bundle, and no service worker
- a second PDF while the app is open (file://) replaces the first
- Save writes a PDF with every page (`window.ADDDOTS_TEST_SAVE`, honoured by
  debug builds only, stands in for the "save to" picker)
- no errors in the app

CI builds the debug APK on `ubuntu-latest`, uploads it as the `android-apk`
artifact, and runs the test on an Android 14 emulator. The web app's smoke
test also checks `mobile.js` in Chrome with the native side faked.

## Installing the test build

The APK is a debug build, not from the Play Store: on the phone, allow
"Install unknown apps" for the app you open it with (Files, Chrome), then open
the APK. A Play Store release needs a signed release build (an upload key) and
a Google Play developer account.
