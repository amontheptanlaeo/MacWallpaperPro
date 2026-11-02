import AppKit
import Carbon.HIToolbox
import SwiftUI

// MARK: - Shared rows

/// แถวสไลเดอร์พร้อมคำอธิบายและค่าปัจจุบัน
struct FeatureSlider: View {
    let title: String
    var subtitle: String? = nil
    @Binding var value: Double
    let range: ClosedRange<Double>
    var step: Double? = nil   // nil = ลากต่อเนื่อง ไม่มีขีด
    var unit = "pt"

    var body: some View {
        LabeledContent {
            HStack {
                Group {
                    if let step { Slider(value: $value, in: range, step: step) } else { Slider(value: $value, in: range) }
                }
                .frame(minWidth: 140)
                    .accessibilityLabel(title)
                Text(unit == "%" ? "\(Int((value * 100).rounded()))%" : "\(Int(value.rounded())) \(unit)")
                    .monospacedDigit().foregroundStyle(.secondary)
                    .frame(width: 56, alignment: .trailing)
            }
        } label: {
            Text(title)
            if let subtitle { Text(subtitle) }
        }
    }
}

/// สถานะสิทธิ์การช่วยการเข้าถึง แบบเดียวกับหน้า ออกจากแอปอัตโนมัติ
struct AXPermissionSection: View {
    @ObservedObject private var trust = AXTrust.shared

