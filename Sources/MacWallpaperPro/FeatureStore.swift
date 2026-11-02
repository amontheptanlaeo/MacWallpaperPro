import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Combine
import SwiftUI

// MARK: - Shortcut (Carbon key code + modifier)

struct HotKeyCombo: Codable, Equatable, Hashable {
    var keyCode: UInt32
    var modifiers: UInt32   // cmdKey / shiftKey / optionKey / controlKey ของ Carbon

    static let ctrlOpt = UInt32(controlKey | optionKey)
    /// ปิดคีย์ลัด (เก็บเป็นค่าแทน เพื่อไม่ให้ตอนโหลดเติมค่าเริ่มต้นกลับมา)
    static let none = HotKeyCombo(keyCode: .max, modifiers: 0)
    var isNone: Bool { keyCode == .max }

    init(keyCode: UInt32, modifiers: UInt32) { self.keyCode = keyCode; self.modifiers = modifiers }

    init(_ keyCode: Int, _ modifiers: UInt32 = HotKeyCombo.ctrlOpt) {
        self.keyCode = UInt32(keyCode); self.modifiers = modifiers
    }

    init?(event: NSEvent) {
        let f = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        var m: UInt32 = 0
        if f.contains(.control) { m |= UInt32(controlKey) }
        if f.contains(.option) { m |= UInt32(optionKey) }
        if f.contains(.shift) { m |= UInt32(shiftKey) }
        if f.contains(.command) { m |= UInt32(cmdKey) }
        // ต้องมีปุ่มกำกับอย่างน้อยหนึ่งตัวที่ไม่ใช่ Shift เพื่อไม่ชนการพิมพ์ปกติ
        guard m & ~UInt32(shiftKey) != 0 else { return nil }
        keyCode = UInt32(event.keyCode); modifiers = m
    }

    var display: String {
        var s = ""
        if modifiers & UInt32(controlKey) != 0 { s += "⌃" }
        if modifiers & UInt32(optionKey) != 0 { s += "⌥" }
        if modifiers & UInt32(shiftKey) != 0 { s += "⇧" }
        if modifiers & UInt32(cmdKey) != 0 { s += "⌘" }
        return s + Self.keyName(Int(keyCode))
    }

    private static let special: [Int: String] = [
        kVK_LeftArrow: "←", kVK_RightArrow: "→", kVK_UpArrow: "↑", kVK_DownArrow: "↓",
        kVK_Return: "↩", kVK_ANSI_KeypadEnter: "⌤", kVK_Space: "Space", kVK_Tab: "⇥",
        kVK_Delete: "⌫", kVK_ForwardDelete: "⌦", kVK_Escape: "⎋", kVK_Home: "↖", kVK_End: "↘",
        kVK_PageUp: "⇞", kVK_PageDown: "⇟",
        kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4", kVK_F5: "F5", kVK_F6: "F6",
        kVK_F7: "F7", kVK_F8: "F8", kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11", kVK_F12: "F12",
    ]

    /// แปลง key code เป็นตัวอักษรตามแป้นพิมพ์ที่ใช้อยู่ (ใช้ layout ASCII เพื่อไม่ให้ขึ้นเป็นภาษาไทย)
    static func keyName(_ code: Int) -> String {
        if let s = special[code] { return s }
        guard let src = TISCopyCurrentASCIICapableKeyboardLayoutInputSource()?.takeRetainedValue(),
              let ptr = TISGetInputSourceProperty(src, kTISPropertyUnicodeKeyLayoutData)
        else { return "#\(code)" }
        let data = Unmanaged<CFData>.fromOpaque(ptr).takeUnretainedValue() as Data
        var dead: UInt32 = 0
        var chars = [UniChar](repeating: 0, count: 4)
        var len = 0
        let status = data.withUnsafeBytes { raw -> OSStatus in
            guard let layout = raw.baseAddress?.assumingMemoryBound(to: UCKeyboardLayout.self) else { return -1 }
            return UCKeyTranslate(layout, UInt16(code), UInt16(kUCKeyActionDisplay), 0, UInt32(LMGetKbdType()),
                                  OptionBits(kUCKeyTranslateNoDeadKeysBit), &dead, 4, &len, &chars)
        }
        guard status == noErr, len > 0 else { return "#\(code)" }
        return String(utf16CodeUnits: chars, count: len).uppercased()
    }
}

