import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // a PDF the app was opened with ("Open in Add Dots PDF"), before the
        // page asks for it
        if let url = connectionOptions.urlContexts.first?.url {
            AddDotsPlugin.handOver(url)
        }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AppViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // a PDF handed over while the app is open
        if let url = URLContexts.first?.url, url.isFileURL {
            AddDotsPlugin.handOver(url)
        }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// The bridge, with the app's own plugin.
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AddDotsPlugin())
    }
}

/// What the web app cannot do by itself in a WKWebView; the Android plugin's
/// twin (same name and methods, so js/mobile.js serves both).
///
/// Opening: a PDF opened from Files, Mail and the like ("Open in ADD DOTS
/// PDF") reaches the app as a file URL. The page asks for it once
/// (launchFile), or hears of it (openFile) when the app was already open.
/// Only the file iOS handed over is read.
///
/// Saving: the page sends the file's bytes (saveFile) and iOS's own "Save to
/// Files" picker asks where. Cancelling resolves { cancelled: true }.
@objc(AddDotsPlugin)
public class AddDotsPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "AddDotsPlugin"
    public let jsName = "AddDots"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "launchFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveFile", returnType: CAPPluginReturnPromise)
    ]

    /// the file handed over before the page asked, until it asks
    private static var pending: URL?
    private static weak var shared: AddDotsPlugin?
    private var saveCall: CAPPluginCall?
    private var saveTemp: URL?

    override public func load() {
        AddDotsPlugin.shared = self
    }

    static func handOver(_ url: URL) {
        if let plugin = shared {
            plugin.announce(url)
        } else {
            pending = url
        }
    }

    private func announce(_ url: URL) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                self.notifyListeners("openFile", data: try self.read(url), retainUntilConsumed: true)
            } catch {
                self.notifyListeners("openFile", data: ["error": error.localizedDescription], retainUntilConsumed: true)
            }
        }
    }

    private func read(_ url: URL) throws -> [String: Any] {
        // a file from Files may need its access asked for; one iOS copied
        // into the app's inbox does not
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: url)
        let name = url.lastPathComponent.isEmpty ? "document.pdf" : url.lastPathComponent
        return ["name": name, "data": data.base64EncodedString()]
    }

    /// The PDF this start was asked to open, once; {} when there is none.
    @objc func launchFile(_ call: CAPPluginCall) {
        guard let url = AddDotsPlugin.pending else {
            call.resolve([:])
            return
        }
        AddDotsPlugin.pending = nil
        do {
            call.resolve(try read(url))
        } catch {
            call.reject("Could not open the file: " + error.localizedDescription)
        }
    }

    private static func safeName(_ name: String) -> String {
        let bad = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)
        let cleaned = name.components(separatedBy: bad).joined(separator: "_")
            .trimmingCharacters(in: .whitespaces)
        return cleaned.isEmpty ? "document.pdf" : cleaned
    }

    /// The bytes (base64) written where the reader picks.
    @objc func saveFile(_ call: CAPPluginCall) {
        let name = AddDotsPlugin.safeName(call.getString("name") ?? "document.pdf")
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("nothing to save")
            return
        }
        #if DEBUG
        // For the tests, in a debug build only: into the app's own folder
        // without the picker, which a test cannot press.
        if call.getBool("test") ?? false {
            do {
                let docs = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask,
                                                       appropriateFor: nil, create: true)
                let dir = docs.appendingPathComponent("saved", isDirectory: true)
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let file = dir.appendingPathComponent(name)
                try data.write(to: file, options: .atomic)
                call.resolve(["name": name, "uri": file.absoluteString])
            } catch {
                call.reject("Could not save: " + error.localizedDescription)
            }
            return
        }
        #endif
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try data.write(to: temp, options: .atomic)
        } catch {
            call.reject("Could not save: " + error.localizedDescription)
            return
        }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("Could not open the Save picker")
                return
            }
            self.saveCall = call
            self.saveTemp = temp
            let picker = UIDocumentPickerViewController(forExporting: [temp], asCopy: true)
            picker.delegate = self
            vc.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finishSave(urls.first)
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishSave(nil)
    }

    private func finishSave(_ url: URL?) {
        if let temp = saveTemp { try? FileManager.default.removeItem(at: temp) }
        saveTemp = nil
        guard let call = saveCall else { return }
        saveCall = nil
        if let url = url {
            call.resolve(["name": url.lastPathComponent, "uri": url.absoluteString])
        } else {
            call.resolve(["cancelled": true])
        }
    }
}
