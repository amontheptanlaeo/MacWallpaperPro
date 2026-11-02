import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// ไอคอนสี่เหลี่ยมมุมมนแบบ System Settings
struct IconTile: View {
    let symbol: String
    let tint: Color
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 22, height: 22)
            .background(tint.gradient, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .accessibilityHidden(true)
    }
}

func chooseFile(_ types: [UTType]) -> URL? {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = types
    panel.canChooseDirectories = false
    NSApp.activate()
    return panel.runModal() == .OK ? panel.url : nil
}

// MARK: - Built-in styles

struct StyleOption: Identifiable, Equatable {
    let id: String
    let name: String
    let detail: String
    let symbol: String
    let mode: WallpaperMode
    var preset: WallpaperPreset? = nil

    static let all: [StyleOption] = [
        StyleOption(id: "nebula", name: "Nebula", detail: "ตอบสนองต่อเมาส์", symbol: "cursorarrow.motionlines", mode: .interactive),
        StyleOption(id: "aurora", name: "Aurora", detail: "แสงเหนือ", symbol: "sparkles", mode: .preset, preset: .aurora),
        StyleOption(id: "liquid", name: "Liquid", detail: "ของเหลวไหลวน", symbol: "drop.fill", mode: .preset, preset: .liquid),
        StyleOption(id: "plasma", name: "Plasma", detail: "คลื่นสีนุ่มนวล", symbol: "waveform", mode: .preset, preset: .plasma),
        StyleOption(id: "synthwave", name: "Synthwave", detail: "นีออนยุค 80", symbol: "sun.horizon.fill", mode: .preset, preset: .synthwave),
        StyleOption(id: "starfield", name: "Starfield", detail: "ทะยานผ่านดวงดาว", symbol: "star.fill", mode: .preset, preset: .starfield),
        StyleOption(id: "video", name: "วิดีโอ", detail: "ไฟล์ของคุณ", symbol: "film.fill", mode: .video),
        StyleOption(id: "web", name: "เว็บไซต์", detail: "URL หรือไฟล์ HTML", symbol: "globe", mode: .web),
        StyleOption(id: "shader", name: "โค้ดของคุณ", detail: "GLSL shader", symbol: "chevron.left.forwardslash.chevron.right", mode: .shader),
    ]

    func isSelected(_ c: Config) -> Bool {
        let mode = c.wallpaperMode == .off ? c.lastActiveMode : c.wallpaperMode
        return mode == self.mode && (preset == nil || preset == c.preset)
    }

    var usesColors: Bool { [.interactive, .preset, .shader].contains(mode) }
}

struct ShaderEditorSection: View {
    @EnvironmentObject var store: Store
    @State private var draft = ""

    var body: some View {
        Section {
            TextEditor(text: $draft)
                .font(.system(size: 12, design: .monospaced))
                .frame(minHeight: 220)
                .scrollContentBackground(.hidden)
                .accessibilityLabel("โค้ด shader")
                .onAppear { draft = store.config.customShader }
            HStack {
                Button("คืนค่าตัวอย่าง") { draft = Shaders.defaultCustom; store.config.customShader = draft }
                Spacer()
                Button("ใช้โค้ดนี้") { store.config.customShader = draft }
                    .buttonStyle(.borderedProminent)
                    .disabled(draft == store.config.customShader)
                    .keyboardShortcut(.return, modifiers: .command)
            }
        } header: {
            Text("โค้ด GLSL")
        } footer: {
            Text("เขียนแบบเดียวกับ Shadertoy ตัวแปรที่ใช้ได้: u_time, u_res, u_c1, u_c2, u_c3 · ถ้าโค้ดผิด ข้อความแจ้งข้อผิดพลาดจะขึ้นที่มุมซ้ายล่างของภาพพื้นหลัง · กด ⌘↩ เพื่อใช้โค้ด")
        }
    }
}

// MARK: - Clock

struct ClockPage: View {
    @EnvironmentObject var store: Store
    private static let families = NSFontManager.shared.availableFontFamilies.sorted()

