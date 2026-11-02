import AppKit
import ApplicationServices
import Combine
import QuartzCore

/// ขอบเรืองแสงรอบหน้าต่างที่โฟกัสอยู่ (แนวเดียวกับ JankyBorders)
/// หน้าต่าง overlay โปร่งใสคลิกทะลุได้ วางซ้อนเหนือหน้าต่างเป้าหมายพอดี ติดตามด้วย AX notification
@MainActor
final class WindowBorderManager {
    static let shared = WindowBorderManager()

    private(set) var isRunning = false
    private var observer: AXObserver?
    private var observedPid: pid_t = 0
    private var focused: AXUIElement?
    private var focusedID: CGWindowID?
    private let focusOverlay = BorderOverlay()
    private var inactive: [CGWindowID: BorderOverlay] = [:]
    private var inactiveSignature: [CGWindowID] = []

    private var cancellables = Set<AnyCancellable>()
    private var trustWait: AnyCancellable?
    private var mouseMonitors: [Any] = []
    private var dragTimer: Timer?
    private var inactiveTimer: Timer?

    private var cfg: FeatureConfig { FeatureStore.shared.config }

    func setEnabled(_ on: Bool) { on ? start() : stop() }

    func start() {
        guard !isRunning else { return }
        guard AXIsProcessTrusted() else {
            // รอผู้ใช้อนุญาตแล้วเริ่มเอง
            AXTrust.shared.watch()
            trustWait = AXTrust.shared.$isTrusted.filter { $0 }.first().sink { [weak self] _ in
                MainActor.assumeIsolated {
                    if FeatureStore.shared.config.borderEnabled { self?.start() }
                }
            }
            return
        }
        isRunning = true

        let ws = NSWorkspace.shared.notificationCenter
        ws.publisher(for: NSWorkspace.didActivateApplicationNotification)
            .sink { [weak self] _ in self?.attachFrontmost() }
            .store(in: &cancellables)
        ws.publisher(for: NSWorkspace.activeSpaceDidChangeNotification)
            .sink { [weak self] _ in
                // หลังสลับ Space หน้าต่างโฟกัสอาจเปลี่ยน รอแอนิเมชันจบก่อน
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { self?.attachFrontmost() }
            }
            .store(in: &cancellables)
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in self?.refresh() }
            .store(in: &cancellables)

