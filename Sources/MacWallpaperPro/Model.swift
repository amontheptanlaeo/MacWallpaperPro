import AppKit
import Combine
import SwiftUI

// MARK: - Color

struct RGBA: Codable, Equatable {
    var r: Double, g: Double, b: Double, a: Double

    init(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }

    init(color: Color) {
        let ns = NSColor(color).usingColorSpace(.sRGB) ?? .white
        r = Double(ns.redComponent); g = Double(ns.greenComponent)
        b = Double(ns.blueComponent); a = Double(ns.alphaComponent)
    }

    var color: Color { Color(.sRGB, red: r, green: g, blue: b, opacity: a) }
    func opacity(_ o: Double) -> RGBA { RGBA(r, g, b, o) }
    var js: String { String(format: "[%.4f,%.4f,%.4f]", r, g, b) }
}

// MARK: - Enums

enum WallpaperMode: String, Codable, CaseIterable, Identifiable {
    case off, interactive, installed, preset, shader, video, web
    var id: String { rawValue }
    var label: String {
        switch self {
        case .off: "ปิด"
        case .interactive: "Nebula"
        case .installed: "จาก Community"
        case .preset: "สไตล์สำเร็จรูป"
        case .shader: "โค้ดของคุณ"
        case .video: "วิดีโอ"
        case .web: "เว็บไซต์"
        }
    }
}

enum WallpaperPreset: String, Codable, CaseIterable, Identifiable {
    case aurora, liquid, plasma, synthwave, starfield
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

enum ClockPosition: String, Codable, CaseIterable, Identifiable {
    case center, topLeft, topRight, bottomLeft, bottomRight
    var id: String { rawValue }
    var label: String {
        switch self {
        case .center: "กลางจอ"
        case .topLeft: "มุมซ้ายบน"
        case .topRight: "มุมขวาบน"
        case .bottomLeft: "มุมซ้ายล่าง"
        case .bottomRight: "มุมขวาล่าง"
        }
    }
    var alignment: Alignment {
        switch self {
        case .center: .center
        case .topLeft: .topLeading
        case .topRight: .topTrailing
        case .bottomLeft: .bottomLeading
        case .bottomRight: .bottomTrailing
        }
    }
}

// MARK: - Config

struct Config: Codable, Equatable {
    static let currentVersion = 2
    var configVersion = Config.currentVersion

    var fontFamily = ""

    // Wallpaper
    var wallpaperMode: WallpaperMode = .interactive
    var lastActiveMode: WallpaperMode = .interactive
    var installedID = ""
    var communityURL = "http://localhost:8787"
    var preset: WallpaperPreset = .aurora
    var color1 = RGBA(0.20, 0.95, 0.70)
    var color2 = RGBA(0.55, 0.25, 1.00)
    var color3 = RGBA(0.03, 0.02, 0.08)
    var speed = 1.0
    var renderScale = 1.0
    var customShader = Shaders.defaultCustom
    var videoPath = ""
    var webURL = "https://"
    var showClock = true
    var clockColor = RGBA(1, 1, 1, 0.92)
    var clockSize = 110.0
    var clockPosition: ClockPosition = .center

    // True Quit
    var trueQuitEnabled = false
    var trueQuitExclusions: [String] = ["com.apple.finder"]

    static let defaultColors = (RGBA(0.20, 0.95, 0.70), RGBA(0.55, 0.25, 1.00), RGBA(0.03, 0.02, 0.08))

    func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        fontFamily.isEmpty
            ? .system(size: size, weight: weight, design: .rounded)
            : .custom(fontFamily, size: size).weight(weight)
    }
}

// MARK: - Store

@MainActor
final class Store: ObservableObject {
    static let shared = Store()
    private static let key = "MacWallpaperPro.config"

    @Published var config: Config {
        didSet { if config != oldValue { save() } }
    }

    private init() { config = Store.load() }

    private func save() {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: Store.key)
        }
    }

    // รวมค่าที่บันทึกไว้ทับค่า default เพื่อให้เพิ่มฟิลด์ใหม่ได้โดยไม่ทำค่าเดิมหาย
    private static func load() -> Config {
        let def = Config()
        // ย้ายค่าจากชื่อเดิม (MyStyle) ครั้งแรก
        if UserDefaults.standard.data(forKey: key) == nil,
           let old = UserDefaults(suiteName: "com.mymac.mystyle")?.data(forKey: "MyStyle.config") {
            UserDefaults.standard.set(old, forKey: key)
        }
        guard let data = UserDefaults.standard.data(forKey: key),
              let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let defData = try? JSONEncoder().encode(def),
              var base = try? JSONSerialization.jsonObject(with: defData) as? [String: Any]
        else { return def }
        base.merge(saved) { _, new in new }
        // v2: เลิกใช้ Dock custom และเปลี่ยน wallpaper เริ่มต้นเป็น Interactive
        if (saved["configVersion"] as? Int ?? 1) < 2 {
            base["wallpaperMode"] = WallpaperMode.interactive.rawValue
            base["configVersion"] = Config.currentVersion
        }
        guard let merged = try? JSONSerialization.data(withJSONObject: base),
              let cfg = try? JSONDecoder().decode(Config.self, from: merged)
        else { return def }
        return cfg
    }

    func binding(_ kp: WritableKeyPath<Config, RGBA>) -> Binding<Color> {
        Binding(get: { self.config[keyPath: kp].color },
                set: { self.config[keyPath: kp] = RGBA(color: $0) })
    }
}

// MARK: - Shell

enum Shell {
    @discardableResult
    static func run(_ path: String, _ args: [String]) -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do { try p.run(); p.waitUntilExit() } catch { return -1 }
        return p.terminationStatus
    }
}
