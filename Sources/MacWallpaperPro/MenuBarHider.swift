import AppKit
import Combine

/// ซ่อนไอคอนบนแถบเมนู (แนวเดียวกับ Hidden Bar / Ice)
/// ใช้ status item สองตัว: ปุ่มลูกศรสำหรับสลับ และเส้นคั่นที่ยืดยาว 10,000 pt เพื่อดันไอคอนทางซ้ายของมันออกนอกจอ
/// ผู้ใช้เลือกไอคอนที่จะซ่อนเองโดยกด ⌘ ค้างแล้วลากไอคอนไปไว้ทางซ้ายของเส้นคั่น
@MainActor
final class MenuBarHider: NSObject, ObservableObject {
    static let shared = MenuBarHider()

    @Published private(set) var isRunning = false
    @Published private(set) var isHidden = false
    /// เส้นคั่นอยู่ทางขวาของปุ่มลูกศร (ผู้ใช้ลากสลับตำแหน่ง) ถ้ายืดออกจะซ่อนปุ่มลูกศรไปด้วย จึงไม่ยอมซ่อน
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
        // สร้างปุ่มลูกศรก่อน ระบบจะวางตัวที่สร้างทีหลัง (เส้นคั่น) ไว้ทางซ้าย
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
        // เปิดครั้งแรกให้เห็นเส้นคั่นก่อน จะได้จัดไอคอนได้
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
            // เช็กลำดับ: เส้นคั่นต้องอยู่ทางซ้ายของปุ่มลูกศร
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
        // ตั้ง tooltip ใหม่ทุกครั้ง เพื่อให้ตรงกับภาษาปัจจุบัน
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
        t.menu = nil   // คืนค่าให้คลิกซ้ายสลับได้ตามเดิม
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
