# ADD DOTS PDF for Android and iOS

The web app (`apps/web/dist`) in a Capacitor 8 shell. On Android the app runs
in the system WebView, which is Chromium, the engine the web app's smoke test
runs in. On iOS it runs in WKWebView, the Safari engine (WebKit).

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

- **Share links** go through the website set in `js/config.js`
  (`shareServer`, https://pdf.adddots.com/): the document is uploaded to its
  API, and the links handed out open there, in any browser. The server must
  allow the apps' origins (`cors_origins` in `legacy/api/config.php`:
  `https://localhost` for Android, `capacitor://localhost` for iOS,
  `http://tauri.localhost` for Windows).

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

## iOS

The same web app and the same page code (`js/mobile.js`): the app's plugin
has a Swift twin with the same name and methods, in
`ios/App/App/SceneDelegate.swift` (kept in a file the Xcode project already
lists, so the project file needs no hand edits).

- **"Open in ADD DOTS PDF"** from Files, Mail and other apps: the app is
  registered for PDFs (`Info.plist`, `CFBundleDocumentTypes`); iOS hands it a
  copy of the file, read once by the page (`launchFile`) or announced to it
  (`openFile`).
- **Save** goes to iOS's own "Save to Files" picker; cancelling it keeps the
  document unsaved.

```bash
npx turbo run build --filter=@adddots/web...
cd apps/mobile && npx cap sync ios
npx cap open ios        # on a Mac: opens the project in Xcode, Run
```

CI (`macos-latest`) checks the web app in WebKit (`apps/web/bench/webkit.mjs`:
a PDF opens and is drawn, its text read, Save), builds the app for the iOS
simulator, installs and starts it there (still running after 20 s, with a
screenshot), and uploads the build as `ios-simulator-app`.

Not yet: a test that drives the app's pages inside the iOS simulator (WKWebView
cannot be attached to from Linux or Playwright; that needs Safari's Web
Inspector or an XCUITest target), and a build for a real iPhone, which needs
an Apple developer account to sign it (TestFlight, then the App Store).
