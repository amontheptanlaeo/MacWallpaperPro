import AppKit
import Combine

/// Hide menu bar icons (in the spirit of Hidden Bar / Ice)
/// Uses two status items: an arrow button to toggle, and a separator that stretches to 10,000 pt to push the icons on its left off screen
/// Users choose which icons to hide by ⌘-dragging them to the left of the separator
@MainActor
final class MenuBarHider: NSObject, ObservableObject {
    static let shared = MenuBarHider()

    @Published private(set) var isRunning = false
    @Published private(set) var isHidden = false
    /// The separator is to the right of the arrow (the user swapped them); stretching it would hide the arrow too, so don't hide
    @Published private(set) var misordered = false

    private var toggle: NSStatusItem?
    private var separator: NSStatusItem?
    private var rehideTimer: Timer?

    private static let collapsedLength: CGFloat = 10_000
    private static let separatorLength: CGFloat = 14

    func setEnabled(_ on: Bool) { on ? start() : stop() }

    func start() {
        guard !isRunning else { return }
        isRunning = true
        // Create the arrow first: the system places the one created later (the separator) to its left
        let t = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        t.autosaveName = "MacWallpaperPro.hiderToggle"
        t.behavior = []
        if let b = t.button {
            b.target = self
            b.action = #selector(clicked(_:))
            b.sendAction(on: [.leftMouseUp, .rightMouseUp])
            b.toolTip = tr("Show or hide menu bar icons")
        }
        let s = NSStatusBar.system.statusItem(withLength: Self.separatorLength)
        s.autosaveName = "MacWallpaperPro.hiderSeparator"
        s.behavior = []
        if let b = s.button {
            b.image = Self.separatorImage
            b.appearsDisabled = true
            b.toolTip = tr("Icons to the left of this line are hidden. Hold ⌘ and drag to rearrange.")
        }
        toggle = t
        separator = s
        // On first launch show the separator so the icons can be arranged
        setHidden(false)
    }

    func stop() {
        rehideTimer?.invalidate(); rehideTimer = nil
        if let t = toggle { NSStatusBar.system.removeStatusItem(t) }
        if let s = separator { NSStatusBar.system.removeStatusItem(s) }
        toggle = nil; separator = nil
        isHidden = false
        isRunning = false
    }

    @objc private func clicked(_ sender: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            showMenu()
        } else {
            setHidden(!isHidden)
        }
    }

    func setHidden(_ hide: Bool) {
        guard let t = toggle, let s = separator else { return }
        rehideTimer?.invalidate(); rehideTimer = nil
        if hide {
            // Check the order: the separator must be to the left of the arrow
            if let tx = t.button?.window?.frame.minX, let sx = s.button?.window?.frame.minX, sx > tx {
                misordered = true
                return
            }
            misordered = false
            s.length = Self.collapsedLength
            s.button?.image = nil
        } else {
            s.length = Self.separatorLength
            s.button?.image = Self.separatorImage
            let c = FeatureStore.shared.config
            if c.hiderAutoRehide {
                rehideTimer = Timer.scheduledTimer(withTimeInterval: max(2, c.hiderDelay), repeats: false) { _ in
                    MainActor.assumeIsolated { MenuBarHider.shared.setHidden(true) }
                }
            }
        }
        isHidden = hide
        t.button?.image = NSImage(systemSymbolName: hide ? "chevron.left" : "chevron.right",
                                  accessibilityDescription: hide ? tr("Show hidden icons") : tr("Hide icons"))
        // Set the tooltip every time so it matches the current language
        t.button?.toolTip = tr("Show or hide menu bar icons")
        s.button?.toolTip = tr("Icons to the left of this line are hidden. Hold ⌘ and drag to rearrange.")
    }

    private func showMenu() {
        guard let t = toggle else { return }
        let m = NSMenu()
        let show = NSMenuItem(title: isHidden ? tr("Show hidden icons") : tr("Hide icons"), action: #selector(toggleFromMenu), keyEquivalent: "")
        show.target = self
        m.addItem(show)
        m.addItem(.separator())
        let settings = NSMenuItem(title: tr("Settings…"), action: #selector(openSettings), keyEquivalent: "")
        settings.target = self
        m.addItem(settings)
        t.menu = m
        t.button?.performClick(nil)
        t.menu = nil   // restore left-click toggling
    }

    @objc private func toggleFromMenu() { setHidden(!isHidden) }
    @objc private func openSettings() { (NSApp.delegate as? AppDelegate)?.openSettings() }

    private static let separatorImage: NSImage = {
        let img = NSImage(size: NSSize(width: 2, height: 16), flipped: false) { r in
            NSColor.labelColor.withAlphaComponent(0.5).setFill()
            NSBezierPath(roundedRect: r, xRadius: 1, yRadius: 1).fill()
            return true
        }
        img.isTemplate = true
        return img
    }()
}
