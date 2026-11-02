import AppKit
import ApplicationServices
import Combine
import SwiftUI

@main
@MainActor
enum Main {
    static let delegate = AppDelegate()
    static func main() {
        let app = NSApplication.shared
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private var settingsWindow: NSWindow?
    private var cancellables = Set<AnyCancellable>()

    func application(_ application: NSApplication, open urls: [URL]) {
        urls.forEach(DeepLink.handle)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupStatusItem()
        WallpaperManager.shared.start()
        Features.start()
        Store.shared.$config
            .map(\.trueQuitEnabled)
            .removeDuplicates()
            .sink { TrueQuit.shared.setEnabled($0) }
            .store(in: &cancellables)
        applyTestPage()
        openSettings()
        runLanguageSwitchSelfTest()
    }

    /// Open a given page at launch for test screenshots: `MWP_TEST_PAGE=discover`, `settings:clock`, `library:details`
    private func applyTestPage() {
        guard let spec = ProcessInfo.processInfo.environment["MWP_TEST_PAGE"] else { return }
        let parts = spec.split(separator: ":").map(String.init)
        let nav = Navigator.shared
        if let page = AppPage(rawValue: parts[0]) { nav.page = page }
        if parts.count > 1 {
            if let s = SettingsSection(rawValue: parts[1]) { nav.settingsSection = s }
            if parts[1] == "details" { nav.showActiveDetails = true }
        }
    }

    /// Test switching languages while running with `MWP_TEST_LANG_SWITCH=ja,ar,th` (no effect for regular users)
    private func runLanguageSwitchSelfTest() {
        guard let codes = ProcessInfo.processInfo.environment["MWP_TEST_LANG_SWITCH"]?.split(separator: ",") else { return }
        for (i, code) in codes.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i + 1) * 3) {
                if let lang = AppLanguage.all.first(where: { $0.code == code }) { Localizer.shared.set(lang) }
            }
        }
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "paintpalette.fill", accessibilityDescription: "MacWallpaperPro")
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        let c = Store.shared.config
        menu.removeAllItems()
        menu.addItem(item(tr("Live wallpaper"), #selector(toggleWallpaper), on: c.wallpaperMode != .off))
        menu.addItem(item(tr("Desktop clock"), #selector(toggleClock), on: c.showClock))
        let f = FeatureStore.shared.config
        menu.addItem(item(tr("Window borders"), #selector(toggleBorders), on: f.borderEnabled))
        menu.addItem(item(tr("Snap windows with shortcuts"), #selector(toggleSnap), on: f.snapEnabled))
        menu.addItem(item(tr("Custom menu bar"), #selector(toggleBar), on: f.barEnabled))
        menu.addItem(item(tr("Quit apps when last window closes"), #selector(toggleTrueQuit), on: c.trueQuitEnabled))
        menu.addItem(.separator())
        menu.addItem(item(tr("Reload wallpaper"), #selector(reloadWallpaper)))
        menu.addItem(item(tr("Settings…"), #selector(openSettings), key: ","))
        menu.addItem(.separator())
        menu.addItem(item(tr("Quit MacWallpaperPro"), #selector(quit), key: "q"))
    }

    private func item(_ title: String, _ action: Selector, key: String = "", on: Bool? = nil) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = self
        if let on { i.state = on ? .on : .off }
        return i
    }

    @objc private func toggleWallpaper() {
        let s = Store.shared
        s.config.wallpaperMode = s.config.wallpaperMode == .off ? s.config.lastActiveMode : .off
    }

    @objc private func toggleClock() { Store.shared.config.showClock.toggle() }
    @objc private func toggleBorders() { FeatureStore.shared.config.borderEnabled.toggle() }
    @objc private func toggleSnap() { FeatureStore.shared.config.snapEnabled.toggle() }
    @objc private func toggleBar() { FeatureStore.shared.config.barEnabled.toggle() }

    @objc private func toggleTrueQuit() { Store.shared.config.trueQuitEnabled.toggle() }
    @objc private func reloadWallpaper() { WallpaperManager.shared.reload() }
    @objc private func quit() { NSApp.terminate(nil) }

    @objc func openSettings() {
        if settingsWindow == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 760),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                             backing: .buffered, defer: false)
            w.title = "MacWallpaperPro"
            // Fully custom window chrome: hide the titlebar (keep the traffic-light buttons) and no NSToolbar
            w.titleVisibility = .hidden
            w.titlebarAppearsTransparent = true
            w.titlebarSeparatorStyle = .none
            w.appearance = NSAppearance(named: .darkAqua)
            w.backgroundColor = NSColor(red: 0x0E / 255, green: 0x0E / 255, blue: 0x12 / 255, alpha: 1)
            w.minSize = NSSize(width: 1000, height: 640)
            w.isReleasedWhenClosed = false
            let host = NSHostingController(rootView: MainView().environmentObject(Store.shared))
            host.sizingOptions = []
            w.contentViewController = host
            w.setContentSize(NSSize(width: 1200, height: 760))
            w.center()
            // Restore the user's size/position (must run after setting contentViewController, otherwise it shrinks to the minimum size)
            w.setFrameAutosaveName("MacWallpaperProSettings")
            settingsWindow = w
        }
        NSApp.activate()
        settingsWindow?.makeKeyAndOrderFront(nil)
    }
}