    var body: some View {
        let c = store.config
        Form {
            Section {
                Toggle(isOn: $store.config.showClock) {
                    Text("แสดงนาฬิกาบนเดสก์ท็อป")
                    Text("แสดงเวลาและวันที่บนภาพพื้นหลัง")
                }
            }

            Section("ตัวอย่าง") {
                ZStack {
                    LinearGradient(colors: [c.color3.color, c.color2.color.opacity(0.6)], startPoint: .top, endPoint: .bottom)
                    VStack(spacing: 2) {
                        Text(Date.now, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
                            .font(c.font(min(c.clockSize * 0.45, 64), .semibold))
                            .monospacedDigit()
                        Text(Date.now, format: .dateTime.weekday(.wide).day().month(.wide))
                            .font(c.font(13, .medium)).opacity(0.8)
                    }
                    .foregroundStyle(c.clockColor.color)
                }
                .frame(height: 150)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                .opacity(c.showClock ? 1 : 0.4)
            }

            Section("รูปแบบ") {
                Picker("แบบอักษร", selection: $store.config.fontFamily) {
                    Text("ค่าเริ่มต้นของระบบ").tag("")
                    Divider()
                    ForEach(Self.families, id: \.self) { Text($0).tag($0) }
                }
                ColorPicker("สีตัวอักษร", selection: store.binding(\.clockColor))
                LabeledContent("ขนาด") {
                    HStack {
                        Slider(value: $store.config.clockSize, in: 40...240)
                        Text("\(Int(c.clockSize)) pt").monospacedDigit().frame(width: 52, alignment: .trailing)
                    }
                }
                Picker("ตำแหน่ง", selection: $store.config.clockPosition) {
                    ForEach(ClockPosition.allCases) { Text($0.label).tag($0) }
                }
            }
            .disabled(!c.showClock)
        }
    }
}

// MARK: - Auto quit

struct AutoQuitPage: View {
    @EnvironmentObject var store: Store
    @ObservedObject private var tq = TrueQuit.shared

    var body: some View {
        Form {
            Section {
                Toggle(isOn: $store.config.trueQuitEnabled) {
                    Text("ออกจากแอปเมื่อปิดหน้าต่างสุดท้าย")
                    Text("ปกติ macOS จะเปิดแอปค้างไว้แม้ปิดหน้าต่างหมดแล้ว เปิดตัวเลือกนี้เพื่อให้แอปออกไปเลย ถ้ามีงานที่ยังไม่บันทึก แอปจะถามก่อนตามปกติ")
                }
                .disabled(!tq.isTrusted)
            } footer: {
                if !tq.isTrusted { Text("ต้องอนุญาตการเข้าถึงก่อนจึงจะเปิดใช้ได้") }
            }

            Section("สิทธิ์การเข้าถึง") {
                if tq.isTrusted {
                    Label("อนุญาตแล้ว", systemImage: "checkmark.shield.fill")
                        .foregroundStyle(.green)
                } else {
                    LabeledContent {
                        Button("เปิดการตั้งค่า…") {
                            tq.requestTrust()
                            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
                        }
                        .buttonStyle(.borderedProminent)
                    } label: {
                        Label {
                            Text("ยังไม่ได้อนุญาต")
                            Text("ไปที่ ความเป็นส่วนตัวและความปลอดภัย › การช่วยการเข้าถึง แล้วเปิดสวิตช์ของ MacWallpaperPro")
                        } icon: {
                            Image(systemName: "exclamationmark.shield.fill").foregroundStyle(.orange)
                        }
                    }
                }
            }

            if !tq.lastEvent.isEmpty {
                Section("ล่าสุด") { Text(tq.lastEvent).foregroundStyle(.secondary) }
            }

            Section {
                ForEach(exceptionCandidates, id: \.id) { item in
                    Toggle(isOn: exceptionBinding(item.id)) {
                        HStack(spacing: 8) {
                            if let icon = item.icon {
                                Image(nsImage: icon).resizable().frame(width: 20, height: 20)
                            }
                            Text(item.name)
                        }
                    }
                }
            } header: {
                Text("ไม่ต้องออกจากแอปเหล่านี้")
            } footer: {
                Text("แสดงแอปที่เปิดอยู่ตอนนี้และแอปที่เคยตั้งไว้")
            }
            .disabled(!store.config.trueQuitEnabled)
        }
    }

    private struct Candidate { let id: String; let name: String; let icon: NSImage? }

    private var exceptionCandidates: [Candidate] {
        let running = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular && $0.bundleIdentifier != Bundle.main.bundleIdentifier }
        var seen = Set<String>()
        var result: [Candidate] = []
        for app in running {
            guard let id = app.bundleIdentifier, seen.insert(id).inserted else { continue }
            result.append(Candidate(id: id, name: app.localizedName ?? id, icon: app.icon))
        }
        for id in store.config.trueQuitExclusions where seen.insert(id).inserted {
            let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id)
            result.append(Candidate(id: id,
                                    name: url.map { FileManager.default.displayName(atPath: $0.path) } ?? id,
                                    icon: url.map { NSWorkspace.shared.icon(forFile: $0.path) }))
        }
        return result.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    private func exceptionBinding(_ id: String) -> Binding<Bool> {
        Binding(get: { store.config.trueQuitExclusions.contains(id) },
                set: { on in
                    store.config.trueQuitExclusions.removeAll { $0 == id }
                    if on { store.config.trueQuitExclusions.append(id) }
                })
    }
}

// MARK: - Lock screen