        // หน้าต่างของแอปนี้เอง (เช่นหน้าตั้งค่า) ไม่ใช้ AX แต่ฟังจาก NSWindow โดยตรง
        for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification, NSWindow.didBecomeKeyNotification] {
            NotificationCenter.default.publisher(for: name)
                .filter { ($0.object as? NSWindow)?.isBorderOverlay == false }
                .sink { [weak self] _ in self?.refresh() }
                .store(in: &cancellables)
        }

        FeatureStore.shared.$config
            .removeDuplicates()
            .sink { [weak self] c in
                DispatchQueue.main.async {
                    self?.updateInactiveTimer(c.borderShowInactive)
                    self?.inactiveSignature = []
                    self?.refresh()
                }
            }
            .store(in: &cancellables)

        // ระหว่างลากหน้าต่าง บางแอปส่ง AXMoved แค่ตอนปล่อยเมาส์ จึงตามตำแหน่งเองช่วงที่กดเมาส์ค้าง
        if let m = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp], handler: { e in
            let down = e.type == .leftMouseDown
            MainActor.assumeIsolated { WindowBorderManager.shared.mouse(down: down) }
        }) { mouseMonitors.append(m) }

        attachFrontmost()
    }

    func stop() {
        trustWait = nil
        cancellables.removeAll()
        mouseMonitors.forEach(NSEvent.removeMonitor)
        mouseMonitors.removeAll()
        dragTimer?.invalidate(); dragTimer = nil
        updateInactiveTimer(false)
        detach()
        focusOverlay.orderOut(nil)
        isRunning = false
    }

    // MARK: AX observer (ติดตามเฉพาะแอปที่อยู่หน้าสุด)

    private var refcon: UnsafeMutableRawPointer { Unmanaged.passUnretained(self).toOpaque() }

    private func attachFrontmost() {
        guard isRunning else { return }
        guard let app = NSWorkspace.shared.frontmostApplication else { detach(); refresh(); return }
        let pid = app.processIdentifier
        if pid == ProcessInfo.processInfo.processIdentifier {
            detach(); refresh(); return
        }
        if pid != observedPid || observer == nil {
            detach()
            var obs: AXObserver?
            guard AXObserverCreate(pid, borderCallback, &obs) == .success, let obs else { refresh(); return }
            let appEl = AXUIElementCreateApplication(pid)
            for n in [kAXFocusedWindowChangedNotification, kAXMainWindowChangedNotification,
                      kAXWindowMovedNotification, kAXWindowResizedNotification,
                      kAXWindowMiniaturizedNotification, kAXWindowDeminiaturizedNotification,
                      kAXApplicationHiddenNotification, kAXApplicationShownNotification] {
                AXObserverAddNotification(obs, appEl, n as CFString, refcon)
            }
            CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
            observer = obs
            observedPid = pid
        }
        updateFocused()
    }

    private func detach() {
        if let obs = observer {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
        }
        observer = nil
        observedPid = 0
        focused = nil
        focusedID = nil
    }

    private func updateFocused() {
        let w = observedPid != 0 ? AXWin.focusedWindow(pid: observedPid) : nil
        if let w, let obs = observer, focused.map({ !CFEqual($0, w) }) ?? true {
            AXObserverAddNotification(obs, w, kAXUIElementDestroyedNotification as CFString, refcon)
        }
        focused = w
        focusedID = nil
        refresh()
    }

    fileprivate func handle(_ notification: String) {
        switch notification {
        case kAXFocusedWindowChangedNotification, kAXMainWindowChangedNotification,
             kAXUIElementDestroyedNotification, kAXWindowDeminiaturizedNotification,
             kAXApplicationShownNotification:
            // ให้แอปจัดหน้าต่างเสร็จก่อน
            DispatchQueue.main.async { self.updateFocused() }
        default:
            refresh()
        }
    }

    private func mouse(down: Bool) {
        dragTimer?.invalidate(); dragTimer = nil
        if down {
            dragTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { _ in
                MainActor.assumeIsolated { WindowBorderManager.shared.refresh(reorder: false) }
            }
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { self.refresh() }
        }
    }

    // MARK: Layout

    /// กรอบ (Cocoa) และ window number ของหน้าต่างที่โฟกัสอยู่ หรือ nil ถ้าไม่ควรแสดงขอบ
    private func focusedTarget() -> (rect: CGRect, id: CGWindowID?)? {
        let me = ProcessInfo.processInfo.processIdentifier
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == me {
            guard let w = NSApp.keyWindow, !w.isBorderOverlay, w.isVisible,
                  !w.styleMask.contains(.fullScreen) else { return nil }
            return (w.frame, CGWindowID(w.windowNumber))
        }
        guard let w = focused, !AXWin.isMinimized(w), !AXWin.isFullScreen(w),
              let r = AXWin.frame(w), r.width > 20, r.height > 20 else { return nil }
        if focusedID == nil { focusedID = Self.windowID(pid: observedPid, axFrame: r) }
        return (AXWin.toCocoa(r), focusedID)
    }

    func refresh(reorder: Bool = true) {
        guard isRunning else { return }
        let c = cfg
        if let t = focusedTarget() {
            focusOverlay.apply(rect: t.rect, style: .init(active: true, cfg: c))
            if reorder || !focusOverlay.isVisible {
                if let id = t.id { focusOverlay.order(.above, relativeTo: Int(id)) } else { focusOverlay.orderFrontRegardless() }
            }
        } else {
            focusOverlay.orderOut(nil)
        }
        if c.borderShowInactive && reorder { refreshInactive(c) }
    }

    // MARK: Inactive windows (ทางเลือก ปิดไว้เป็นค่าเริ่มต้น เพราะต้องอ่านรายการหน้าต่างทุกวินาที)

    private func updateInactiveTimer(_ on: Bool) {
        if on, inactiveTimer == nil {
            inactiveTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
                MainActor.assumeIsolated {
                    let m = WindowBorderManager.shared
                    m.refreshInactive(m.cfg)
                }
            }
        } else if !on {
            inactiveTimer?.invalidate(); inactiveTimer = nil
            inactive.values.forEach { $0.orderOut(nil) }
            inactive.removeAll()
            inactiveSignature = []
        }
    }

    private func refreshInactive(_ c: FeatureConfig) {
        guard isRunning, c.borderShowInactive else { return }
        let me = ProcessInfo.processInfo.processIdentifier
        let screens = NSScreen.screens.map(\.frame)
        var found: [(CGWindowID, CGRect)] = []
        for info in Self.onScreenWindows() {
            guard let id = info[kCGWindowNumber as String] as? CGWindowID,
                  (info[kCGWindowLayer as String] as? Int) == 0,
                  let pid = info[kCGWindowOwnerPID as String] as? pid_t, pid != me,
                  (info[kCGWindowAlpha as String] as? Double ?? 1) > 0.05,
                  let b = info[kCGWindowBounds as String] as? NSDictionary,
                  let r = CGRect(dictionaryRepresentation: b), r.width > 60, r.height > 40,
                  id != focusedID
            else { continue }
            let cocoa = AXWin.toCocoa(r)
            if screens.contains(where: { $0.equalTo(cocoa) }) { continue }   // เต็มจอ
            found.append((id, cocoa))
        }
        let sig = found.map(\.0)
        let style = BorderOverlay.Style(active: false, cfg: c)
        for (id, rect) in found {
            let o = inactive[id] ?? BorderOverlay()
            inactive[id] = o
            o.apply(rect: rect, style: style)
            if sig != inactiveSignature || !o.isVisible { o.order(.above, relativeTo: Int(id)) }
        }
        for id in Set(inactive.keys).subtracting(sig) {
            inactive.removeValue(forKey: id)?.orderOut(nil)
        }
        inactiveSignature = sig
    }

    private static func onScreenWindows() -> [[String: Any]] {
        CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    }

    /// หา CGWindowID จาก pid + กรอบ (ไม่ใช้ private API _AXUIElementGetWindow)
    private static func windowID(pid: pid_t, axFrame: CGRect) -> CGWindowID? {
        for info in onScreenWindows() {
            guard (info[kCGWindowOwnerPID as String] as? pid_t) == pid,
                  (info[kCGWindowLayer as String] as? Int) == 0,
                  let b = info[kCGWindowBounds as String] as? NSDictionary,
                  let r = CGRect(dictionaryRepresentation: b),
                  abs(r.minX - axFrame.minX) < 2, abs(r.minY - axFrame.minY) < 2,
                  abs(r.width - axFrame.width) < 2, abs(r.height - axFrame.height) < 2
            else { continue }
            return info[kCGWindowNumber as String] as? CGWindowID
        }
        return nil
    }
}

