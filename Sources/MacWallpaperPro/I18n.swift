import Foundation
import Observation
import SwiftUI

// MARK: - Languages

struct AppLanguage: Identifiable, Hashable {
    let code: String       // ชื่อไฟล์ใน Localization/<code>.json
    let name: String       // ชื่อภาษาในภาษานั้นเอง
    let flag: String
    var rtl = false
    var id: String { code }

    static let english = AppLanguage(code: "en", name: "English", flag: "🇺🇸")

    static let all: [AppLanguage] = [
        english,
        AppLanguage(code: "th", name: "ไทย", flag: "🇹🇭"),
        AppLanguage(code: "zh-Hans", name: "简体中文", flag: "🇨🇳"),
        AppLanguage(code: "zh-Hant", name: "繁體中文", flag: "🇹🇼"),
        AppLanguage(code: "ja", name: "日本語", flag: "🇯🇵"),
        AppLanguage(code: "ko", name: "한국어", flag: "🇰🇷"),
        AppLanguage(code: "es", name: "Español", flag: "🇪🇸"),
        AppLanguage(code: "fr", name: "Français", flag: "🇫🇷"),
        AppLanguage(code: "de", name: "Deutsch", flag: "🇩🇪"),
        AppLanguage(code: "it", name: "Italiano", flag: "🇮🇹"),
        AppLanguage(code: "pt-BR", name: "Português (Brasil)", flag: "🇧🇷"),
        AppLanguage(code: "ru", name: "Русский", flag: "🇷🇺"),
        AppLanguage(code: "tr", name: "Türkçe", flag: "🇹🇷"),
        AppLanguage(code: "id", name: "Bahasa Indonesia", flag: "🇮🇩"),
        AppLanguage(code: "vi", name: "Tiếng Việt", flag: "🇻🇳"),
        AppLanguage(code: "hi", name: "हिन्दी", flag: "🇮🇳"),
        AppLanguage(code: "ar", name: "العربية", flag: "🇸🇦", rtl: true),
    ]

    /// เลือกภาษาที่ตรงกับภาษาของเครื่องมากที่สุด
    static func matchingSystem() -> AppLanguage {
        for pref in Locale.preferredLanguages {
            let p = pref.lowercased()
            if p.hasPrefix("zh") {
                return all.first { $0.code == (p.contains("hant") || p.contains("tw") || p.contains("hk") ? "zh-Hant" : "zh-Hans") }!
            }
            if p.hasPrefix("pt") { return all.first { $0.code == "pt-BR" }! }
            if let l = all.first(where: { p.hasPrefix($0.code.lowercased()) }) { return l }
        }
        return english
    }
}

// MARK: - Localizer

/// แปลข้อความด้วยตารางจาก Localization/<code>.json (key = ข้อความภาษาอังกฤษ)
/// ไม่มีคำแปล → ใช้ภาษาอังกฤษ
///
/// ใช้ Observation: view ไหนเรียก tr() ระหว่างวาด SwiftUI จะจำไว้ แล้ววาดใหม่เองเมื่อเปลี่ยนภาษา
/// (ห้ามสร้าง view ใหม่ทั้งต้นด้วย .id — macOS พังตอนถอด sidebar ของ NavigationSplitView)
@Observable
final class Localizer: @unchecked Sendable {
    static let shared = Localizer()
    @ObservationIgnored private static let key = "MacWallpaperPro.language"

    private(set) var language: AppLanguage
    /// เพิ่มทุกครั้งที่เปลี่ยนภาษา — lookup อ่านค่านี้เพื่อให้ถูกติดตาม
    private var revision = 0
    @ObservationIgnored private let lock = NSLock()
    @ObservationIgnored private var table: [String: String] = [:]

    var locale: Locale { Locale(identifier: language.code) }

    private init() {
        let saved = UserDefaults.standard.string(forKey: Self.key)
        language = AppLanguage.all.first { $0.code == saved } ?? AppLanguage.matchingSystem()
        table = Self.load(language.code)
    }

    func set(_ lang: AppLanguage) {
        UserDefaults.standard.set(lang.code, forKey: Self.key)
        let t = Self.load(lang.code)
        lock.lock(); table = t; lock.unlock()
        language = lang
        revision += 1
    }

    func lookup(_ key: String) -> String {
        _ = revision
        lock.lock(); defer { lock.unlock() }
        return table[key] ?? key
    }

    private static func load(_ code: String) -> [String: String] {
        guard code != "en" else { return [:] }
        let url = Bundle.main.url(forResource: code, withExtension: "json", subdirectory: "Localization")
            ?? URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent().appendingPathComponent("Localization/\(code).json")
        guard let data = try? Data(contentsOf: url),
              let dict = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return dict.filter { !$0.value.isEmpty }
    }
}

/// ข้อความที่แปลแล้ว — เขียน key เป็นภาษาอังกฤษเสมอ
func tr(_ key: String) -> String { Localizer.shared.lookup(key) }

/// ข้อความที่มีค่าแทรก เช่น tr("By %@", name) — ใช้ %@ สำหรับ String, %d สำหรับ Int
func tr(_ key: String, _ args: CVarArg...) -> String {
    String(format: Localizer.shared.lookup(key), locale: Localizer.shared.locale, arguments: args)
}

// MARK: - SwiftUI

extension View {
    /// ใส่ที่ root ของทุกหน้าต่าง: locale สำหรับวันที่/ตัวเลข, ทิศทางขวาไปซ้าย และ redraw เมื่อเปลี่ยนภาษา
    func localized() -> some View { modifier(LocalizedRoot()) }
}

private struct LocalizedRoot: ViewModifier {
    private var loc: Localizer { Localizer.shared }
    func body(content: Content) -> some View {
        content
            .environment(\.locale, loc.locale)
            .environment(\.layoutDirection, loc.language.rtl ? .rightToLeft : .leftToRight)
    }
}

/// ปุ่มเลือกภาษาพร้อมธง (ธงเป็นอีโมจิที่อนุญาตที่เดียวในแอป)
struct LanguagePicker: View {
    private var loc: Localizer { Localizer.shared }

    var body: some View {
        Menu {
            ForEach(AppLanguage.all) { lang in
                Button {
                    loc.set(lang)
                } label: {
                    if lang == loc.language {
                        Label("\(lang.flag)  \(lang.name)", systemImage: "checkmark")
                    } else {
                        Text("\(lang.flag)  \(lang.name)")
                    }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(verbatim: "\(loc.language.flag)  \(loc.language.name)")
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .menuStyle(.button)
        .menuIndicator(.hidden)
        .buttonStyle(SecondaryButtonStyle())
        .fixedSize()
        .help(tr("Language"))
        .accessibilityLabel(tr("Language"))
        .accessibilityValue(loc.language.name)
    }
}