    var body: some View {
        Section("สิทธิ์การเข้าถึง") {
            if trust.isTrusted {
                Label("อนุญาตแล้ว", systemImage: "checkmark.shield.fill")
                    .foregroundStyle(.green)
            } else {
                LabeledContent {
                    Button("เปิดการตั้งค่า…") { trust.openSettings() }
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
        .onAppear { trust.refresh(); trust.watch() }
    }
}

// MARK: - Borders

struct BordersPage: View {
    @ObservedObject private var fs = FeatureStore.shared
    @ObservedObject private var trust = AXTrust.shared

    var body: some View {
        let c = fs.config
        Form {
            Section {
                Toggle(isOn: $fs.config.borderEnabled) {
                    Text("แสดงขอบรอบหน้าต่างที่ใช้งานอยู่")
                    Text("วาดเส้นขอบเรืองแสงรอบหน้าต่างที่กำลังโฟกัส ช่วยให้เห็นชัดว่ากำลังพิมพ์อยู่ในหน้าต่างไหน ขอบจะซ่อนเองเมื่อหน้าต่างเต็มจอ")
                }
                .disabled(!trust.isTrusted && !c.borderEnabled)
            } footer: {
                if !trust.isTrusted { Text("ต้องอนุญาตการเข้าถึงก่อนจึงจะติดตามหน้าต่างของแอปอื่นได้") }
            }

            AXPermissionSection()

            Section("ตัวอย่าง") {
                BorderPreview(cfg: c)
                    .frame(height: 150)
                    .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                    .opacity(c.borderEnabled ? 1 : 0.45)
            }

            Section("รูปแบบ") {
                ColorPicker(selection: fs.color(\.borderColor), supportsOpacity: true) {
                    Text("สีขอบ")
                    Text("สีหลักของเส้นขอบและแสงเรือง")
                }
                Toggle(isOn: $fs.config.borderUseGradient) {
                    Text("ไล่สี")
                    Text("ไล่จากสีขอบไปยังสีที่สองตามแนวทแยง")
                }
                if c.borderUseGradient {
                    ColorPicker(selection: fs.color(\.borderColor2), supportsOpacity: true) {
                        Text("สีที่สอง")
                        Text("สีปลายทางของการไล่สี")
                    }
                }
                FeatureSlider(title: "ความหนา", subtitle: "ความกว้างของเส้นขอบ", value: $fs.config.borderWidth, range: 1...12)
                FeatureSlider(title: "ความโค้งของมุม", subtitle: "ตั้งให้ใกล้กับมุมหน้าต่างของ macOS (ประมาณ 10–16)", value: $fs.config.borderRadius, range: 0...28)
                FeatureSlider(title: "แสงเรือง", subtitle: "ตั้งเป็น 0 เพื่อให้เป็นเส้นเรียบ ๆ", value: $fs.config.borderGlow, range: 0...30)
            }
            .disabled(!c.borderEnabled)

            Section {
                Toggle(isOn: $fs.config.borderShowInactive) {
                    Text("แสดงขอบบนหน้าต่างอื่นด้วย")
                    Text("วาดเส้นบาง ๆ ไม่เรืองแสงรอบหน้าต่างที่ไม่ได้ใช้งาน")
                }
                if c.borderShowInactive {
                    ColorPicker(selection: fs.color(\.borderInactiveColor), supportsOpacity: true) {
                        Text("สีขอบหน้าต่างอื่น")
                        Text("แนะนำสีอ่อนและโปร่งแสง จะได้ไม่แย่งความสนใจ")
                    }
                }
            } header: {
                Text("หน้าต่างอื่น")
            } footer: {
                Text("ต้องอ่านรายการหน้าต่างทุกวินาที จึงใช้พลังงานมากขึ้นเล็กน้อย")
            }
            .disabled(!c.borderEnabled)
        }
    }
}

private struct BorderPreview: View {
    let cfg: FeatureConfig

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cfg.borderRadius + cfg.borderWidth / 2, style: .continuous)
        let stroke: AnyShapeStyle = cfg.borderUseGradient
            ? AnyShapeStyle(LinearGradient(colors: [cfg.borderColor.color, cfg.borderColor2.color],
                                           startPoint: .topLeading, endPoint: .bottomTrailing))
            : AnyShapeStyle(cfg.borderColor.color)
        ZStack {
            LinearGradient(colors: [Color(white: 0.22), Color(white: 0.1)], startPoint: .top, endPoint: .bottom)
            RoundedRectangle(cornerRadius: cfg.borderRadius, style: .continuous)
                .fill(.background)
                .overlay(alignment: .topLeading) {
                    HStack(spacing: 6) {
                        Circle().fill(.red).frame(width: 10)
                        Circle().fill(.yellow).frame(width: 10)
                        Circle().fill(.green).frame(width: 10)
                    }
                    .padding(10)
                }
                .padding(cfg.borderWidth)
                .overlay {
                    shape.strokeBorder(stroke, lineWidth: cfg.borderWidth)
                        .shadow(color: cfg.borderColor.color.opacity(cfg.borderGlow > 0 ? 0.9 : 0), radius: cfg.borderGlow / 2)
                }
                .frame(width: 240, height: 110)
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityHidden(true)
    }
}

// MARK: - Snapping

struct SnappingPage: View {
    @ObservedObject private var fs = FeatureStore.shared
    @ObservedObject private var snapper = WindowSnapper.shared
    @ObservedObject private var trust = AXTrust.shared

    var body: some View {
        let c = fs.config
        Form {
            Section {
                Toggle(isOn: $fs.config.snapEnabled) {
                    Text("จัดหน้าต่างด้วยคีย์ลัด")
                    Text("ย้ายและปรับขนาดหน้าต่างที่ใช้งานอยู่ให้เต็มครึ่งจอ มุมจอ หรือเต็มพื้นที่ โดยไม่ทับแถบเมนูและ Dock")
                }
            } footer: {
                if !trust.isTrusted { Text("คีย์ลัดทำงานได้เลย แต่ต้องอนุญาตการเข้าถึงก่อนจึงจะย้ายหน้าต่างของแอปอื่นได้") }
            }

            AXPermissionSection()

            Section {
                FeatureSlider(title: "ระยะห่าง", subtitle: "ช่องว่างรอบหน้าต่างและระหว่างหน้าต่างที่วางชิดกัน",
                              value: $fs.config.snapGap, range: 0...32)
            }
            .disabled(!c.snapEnabled)

            Section {
                ForEach(SnapAction.allCases) { a in
                    LabeledContent {
                        HStack(spacing: 8) {
                            if snapper.failed.contains(a) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.orange)
                                    .help("คีย์ลัดนี้ถูกแอปอื่นใช้อยู่ ลองเปลี่ยนเป็นคีย์อื่น")
                            }
                            ShortcutRecorder(action: a)
                        }
                    } label: {
                        Label(a.label, systemImage: a.symbol)
                    }
                }
            } header: {
                Text("คีย์ลัด")
            } footer: {
                HStack(alignment: .top) {
                    Text("คลิกที่คีย์ลัดแล้วกดคีย์ใหม่พร้อม ⌃ ⌥ หรือ ⌘ · กด esc เพื่อยกเลิก · กด ⌫ เพื่อปิดคีย์ลัดนั้น")
                    Spacer()
                    Button("คืนค่าเริ่มต้น") { fs.config.snapShortcuts = SnapAction.defaultShortcuts }
                        .controlSize(.small)
                }
            }
            .disabled(!c.snapEnabled)
        }
        .onDisappear { ShortcutRecording.shared.stop() }
    }
}