// MARK: - Snap actions

enum SnapAction: String, Codable, CaseIterable, Identifiable {
    case leftHalf, rightHalf, topHalf, bottomHalf
    case topLeft, topRight, bottomLeft, bottomRight
    case maximize, almostMaximize, center, nextDisplay
    var id: String { rawValue }

    var label: String {
        switch self {
        case .leftHalf: "ครึ่งซ้าย"
        case .rightHalf: "ครึ่งขวา"
        case .topHalf: "ครึ่งบน"
        case .bottomHalf: "ครึ่งล่าง"
        case .topLeft: "มุมซ้ายบน"
        case .topRight: "มุมขวาบน"
        case .bottomLeft: "มุมซ้ายล่าง"
        case .bottomRight: "มุมขวาล่าง"
        case .maximize: "เต็มพื้นที่"
        case .almostMaximize: "เกือบเต็ม"
        case .center: "กึ่งกลางจอ"
        case .nextDisplay: "ย้ายไปจอถัดไป"
        }
    }

    var symbol: String {
        switch self {
        case .leftHalf: "rectangle.lefthalf.filled"
        case .rightHalf: "rectangle.righthalf.filled"
        case .topHalf: "rectangle.tophalf.filled"
        case .bottomHalf: "rectangle.bottomhalf.filled"
        case .topLeft: "square.tophalf.filled"
        case .topRight: "square.tophalf.filled"
        case .bottomLeft: "square.bottomhalf.filled"
        case .bottomRight: "square.bottomhalf.filled"
        case .maximize: "rectangle.fill"
        case .almostMaximize: "rectangle.inset.filled"
        case .center: "rectangle.center.inset.filled"
        case .nextDisplay: "display.2"
        }
    }

    var defaultCombo: HotKeyCombo {
        switch self {
        case .leftHalf: HotKeyCombo(kVK_LeftArrow)
        case .rightHalf: HotKeyCombo(kVK_RightArrow)
        case .topHalf: HotKeyCombo(kVK_UpArrow)
        case .bottomHalf: HotKeyCombo(kVK_DownArrow)
        case .topLeft: HotKeyCombo(kVK_ANSI_U)
        case .topRight: HotKeyCombo(kVK_ANSI_I)
        case .bottomLeft: HotKeyCombo(kVK_ANSI_J)
        case .bottomRight: HotKeyCombo(kVK_ANSI_K)
        case .maximize: HotKeyCombo(kVK_Return)
        case .almostMaximize: HotKeyCombo(kVK_Return, HotKeyCombo.ctrlOpt | UInt32(shiftKey))
        case .center: HotKeyCombo(kVK_ANSI_C)
        case .nextDisplay: HotKeyCombo(kVK_RightArrow, HotKeyCombo.ctrlOpt | UInt32(cmdKey))
        }
    }

    static var defaultShortcuts: [String: HotKeyCombo] {
        Dictionary(uniqueKeysWithValues: allCases.map { ($0.rawValue, $0.defaultCombo) })
    }
}

// MARK: - Feature config

struct FeatureConfig: Codable, Equatable {
    // ขอบหน้าต่าง
    var borderEnabled = false
    var borderColor = RGBA(0.35, 0.65, 1.0)
    var borderUseGradient = false
    var borderColor2 = RGBA(0.75, 0.35, 1.0)
    var borderWidth = 4.0
    var borderRadius = 12.0
    var borderGlow = 10.0
    var borderShowInactive = false
    var borderInactiveColor = RGBA(0.6, 0.6, 0.6, 0.5)

