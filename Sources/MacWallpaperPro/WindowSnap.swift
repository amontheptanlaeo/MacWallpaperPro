import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Combine

/// Window snapping with keyboard shortcuts (in the spirit of Rectangle)
/// Shortcuts use Carbon RegisterEventHotKey, which needs no extra permission, but moving/resizing windows needs Accessibility
@MainActor
final class WindowSnapper: ObservableObject {
    static let shared = WindowSnapper()

    @Published private(set) var isRunning = false
    /// Actions whose shortcut failed to register (usually taken by another app)
    @Published private(set) var failed: Set<SnapAction> = []

    private var handler: EventHandlerRef?
    private var refs: [EventHotKeyRef] = []
    private var suspended = false
    private static let signature: OSType = 0x4D575053   // 'MWPS'

    func setEnabled(_ on: Bool) {
        isRunning = on
        if on { installHandler() }
        reregister()
    }

    /// Temporarily disable shortcuts while a new one is being recorded in Settings
    func suspend(_ on: Bool) {
        suspended = on
        reregister()
    }

    func reregister() {
        refs.forEach { UnregisterEventHotKey($0) }
        refs.removeAll()
        var bad = Set<SnapAction>()
        guard isRunning, !suspended else { failed = []; return }
        let map = FeatureStore.shared.config.snapShortcuts
        for (i, a) in SnapAction.allCases.enumerated() {
            guard let k = map[a.rawValue], !k.isNone else { continue }
            var ref: EventHotKeyRef?
            let id = EventHotKeyID(signature: Self.signature, id: UInt32(i + 1))
            if RegisterEventHotKey(k.keyCode, k.modifiers, id, GetApplicationEventTarget(), 0, &ref) == noErr, let ref {
                refs.append(ref)
            } else {
                bad.insert(a)
            }
        }
        failed = bad
    }

    private func installHandler() {
        guard handler == nil else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), snapHotKeyHandler, 1, &spec, nil, &handler)
    }

    fileprivate func fire(_ id: UInt32) {
        let all = SnapAction.allCases
        guard id >= 1, Int(id) <= all.count else { return }
        perform(all[Int(id) - 1])
    }

    // MARK: Perform

    func perform(_ action: SnapAction) {
        guard let app = NSWorkspace.shared.frontmostApplication else { return }
        let pid = app.processIdentifier

        // This app's own windows can be arranged through NSWindow directly
        if pid == ProcessInfo.processInfo.processIdentifier {
            guard let w = NSApp.keyWindow, w.styleMask.contains(.resizable) || action == .center || action == .nextDisplay,
                  let t = target(action, current: w.frame) else { NSSound.beep(); return }
            w.setFrame(t, display: true, animate: false)
            return
        }

        guard AXIsProcessTrusted() else { AXTrust.shared.watch(); return }
        guard let w = AXWin.focusedWindow(pid: pid), !AXWin.isFullScreen(w),
              let ax = AXWin.frame(w),
              let t = target(action, current: AXWin.toCocoa(ax)) else { NSSound.beep(); return }

        // AXEnhancedUserInterface (turned on by VoiceOver/some apps) makes window moves slow and glitchy, so turn it off temporarily
        let appEl = AXUIElementCreateApplication(pid)
        let enhanced: Bool = AXWin.attr(appEl, "AXEnhancedUserInterface") ?? false
        if enhanced { AXUIElementSetAttributeValue(appEl, "AXEnhancedUserInterface" as CFString, kCFBooleanFalse) }
        let r = AXWin.toAX(t)
        // Set size -> position -> size again, in case the size was clamped while still at the old screen edge
        AXWin.setSize(w, r.size)
        AXWin.setPosition(w, r.origin)
        AXWin.setSize(w, r.size)
        if enhanced { AXUIElementSetAttributeValue(appEl, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue) }
    }

    // MARK: Geometry (Cocoa coordinates)

    private static func screen(for r: CGRect) -> NSScreen? {
        NSScreen.screens.max { a, b in
            let ia = a.frame.intersection(r), ib = b.frame.intersection(r)
            return (ia.isNull ? 0 : ia.width * ia.height) < (ib.isNull ? 0 : ib.width * ib.height)
        } ?? NSScreen.main
    }

    /// Usable screen area: excludes the menu bar/Dock and the custom menu bar when it's on
    static func usableArea(_ s: NSScreen) -> CGRect {
        var v = s.visibleFrame
        v.size.height -= CustomMenuBar.shared.reservedTop(on: s)
        let g = FeatureStore.shared.config.snapGap
        return v.insetBy(dx: g, dy: g)
    }

    private func target(_ a: SnapAction, current cur: CGRect) -> CGRect? {
        guard let s = Self.screen(for: cur) else { return nil }
        let v = Self.usableArea(s)
        let g = FeatureStore.shared.config.snapGap
        let hw = ((v.width - g) / 2).rounded(.down), hh = ((v.height - g) / 2).rounded(.down)
        switch a {
        case .leftHalf: return CGRect(x: v.minX, y: v.minY, width: hw, height: v.height)
        case .rightHalf: return CGRect(x: v.maxX - hw, y: v.minY, width: hw, height: v.height)
        case .topHalf: return CGRect(x: v.minX, y: v.maxY - hh, width: v.width, height: hh)
        case .bottomHalf: return CGRect(x: v.minX, y: v.minY, width: v.width, height: hh)
        case .topLeft: return CGRect(x: v.minX, y: v.maxY - hh, width: hw, height: hh)
        case .topRight: return CGRect(x: v.maxX - hw, y: v.maxY - hh, width: hw, height: hh)
        case .bottomLeft: return CGRect(x: v.minX, y: v.minY, width: hw, height: hh)
        case .bottomRight: return CGRect(x: v.maxX - hw, y: v.minY, width: hw, height: hh)
        case .maximize: return v
        case .almostMaximize: return v.insetBy(dx: (v.width * 0.05).rounded(), dy: (v.height * 0.05).rounded())
        case .center:
            let w = min(cur.width, v.width), h = min(cur.height, v.height)
            return CGRect(x: (v.midX - w / 2).rounded(), y: (v.midY - h / 2).rounded(), width: w, height: h)
        case .nextDisplay:
            let screens = NSScreen.screens.sorted { $0.frame.minX < $1.frame.minX }
            guard screens.count > 1, let i = screens.firstIndex(of: s) else { return nil }
            let n = Self.usableArea(screens[(i + 1) % screens.count])
            // Keep position and size proportional to the old screen's area
            let w = min(cur.width / v.width * n.width, n.width)
            let h = min(cur.height / v.height * n.height, n.height)
            let x = n.minX + (cur.minX - v.minX) / v.width * n.width
            let y = n.minY + (cur.minY - v.minY) / v.height * n.height
            return CGRect(x: min(max(x, n.minX), n.maxX - w).rounded(),
                          y: min(max(y, n.minY), n.maxY - h).rounded(), width: w.rounded(), height: h.rounded())
        }
    }
}

private let snapHotKeyHandler: EventHandlerUPP = { _, event, _ in
    guard let event else { return OSStatus(eventNotHandledErr) }
    var hk = EventHotKeyID()
    let st = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                               nil, MemoryLayout<EventHotKeyID>.size, nil, &hk)
    guard st == noErr, hk.signature == 0x4D575053 else { return OSStatus(eventNotHandledErr) }
    let id = hk.id
    MainActor.assumeIsolated { WindowSnapper.shared.fire(id) }
    return noErr
}
