import AppKit
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
        openSettings()
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
        menu.addItem(item("ภาพพื้นหลังเคลื่อนไหว", #selector(toggleWallpaper), on: c.wallpaperMode != .off))
        menu.addItem(item("นาฬิกาบนเดสก์ท็อป", #selector(toggleClock), on: c.showClock))
        let f = FeatureStore.shared.config
        menu.addItem(item("ขอบหน้าต่าง", #selector(toggleBorders), on: f.borderEnabled))
        menu.addItem(item("จัดหน้าต่างด้วยคีย์ลัด", #selector(toggleSnap), on: f.snapEnabled))
        menu.addItem(item("แถบเมนูแบบกำหนดเอง", #selector(toggleBar), on: f.barEnabled))
        menu.addItem(item("ออกจากแอปเมื่อปิดหน้าต่างสุดท้าย", #selector(toggleTrueQuit), on: c.trueQuitEnabled))
        menu.addItem(.separator())
        menu.addItem(item("โหลดภาพพื้นหลังใหม่", #selector(reloadWallpaper)))
        menu.addItem(item("การตั้งค่า…", #selector(openSettings), key: ","))
        menu.addItem(.separator())
        menu.addItem(item("ออกจาก MacWallpaperPro", #selector(quit), key: "q"))
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
            w.toolbarStyle = .unified
            w.isReleasedWhenClosed = false
            w.setFrameAutosaveName("MacWallpaperProSettings")
            w.contentViewController = NSHostingController(rootView: MainView().environmentObject(Store.shared))
            w.center()
            settingsWindow = w
        }
        NSApp.activate()
        settingsWindow?.makeKeyAndOrderFront(nil)
    }
}