struct LockScreenPage: View {
    enum Status: Equatable { case idle, working, done(String), failed(String) }
    @State private var status: Status = .idle

    var body: some View {
        Form {
            Section {
                LabeledContent {
                    Button {
                        status = .working
                        Task {
                            let r = await WallpaperManager.shared.applySnapshotAsSystemWallpaper()
                            status = r.success ? .done(r.path ?? "") : .failed(r.message)
                        }
                    } label: {
                        if status == .working {
                            ProgressView().controlSize(.small).frame(width: 60)
                        } else {
                            Text("ตั้งเป็นภาพหน้าจอล็อก")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(status == .working)
                } label: {
                    Text("ใช้ภาพพื้นหลังตอนนี้")
                    Text("บันทึกเฟรมปัจจุบันเป็นภาพนิ่ง แล้วตั้งเป็นภาพของหน้าจอล็อกและภาพพื้นหลังของระบบ")
                }

                switch status {
                case .done(let path):
                    LabeledContent {
                        Button("แสดงไฟล์") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) }
                    } label: {
                        Label("ตั้งภาพเรียบร้อย", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    }
                case .failed(let msg):
                    Label(msg, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                default:
                    EmptyView()
                }
            } header: {
                Text("ภาพหน้าจอล็อก")
            } footer: {
                Text("macOS ไม่อนุญาตให้แอปอื่นแก้หน้าตาของหน้าจอล็อก จึงตั้งได้เฉพาะภาพ (ภาพจะไม่เคลื่อนไหว)")
            }

            Section {
                LabeledContent {
                    Button("ล็อกหน้าจอ") { Shell.run("/usr/bin/pmset", ["displaysleepnow"]) }
                } label: {
                    Text("ล็อกหน้าจอทันที")
                    Text("ปิดจอและล็อกเครื่อง (ถ้าตั้งให้ขอรหัสผ่านทันทีไว้ใน การตั้งค่าระบบ › หน้าจอล็อก)")
                }
            }
        }
    }
}

// MARK: - About

struct AboutPage: View {
    private enum Level { case full, partial, none }
    private let items: [(Level, String, String)] = [
        (.full, "ภาพพื้นหลังเคลื่อนไหว", "shader, วิดีโอ, หน้าเว็บ และตอบสนองต่อเมาส์"),
        (.full, "นาฬิกาบนเดสก์ท็อป", "เลือกแบบอักษร สี ขนาด และตำแหน่งได้"),
        (.full, "Community", "โหลด wallpaper ฟรีและเสียเงิน ตรวจลายเซ็นทุกไฟล์ และทำงานแบบออฟไลน์"),
        (.full, "ขอบหน้าต่าง", "กรอบสีเรืองแสงรอบหน้าต่างที่กำลังใช้"),
        (.full, "จัดหน้าต่าง", "ชิดซ้าย/ขวา แบ่ง 4 ส่วน เต็มจอ ด้วยคีย์ลัด"),
        (.full, "แถบเมนู", "ซ่อนไอคอนรกๆ และแถบเมนูแบบกำหนดเอง"),
        (.full, "ออกจากแอปอัตโนมัติ", "ออกจากแอปเมื่อปิดหน้าต่างสุดท้าย"),
        (.partial, "หน้าจอล็อก", "เปลี่ยนภาพได้ แต่แก้หน้าตาและการจัดวางไม่ได้"),
        (.none, "แบบอักษรและสีของทุกแอป", "ต้องปิดระบบป้องกันของ macOS (SIP) ซึ่งเสี่ยงต่อความปลอดภัย"),
    ]

    var body: some View {
        Form {
            Section {
                HStack(spacing: 14) {
                    IconTile(symbol: "paintpalette.fill", tint: .indigo).scaleEffect(2).frame(width: 48, height: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("MacWallpaperPro").font(.title2.bold())
                        Text("เวอร์ชัน \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev")")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 6)
            }
            Section {
                LabeledContent("ผู้สร้าง", value: "Amonthep tanlaeo")
                LabeledContent("สัญญาอนุญาต") {
                    Link("GPL-3.0 (open source)", destination: URL(string: "https://www.gnu.org/licenses/gpl-3.0.html")!)
                }
            } footer: {
                Text("ใช้ แก้ไข และแจกต่อได้ฟรีตามเงื่อนไข GPL-3.0 ชื่อ MacWallpaperPro และโลโก้สงวนสิทธิ์ไว้")
            }
            Section("สิ่งที่ทำได้") {
                ForEach(items, id: \.1) { item in
                    Label {
                        Text(item.1)
                        Text(item.2)
                    } icon: {
                        switch item.0 {
                        case .full: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        case .partial: Image(systemName: "minus.circle.fill").foregroundStyle(.orange)
                        case .none: Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }
}