    // จัดหน้าต่างด้วยคีย์ลัด
    var snapEnabled = false
    var snapGap = 0.0
    var snapShortcuts: [String: HotKeyCombo] = SnapAction.defaultShortcuts   // HotKeyCombo.none = ปิดคีย์ลัดนั้น

    // ซ่อนไอคอนบนแถบเมนู
    var hiderEnabled = false
    var hiderAutoRehide = true
    var hiderDelay = 10.0

    // แถบเมนูแบบกำหนดเอง
    var barEnabled = false
    var barAllScreens = true
    var barColor = RGBA(0.08, 0.08, 0.10)
    var barOpacity = 0.55
    var barBlur = true
    var barHeight = 30.0
    var barRadius = 10.0
    var barMargin = 6.0
    var barFontFamily = ""
    var barFontSize = 12.0
    var barTextColor = RGBA(1, 1, 1, 0.95)
    var barShowApp = true
    var barShowClock = true
    var barShowDate = true
    var barShowBattery = true
    var barShowCPU = true
    var barShowMemory = true
    var barShowNetwork = true

    func barFont(_ weight: Font.Weight = .medium) -> Font {
        barFontFamily.isEmpty
            ? .system(size: barFontSize, weight: weight)
            : .custom(barFontFamily, size: barFontSize).weight(weight)
    }
}

// MARK: - Store

@MainActor
final class FeatureStore: ObservableObject {
    static let shared = FeatureStore()
    private static let key = "MacWallpaperPro.features"

    @Published var config: FeatureConfig {
        didSet { if config != oldValue { save() } }
    }

    private init() { config = FeatureStore.load() }

    private func save() {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: FeatureStore.key)
        }
    }

    // รวมค่าที่บันทึกไว้ทับค่า default (แบบเดียวกับ Store) เพื่อเพิ่มฟิลด์ใหม่ได้โดยไม่ทำค่าเดิมหาย
    private static func load() -> FeatureConfig {
        let def = FeatureConfig()
        guard let data = UserDefaults.standard.data(forKey: key),
              let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let defData = try? JSONEncoder().encode(def),
              var base = try? JSONSerialization.jsonObject(with: defData) as? [String: Any]
        else { return def }
        base.merge(saved) { _, new in new }
        guard let merged = try? JSONSerialization.data(withJSONObject: base),
              var cfg = try? JSONDecoder().decode(FeatureConfig.self, from: merged)
        else { return def }
        // คีย์ลัดของ action ที่เพิ่มมาใหม่ใช้ค่าเริ่มต้น
        for a in SnapAction.allCases where cfg.snapShortcuts[a.rawValue] == nil {
            cfg.snapShortcuts[a.rawValue] = a.defaultCombo
        }
        return cfg
    }

    func color(_ kp: WritableKeyPath<FeatureConfig, RGBA>) -> Binding<Color> {
        Binding(get: { self.config[keyPath: kp].color },
                set: { self.config[keyPath: kp] = RGBA(color: $0) })
    }
}

// MARK: - Accessibility trust (ใช้ร่วมกันระหว่างขอบหน้าต่างกับการจัดหน้าต่าง)

@MainActor
final class AXTrust: ObservableObject {
    static let shared = AXTrust()
    @Published private(set) var isTrusted = AXIsProcessTrusted()
    private var timer: Timer?

    func refresh() { isTrusted = AXIsProcessTrusted() }

    /// ขอสิทธิ์ (แสดงหน้าต่างของระบบ) แล้วเฝ้าดูจนผู้ใช้อนุญาต
    func request() {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        isTrusted = AXIsProcessTrustedWithOptions(opts)
        watch()
    }

    func openSettings() {
        request()
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
    }