/// สถานะการบันทึกคีย์ลัด (บันทึกได้ทีละช่อง)
@MainActor
final class ShortcutRecording: ObservableObject {
    static let shared = ShortcutRecording()
    @Published private(set) var action: SnapAction?
    private var monitor: Any?

    func start(_ a: SnapAction) {
        stop()
        action = a
        WindowSnapper.shared.suspend(true)
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
            MainActor.assumeIsolated { ShortcutRecording.shared.handle(e) } ? nil : e
        }
    }

    func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        if action != nil { WindowSnapper.shared.suspend(false) }
        action = nil
    }

    /// คืนค่า true เมื่อกินอีเวนต์นี้ไปแล้ว
    private func handle(_ e: NSEvent) -> Bool {
        guard let a = action else { return false }
        let plain = e.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty
        if Int(e.keyCode) == kVK_Escape && plain { stop(); return true }
        let fs = FeatureStore.shared
        if (Int(e.keyCode) == kVK_Delete || Int(e.keyCode) == kVK_ForwardDelete) && plain {
            fs.config.snapShortcuts[a.rawValue] = HotKeyCombo.none
            stop(); return true
        }
        guard let combo = HotKeyCombo(event: e) else { NSSound.beep(); return true }
        // ถ้าซ้ำกับ action อื่น ย้ายมาใช้ที่นี่แทน
        var map = fs.config.snapShortcuts
        for (k, v) in map where v == combo { map[k] = HotKeyCombo.none }
        map[a.rawValue] = combo
        fs.config.snapShortcuts = map
        stop()
        return true
    }
}

private struct ShortcutRecorder: View {
    let action: SnapAction
    @ObservedObject private var fs = FeatureStore.shared
    @ObservedObject private var rec = ShortcutRecording.shared

    var body: some View {
        let recording = rec.action == action
        let combo = fs.config.snapShortcuts[action.rawValue].flatMap { $0.isNone ? nil : $0 }
        Button {
            recording ? rec.stop() : rec.start(action)
        } label: {
            Text(recording ? "กดคีย์ลัด…" : combo?.display ?? "ไม่มี")
                .font(.system(.body, design: .rounded).weight(.medium))
                .monospacedDigit()
                .foregroundStyle(recording ? Color.accentColor : combo == nil ? .secondary : .primary)
                .frame(minWidth: 84)
        }
        .buttonStyle(.bordered)
        .accessibilityLabel("คีย์ลัดสำหรับ\(action.label)")
        .accessibilityValue(recording ? "กำลังรอคีย์ใหม่" : combo?.display ?? "ไม่มี")
    }
}

// MARK: - Menu bar icon hiding

struct MenuBarPage: View {
    @ObservedObject private var fs = FeatureStore.shared
    @ObservedObject private var hider = MenuBarHider.shared