private let borderCallback: AXObserverCallback = { _, _, notification, _ in
    let name = notification as String
    MainActor.assumeIsolated { WindowBorderManager.shared.handle(name) }
}

// MARK: - Overlay window

private extension NSWindow {
    var isBorderOverlay: Bool { self is BorderOverlay }
}

@MainActor
final class BorderOverlay: NSWindow {
    struct Style: Equatable {
        var c1: RGBA, c2: RGBA?, width: Double, radius: Double, glow: Double
        init(active: Bool, cfg c: FeatureConfig) {
            if active {
                c1 = c.borderColor; c2 = c.borderUseGradient ? c.borderColor2 : nil; glow = c.borderGlow
            } else {
                c1 = c.borderInactiveColor; c2 = nil; glow = 0
            }
            width = c.borderWidth; radius = c.borderRadius
        }
    }

    private let container = CALayer()
    private let shape = CAShapeLayer()
    private let gradient = CAGradientLayer()
    private var lastRect: CGRect = .null
    private var lastStyle: Style?

    init() {
        super.init(contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: true)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        ignoresMouseEvents = true
        isReleasedWhenClosed = false
        animationBehavior = .none
        level = .normal
        collectionBehavior = [.canJoinAllSpaces, .ignoresCycle, .transient]
        let v = NSView()
        v.wantsLayer = true
        v.layer?.addSublayer(container)
        contentView = v
        shape.fillColor = nil
        shape.lineJoin = .round
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    // ไม่ให้ AppKit ดันหน้าต่างลงมาใต้แถบเมนู ไม่งั้นขอบจะเลื่อนไม่ตรงกับหน้าต่างที่ชิดขอบบน
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }

    func apply(rect: CGRect, style s: Style) {
        let pad = s.width + s.glow * 2 + 2
        guard rect != lastRect || s != lastStyle else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        setFrame(rect.insetBy(dx: -pad, dy: -pad), display: false)
        let bounds = CGRect(origin: .zero, size: frame.size)
        container.frame = bounds
        // วาดเส้นด้านนอกขอบหน้าต่าง จะได้ไม่ทับเนื้อหา
        let inset = pad - s.width / 2
        let path = CGPath(roundedRect: bounds.insetBy(dx: inset, dy: inset),
                          cornerWidth: s.radius + s.width / 2, cornerHeight: s.radius + s.width / 2, transform: nil)
        shape.path = path
        shape.lineWidth = s.width
        shape.frame = bounds
        if let c2 = s.c2 {
            shape.strokeColor = NSColor.black.cgColor
            shape.removeFromSuperlayer()
            gradient.frame = bounds
            gradient.colors = [s.c1.borderCG, c2.borderCG]
            gradient.startPoint = CGPoint(x: 0, y: 1)
            gradient.endPoint = CGPoint(x: 1, y: 0)
            gradient.mask = shape
            if gradient.superlayer == nil { container.addSublayer(gradient) }
        } else {
            gradient.mask = nil
            gradient.removeFromSuperlayer()
            shape.strokeColor = s.c1.borderCG
            if shape.superlayer !== container { container.addSublayer(shape) }
        }
        container.shadowColor = s.c1.borderCG
        container.shadowOffset = .zero
        container.shadowRadius = s.glow
        container.shadowOpacity = s.glow > 0 ? 1 : 0
        CATransaction.commit()
        lastRect = rect
        lastStyle = s
    }
}

private extension RGBA {
    var borderCG: CGColor { CGColor(srgbRed: r, green: g, blue: b, alpha: a) }
}