    func watch() {
        guard !isTrusted, timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] t in
            MainActor.assumeIsolated {
                guard let self else { t.invalidate(); return }
                if AXIsProcessTrusted() {
                    t.invalidate(); self.timer = nil
                    self.isTrusted = true
                }
            }
        }
    }
}

// MARK: - AX helpers

enum AXWin {
    static func attr<T>(_ el: AXUIElement, _ name: String) -> T? {
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success else { return nil }
        return v as? T
    }

    static func focusedWindow(pid: pid_t) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &v) == .success,
              let v, CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
        return (v as! AXUIElement)
    }

    /// กรอบหน้าต่างในพิกัด AX/CG (จุดเริ่มที่มุมซ้ายบนของจอหลัก)
    static func frame(_ w: AXUIElement) -> CGRect? {
        var pv: CFTypeRef?, sv: CFTypeRef?
        guard AXUIElementCopyAttributeValue(w, kAXPositionAttribute as CFString, &pv) == .success,
              AXUIElementCopyAttributeValue(w, kAXSizeAttribute as CFString, &sv) == .success,
              let pv, let sv else { return nil }
        var p = CGPoint.zero, s = CGSize.zero
        AXValueGetValue(pv as! AXValue, .cgPoint, &p)
        AXValueGetValue(sv as! AXValue, .cgSize, &s)
        return CGRect(origin: p, size: s)
    }

    static func setPosition(_ w: AXUIElement, _ p: CGPoint) {
        var p = p
        if let v = AXValueCreate(.cgPoint, &p) { AXUIElementSetAttributeValue(w, kAXPositionAttribute as CFString, v) }
    }

    static func setSize(_ w: AXUIElement, _ s: CGSize) {
        var s = s
        if let v = AXValueCreate(.cgSize, &s) { AXUIElementSetAttributeValue(w, kAXSizeAttribute as CFString, v) }
    }

    static func isFullScreen(_ w: AXUIElement) -> Bool { attr(w, "AXFullScreen") ?? false }
    static func isMinimized(_ w: AXUIElement) -> Bool { attr(w, kAXMinimizedAttribute) ?? false }
    static func isStandard(_ w: AXUIElement) -> Bool {
        (attr(w, kAXSubroleAttribute) as String?) == (kAXStandardWindowSubrole as String)
    }

    /// ความสูงของจอหลัก ใช้แปลงพิกัด AX (บนลงล่าง) ↔ Cocoa (ล่างขึ้นบน)
    @MainActor static var primaryHeight: CGFloat { NSScreen.screens.first?.frame.height ?? 0 }
    @MainActor static func toCocoa(_ r: CGRect) -> CGRect {
        CGRect(x: r.minX, y: primaryHeight - r.maxY, width: r.width, height: r.height)
    }
    @MainActor static func toAX(_ r: CGRect) -> CGRect { toCocoa(r) }   // การแปลงกลับเป็นสูตรเดียวกัน
}

// MARK: - Lifecycle: เรียกครั้งเดียวตอนเปิดแอป

@MainActor
enum Features {
    private static var cancellables = Set<AnyCancellable>()

    static func start() {
        guard cancellables.isEmpty else { return }
        let fs = FeatureStore.shared
        fs.$config.map(\.borderEnabled).removeDuplicates()
            .sink { WindowBorderManager.shared.setEnabled($0) }.store(in: &cancellables)
        fs.$config.map(\.snapEnabled).removeDuplicates()
            .sink { WindowSnapper.shared.setEnabled($0) }.store(in: &cancellables)
        fs.$config.map(\.snapShortcuts).removeDuplicates()
            .sink { _ in WindowSnapper.shared.reregister() }.store(in: &cancellables)
        fs.$config.map(\.hiderEnabled).removeDuplicates()
            .sink { MenuBarHider.shared.setEnabled($0) }.store(in: &cancellables)
        fs.$config.map(\.barEnabled).removeDuplicates()
            .sink { CustomMenuBar.shared.setEnabled($0) }.store(in: &cancellables)
    }
}