    var body: some View {
        let c = fs.config
        Form {
            Section {
                Toggle(isOn: $fs.config.hiderEnabled) {
                    Text("ซ่อนไอคอนบนแถบเมนู")
                    Text("เพิ่มปุ่มลูกศรบนแถบเมนู คลิกเพื่อซ่อนหรือแสดงไอคอนที่ไม่ได้ใช้บ่อย แถบเมนูจะดูโล่งขึ้น")
                }
            }

            Section {
                Toggle(isOn: $fs.config.hiderAutoRehide) {
                    Text("ซ่อนกลับอัตโนมัติ")
                    Text("หลังคลิกแสดงไอคอน จะซ่อนกลับเองเมื่อครบเวลาที่ตั้งไว้")
                }
                FeatureSlider(title: "ซ่อนกลับหลังจาก", subtitle: "นับจากตอนที่คลิกแสดงไอคอน",
                              value: $fs.config.hiderDelay, range: 3...60, unit: "วินาที")
                    .disabled(!c.hiderAutoRehide)
                LabeledContent {
                    Button(hider.isHidden ? "แสดงไอคอน" : "ซ่อนไอคอน") { hider.setHidden(!hider.isHidden) }
                } label: {
                    Text("สถานะตอนนี้")
                    Text(hider.isHidden ? "ไอคอนทางซ้ายของเส้นคั่นซ่อนอยู่" : "แสดงไอคอนทั้งหมด")
                }
                if hider.misordered {
                    Label("เส้นคั่นอยู่ทางขวาของปุ่มลูกศร จึงซ่อนไม่ได้ กด ⌘ ค้างแล้วลากเส้นคั่นไปไว้ทางซ้ายของปุ่มลูกศร",
                          systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
            } header: {
                Text("การทำงาน")
            }
            .disabled(!c.hiderEnabled)

            Section {
                step(1, "คลิกปุ่มลูกศรบนแถบเมนูเพื่อแสดงเส้นคั่น")
                step(2, "กด ⌘ ค้างไว้ แล้วลากไอคอนที่อยากซ่อนไปไว้ทางซ้ายของเส้นคั่น")
                step(3, "คลิกปุ่มลูกศรอีกครั้ง ไอคอนทางซ้ายของเส้นคั่นจะหายไป ส่วนทางขวายังแสดงตามปกติ")
                step(4, "คลิกขวาที่ปุ่มลูกศรเพื่อเปิดเมนูของฟีเจอร์นี้")
            } header: {
                Text("วิธีเลือกไอคอนที่จะซ่อน")
            } footer: {
                Text("macOS ไม่เปิดให้แอปจัดเรียงไอคอนของแอปอื่น จึงต้องลากเอง ไอคอนบางตัวของระบบ เช่น ศูนย์ควบคุม และนาฬิกา ย้ายไม่ได้ บน Mac ที่มีรอยบากของจอ ไอคอนที่ล้นอาจถูกรอยบากบังอยู่แล้ว")
            }
        }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        Label {
            Text(text)
        } icon: {
            Text("\(n)").font(.caption.bold()).foregroundStyle(.white)
                .frame(width: 20, height: 20)
                .background(Color.accentColor, in: Circle())
        }
    }
}

// MARK: - Custom menu bar

struct CustomBarPage: View {
    @ObservedObject private var fs = FeatureStore.shared
    @ObservedObject private var bar = CustomMenuBar.shared
    @State private var systemHide = CustomMenuBar.systemAutoHide
    private static let families = NSFontManager.shared.availableFontFamilies.sorted()

    var body: some View {
        let c = fs.config
        Form {
            Section {
                Toggle(isOn: $fs.config.barEnabled) {
                    Text("แสดงแถบเมนูแบบกำหนดเอง")
                    Text("แถบด้านบนจอที่แสดงชื่อแอป เวลา แบตเตอรี่ CPU หน่วยความจำ และเครือข่าย ปรับสีและรูปทรงได้")
                }
            } footer: {
                Text("เหมาะกับการใช้คู่กับการซ่อนแถบเมนูของ macOS แถบนี้คลิกทะลุได้ จึงไม่บังการคลิกหน้าต่างด้านล่าง")
            }

            Section {
                if bar.systemBarVisible {
                    Label {
                        Text("แถบเมนูของ macOS ยังแสดงอยู่")
                        Text("แถบนี้จะวางไว้ใต้แถบเมนูของระบบเพื่อไม่ให้ทับกัน แต่จะกินพื้นที่สองแถว แนะนำให้ซ่อนแถบเมนูของระบบ")
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    }
                } else {
                    Label("แถบเมนูของ macOS ซ่อนอยู่ เลื่อนเมาส์ไปขอบบนเพื่อเรียกแถบเมนูของระบบได้ตามปกติ",
                          systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
                Toggle(isOn: Binding(get: { systemHide }, set: { on in
                    systemHide = on
                    CustomMenuBar.setSystemAutoHide(on)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { bar.refreshSystemBarState() }
                })) {
                    Text("ซ่อนแถบเมนูของ macOS อัตโนมัติ")
                    Text("เหมือนตัวเลือก \"ซ่อนและแสดงแถบเมนูโดยอัตโนมัติ: ทุกครั้ง\" ในการตั้งค่าระบบ เปลี่ยนแล้วมีผลทันที")
                }
                LabeledContent {
                    Button("เปิดการตั้งค่าระบบ…") { CustomMenuBar.openSystemMenuBarSettings() }
                } label: {
                    Text("ตั้งค่าเองในการตั้งค่าระบบ")
                    Text("ถ้าสวิตช์ด้านบนไม่มีผล ให้ไปที่ การตั้งค่าระบบ › แถบเมนู แล้วเลือกซ่อนแถบเมนูอัตโนมัติ")
                }
            } header: {
                Text("แถบเมนูของระบบ")
            }

            Section("ตัวอย่าง") {
                ZStack(alignment: .top) {
                    LinearGradient(colors: [.indigo.opacity(0.8), .purple.opacity(0.5), .black], startPoint: .top, endPoint: .bottom)
                    CustomBarView()
                        .frame(height: c.barHeight)
                        .padding(c.barMargin)
                }
                .frame(height: 110)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                .opacity(c.barEnabled ? 1 : 0.6)
            }

            Section("วิดเจ็ต") {
                widget(\.barShowApp, "แอปที่ใช้งานอยู่", "ไอคอนและชื่อของแอปที่อยู่หน้าสุด")
                widget(\.barShowClock, "เวลา", "ชั่วโมงและนาที")
                widget(\.barShowDate, "วันที่", "วันในสัปดาห์ วันที่ และเดือน")
                widget(\.barShowBattery, "แบตเตอรี่", "เปอร์เซ็นต์และสถานะการชาร์จ (ไม่แสดงบน Mac ที่ไม่มีแบตเตอรี่)")
                widget(\.barShowCPU, "CPU", "การใช้งานโปรเซสเซอร์รวมทุกคอร์")
                widget(\.barShowMemory, "หน่วยความจำ", "คิดแบบเดียวกับ \"หน่วยความจำที่ใช้\" ใน Activity Monitor")
                widget(\.barShowNetwork, "เครือข่าย", "ประเภทการเชื่อมต่อและความเร็วดาวน์โหลด")
            }
            .disabled(!c.barEnabled)

            Section {
                ColorPicker(selection: fs.color(\.barColor), supportsOpacity: false) {
                    Text("สีพื้นหลัง")
                    Text("สีของตัวแถบ")
                }
                FeatureSlider(title: "ความทึบ", subtitle: "ค่าน้อยจะเห็นภาพพื้นหลังทะลุมากขึ้น",
                              value: $fs.config.barOpacity, range: 0...1, unit: "%")
                Toggle(isOn: $fs.config.barBlur) {
                    Text("เบลอด้านหลัง")
                    Text("ทำให้แถบดูเป็นกระจกฝ้าแบบแถบเมนูของ macOS")
                }
                ColorPicker(selection: fs.color(\.barTextColor), supportsOpacity: true) {
                    Text("สีตัวอักษร")
                    Text("สีของข้อความและไอคอนในแถบ")
                }
                Picker(selection: $fs.config.barFontFamily) {
                    Text("ค่าเริ่มต้นของระบบ").tag("")
                    Divider()
                    ForEach(Self.families, id: \.self) { Text($0).tag($0) }
                } label: {
                    Text("แบบอักษร")
                    Text("ใช้กับข้อความทั้งหมดในแถบ")
                }
                FeatureSlider(title: "ขนาดตัวอักษร", value: $fs.config.barFontSize, range: 10...16)
            } header: {
                Text("สีและตัวอักษร")
            }
            .disabled(!c.barEnabled)

            Section {
                FeatureSlider(title: "ความสูง", subtitle: "แถบเมนูของ macOS สูงประมาณ 24–37 pt",
                              value: $fs.config.barHeight, range: 22...44)
                FeatureSlider(title: "ความโค้งของมุม", subtitle: "ตั้งเป็น 0 เพื่อให้เป็นแถบเหลี่ยม",
                              value: $fs.config.barRadius, range: 0...22)
                FeatureSlider(title: "ระยะห่างจากขอบจอ", subtitle: "มากกว่า 0 จะเป็นแถบลอย ตั้งเป็น 0 เพื่อให้ชิดขอบจอเต็มความกว้าง",
                              value: $fs.config.barMargin, range: 0...16)
                Toggle(isOn: $fs.config.barAllScreens) {
                    Text("แสดงทุกจอ")
                    Text("ปิดไว้จะแสดงเฉพาะจอหลัก")
                }
            } header: {
                Text("รูปทรง")
            } footer: {
                Text("การจัดหน้าต่างด้วยคีย์ลัดจะเว้นที่ให้แถบนี้อัตโนมัติ แต่หน้าต่างที่ขยายเต็มด้วยวิธีอื่นอาจซ้อนใต้แถบได้ ยังไม่รองรับเพลงที่กำลังเล่น เพราะ macOS ไม่มี API สาธารณะสำหรับข้อมูลนี้")
            }
            .disabled(!c.barEnabled)
        }
        .onAppear {
            systemHide = CustomMenuBar.systemAutoHide
            bar.refreshSystemBarState()
            BarStats.shared.start()   // ให้ตัวอย่างมีข้อมูลจริง
        }
        .onDisappear {
            if !bar.isRunning { BarStats.shared.stop() }
        }
    }

    private func widget(_ kp: WritableKeyPath<FeatureConfig, Bool>, _ title: String, _ subtitle: String) -> some View {
        Toggle(isOn: Binding(get: { fs.config[keyPath: kp] }, set: { fs.config[keyPath: kp] = $0 })) {
            Text(title)
            Text(subtitle)
        }
    }
}
