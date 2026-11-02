import AppKit
import SwiftUI

// ระบบดีไซน์ของแอป (ดู design-system/MASTER.md) — ห้ามใช้สี/ระยะแบบ hard-code ใน view อื่น

// MARK: - Tokens

enum Theme {
    static let background = Color(hex: 0x0E0E12)
    static let rail = Color(hex: 0x121217)
    static let surface = Color(hex: 0x17171D)
    static let surfaceRaised = Color(hex: 0x1F1F27)
    static let surfaceHover = Color(hex: 0x272731)
    static let border = Color.white.opacity(0.08)
    static let borderStrong = Color.white.opacity(0.16)
    static let textPrimary = Color(hex: 0xF5F5F7)
    static let textSecondary = Color(hex: 0xA1A1AA)
    static let accentStart = Color(hex: 0x7C3AED)
    static let accentEnd = Color(hex: 0xEC4899)
    /// สีเน้นแบบสีเดียว (ใช้กับ tint ของ control ระบบ เช่น Slider)
    static let accent = Color(hex: 0x9B5CF6)
    static let success = Color(hex: 0x22C55E)
    static let warning = Color(hex: 0xF59E0B)
    static let destructive = Color(hex: 0xEF4444)
    /// ตัวหนังสือสีแดงบนพื้นผิวเข้ม (#EF4444 ได้ 4.35:1 บน surfaceRaised — ไม่ถึง 4.5)
    static let destructiveText = Color(hex: 0xF87171)

    /// ปลายสีชมพูเข้มขึ้น (#DB2777) สำหรับพื้นที่มีตัวหนังสือขาว — ขาวบน #EC4899 ได้แค่ 3.5:1
    static let accentTextSafeEnd = Color(hex: 0xDB2777)
    /// พื้นปุ่ม/ชิป/แถบเลือก ที่มีตัวหนังสือขาว (≥ 4.6:1 ทั้งเส้น)
    static let accentGradient = LinearGradient(colors: [accentStart, accentTextSafeEnd], startPoint: .leading, endPoint: .trailing)
    static let accentGradientTextSafeDiagonal = LinearGradient(colors: [accentStart, accentTextSafeEnd], startPoint: .topLeading, endPoint: .bottomTrailing)
    /// ขอบไฮไลต์ (ไม่มีตัวหนังสือ) ใช้สีเต็มของแบรนด์
    static let accentGradientDiagonal = LinearGradient(colors: [accentStart, accentEnd], startPoint: .topLeading, endPoint: .bottomTrailing)
}

enum Space {
    static let xxs: CGFloat = 4, xs: CGFloat = 8, sm: CGFloat = 12, md: CGFloat = 16
    static let lg: CGFloat = 24, xl: CGFloat = 32, xxl: CGFloat = 48
    static let page: CGFloat = 24
}

enum Radius {
    static let control: CGFloat = 8, card: CGFloat = 12, tile: CGFloat = 16
}

enum Metrics {
    static let railWidth: CGFloat = 104
    static let titlebarHeight: CGFloat = 32
    static let detailWidth: CGFloat = 320
    static let tileMin: CGFloat = 220
    static let gridColumns = [GridItem(.adaptive(minimum: tileMin), spacing: Space.md, alignment: .top)]
}

enum TypeScale {
    static let pageTitle = Font.system(size: 28, weight: .semibold, design: .rounded)
    static let section = Font.system(size: 17, weight: .semibold, design: .rounded)
    static let body = Font.system(size: 15)
    static let bodyMedium = Font.system(size: 15, weight: .medium)
    static let bodySemibold = Font.system(size: 15, weight: .semibold)
    static let secondary = Font.system(size: 13)
    static let secondaryMedium = Font.system(size: 13, weight: .medium)
    static let badge = Font.system(size: 11, weight: .semibold)
}

enum Motion {
    static let quick = Animation.spring(duration: 0.18, bounce: 0)
    static let standard = Animation.spring(duration: 0.25, bounce: 0)
    static let panel = Animation.easeOut(duration: 0.25)
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: 1)
    }
}

/// ใช้ animation เมื่อผู้ใช้ไม่ได้เปิด Reduce Motion
@MainActor
func withMotion(_ animation: Animation = Motion.standard, _ body: () -> Void) {
    if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion { body() } else { withAnimation(animation, body) }
}

// MARK: - Surfaces

/// การ์ด: ขอบ 1 pt + เงาบาง (elevation ระดับ 1)
struct CardBackground: ViewModifier {
    var radius: CGFloat = Radius.card
    var fill: Color = Theme.surface
    func body(content: Content) -> some View {
        content
            .background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Theme.border))
            .shadow(color: .black.opacity(0.25), radius: 6, y: 2)
    }
}

extension View {
    func card(radius: CGFloat = Radius.card, fill: Color = Theme.surface) -> some View {
        modifier(CardBackground(radius: radius, fill: fill))
    }
}

// MARK: - Buttons

/// ปุ่มหลัก (หนึ่งปุ่มต่อหน้าจอ): ไล่สี accent
struct PrimaryButtonStyle: ButtonStyle {
    var fullWidth = false
    func makeBody(configuration: Configuration) -> some View {
        PrimaryBody(configuration: configuration, fullWidth: fullWidth)
    }
    private struct PrimaryBody: View {
        let configuration: Configuration
        let fullWidth: Bool
        @Environment(\.isEnabled) private var enabled
        @State private var hover = false
        var body: some View {
            configuration.label
                .font(TypeScale.bodySemibold)
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, Space.md).padding(.vertical, 7)
                .frame(minHeight: 32)
                .frame(maxWidth: fullWidth ? .infinity : nil)
                .background {
                    RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                        .fill(enabled ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceRaised))
                        .brightness(configuration.isPressed ? -0.08 : hover ? 0.05 : 0)
                }
                .opacity(enabled ? 1 : 0.6)
                .contentShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                .onHover { hover = $0 }
                .animation(Motion.quick, value: hover)
        }
    }
}

/// ปุ่มรอง: พื้นผิวยกขึ้น + ขอบ
struct SecondaryButtonStyle: ButtonStyle {
    var fullWidth = false
    var tint: Color = Theme.textPrimary
    func makeBody(configuration: Configuration) -> some View {
        SecondaryBody(configuration: configuration, fullWidth: fullWidth, tint: tint)
    }
    private struct SecondaryBody: View {
        let configuration: Configuration
        let fullWidth: Bool
        let tint: Color
        @Environment(\.isEnabled) private var enabled
        @State private var hover = false
        var body: some View {
            configuration.label
                .font(TypeScale.secondaryMedium)
                .foregroundStyle(tint)
                .multilineTextAlignment(.center)
                .padding(.horizontal, Space.sm).padding(.vertical, 6)
                .frame(minHeight: 28)
                .frame(maxWidth: fullWidth ? .infinity : nil)
                .background(configuration.isPressed ? Theme.surface : hover ? Theme.surfaceHover : Theme.surfaceRaised,
                            in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Theme.border))
                .opacity(enabled ? 1 : 0.45)
                .contentShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                .onHover { hover = $0 }
                .animation(Motion.quick, value: hover)
        }
    }
}

/// ปุ่มไอคอนอย่างเดียว ขนาดกดได้ ≥ 28 pt — ต้องใส่ accessibilityLabel เสมอ
struct IconButtonStyle: ButtonStyle {
    var size: CGFloat = 30
    func makeBody(configuration: Configuration) -> some View {
        IconBody(configuration: configuration, size: size)
    }
    private struct IconBody: View {
        let configuration: Configuration
        let size: CGFloat
        @Environment(\.isEnabled) private var enabled
        @State private var hover = false
        var body: some View {
            configuration.label
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(hover ? Theme.textPrimary : Theme.textSecondary)
                .frame(width: size, height: size)
                .background(configuration.isPressed ? Theme.surface : hover ? Theme.surfaceHover : Theme.surfaceRaised,
                            in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Theme.border))
                .opacity(enabled ? 1 : 0.45)
                .contentShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                .onHover { hover = $0 }
                .animation(Motion.quick, value: hover)
        }
    }
}

/// ชิปตัวกรอง/หมวดหมู่: เลือกแล้วเป็นไล่สี accent
struct ChipButtonStyle: ButtonStyle {
    let selected: Bool
    func makeBody(configuration: Configuration) -> some View {
        ChipBody(configuration: configuration, selected: selected)
    }
    private struct ChipBody: View {
        let configuration: Configuration
        let selected: Bool
        @State private var hover = false
        var body: some View {
            configuration.label
                .font(TypeScale.secondaryMedium)
                .foregroundStyle(selected ? .white : hover ? Theme.textPrimary : Theme.textSecondary)
                .padding(.horizontal, Space.sm).padding(.vertical, 6)
                .frame(minHeight: 30)
                .background {
                    Capsule().fill(selected ? AnyShapeStyle(Theme.accentGradient)
                                   : AnyShapeStyle(hover ? Theme.surfaceHover : Theme.surface))
                }
                .overlay(Capsule().strokeBorder(selected ? Color.clear : Theme.border))
                .opacity(configuration.isPressed ? 0.85 : 1)
                .contentShape(Capsule())
                .onHover { hover = $0 }
                .animation(Motion.quick, value: hover)
                .animation(Motion.quick, value: selected)
        }
    }
}

// MARK: - Controls

/// สวิตช์เปิด/ปิดแบบของแอป — VoiceOver ยังเห็นเป็น Toggle ปกติ
struct SwitchToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        SwitchBody(configuration: configuration)
    }
    private struct SwitchBody: View {
        let configuration: Configuration
        @Environment(\.isEnabled) private var enabled
        var body: some View {
            Button {
                withMotion(Motion.quick) { configuration.isOn.toggle() }
            } label: {
                Capsule()
                    .fill(configuration.isOn ? AnyShapeStyle(Theme.accentGradient) : AnyShapeStyle(Theme.surfaceHover))
                    .overlay(Capsule().strokeBorder(configuration.isOn ? Color.clear : Theme.borderStrong))
                    .frame(width: 38, height: 22)
                    .overlay(alignment: configuration.isOn ? .trailing : .leading) {
                        Circle().fill(.white).frame(width: 18, height: 18).padding(2)
                            .shadow(color: .black.opacity(0.3), radius: 1.5, y: 1)
                    }
                    .frame(minWidth: 38, minHeight: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .opacity(enabled ? 1 : 0.45)
            .accessibilityRepresentation {
                Toggle(isOn: configuration.$isOn) { configuration.label }
            }
        }
    }
}

/// ตัวเลือกแบบแบ่งส่วน (ตัวเลือกไม่กี่ตัว) — VoiceOver เห็นเป็น Picker ปกติ
struct SegmentedControl<Value: Hashable>: View {
    let label: String
    @Binding var selection: Value
    let options: [(Value, String)]
    @Namespace private var ns
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options.indices, id: \.self) { i in
                let (value, title) = options[i]
                let on = value == selection
                Button { withMotion(Motion.quick) { selection = value } } label: {
                    Text(title)
                        .font(TypeScale.secondaryMedium)
                        .foregroundStyle(on ? .white : Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, Space.sm).padding(.vertical, 5)
                        .frame(minHeight: 26)
                        .background {
                            if on {
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(Theme.accentGradient)
                                    .matchedGeometryEffect(id: "pill", in: ns)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Theme.border))
        .opacity(enabled ? 1 : 0.45)
        .accessibilityRepresentation {
            Picker(label, selection: $selection) {
                ForEach(options.indices, id: \.self) { i in Text(options[i].1).tag(options[i].0) }
            }
            .pickerStyle(.segmented)
        }
    }
}

/// ปุ่มเมนูเลือกค่า (ตัวเลือกเยอะ เช่น ฟอนต์) — ป้ายแสดงค่าปัจจุบัน
struct MenuPicker<Value: Hashable, Items: View>: View {
    let label: String
    @Binding var selection: Value
    let current: String
    @ViewBuilder var items: Items

    var body: some View {
        Menu {
            Picker(label, selection: $selection) { items }.pickerStyle(.inline).labelsHidden()
        } label: {
            HStack(spacing: Space.xs) {
                Text(current).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .menuStyle(.button)
        .menuIndicator(.hidden)
        .buttonStyle(SecondaryButtonStyle())
        .fixedSize()
        .accessibilityLabel(label)
        .accessibilityValue(current)
    }
}

/// สไลเดอร์ระบบ + ค่าปัจจุบัน (tabular digits)
struct ValueSlider: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    var step: Double? = nil
    var format: (Double) -> String
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        HStack(spacing: Space.sm) {
            Group {
                if let step { Slider(value: $value, in: range, step: step) } else { Slider(value: $value, in: range) }
            }
            .labelsHidden()
            .controlSize(.small)
            .tint(Theme.accent)
            .frame(minWidth: 120, maxWidth: 220)
            .accessibilityLabel(label)
            .accessibilityValue(format(value))
            Text(format(value))
                .font(TypeScale.secondary.monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
                .frame(minWidth: 48, alignment: .trailing)
                .accessibilityHidden(true)
        }
        .opacity(enabled ? 1 : 0.45)
    }
}

/// ช่องค้นหาแบบของแอป
struct SearchField: View {
    let prompt: String
    @Binding var text: String
    var onSubmit: () -> Void = {}
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: Space.xs) {
            Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .accessibilityHidden(true)
            TextField(prompt, text: $text, prompt: Text(prompt).foregroundStyle(Theme.textSecondary))
                .textFieldStyle(.plain)
                .font(TypeScale.secondary)
                .foregroundStyle(Theme.textPrimary)
                .focused($focused)
                .onSubmit(onSubmit)
                .onExitCommand { text = ""; onSubmit() }
            if !text.isEmpty {
                Button { text = ""; onSubmit() } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textSecondary)
                        .frame(width: 20, height: 20).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tr("Clear"))
            }
        }
        .padding(.horizontal, Space.sm)
        .frame(height: 32)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
            .strokeBorder(focused ? Theme.accent : Theme.border, lineWidth: focused ? 1.5 : 1))
        .animation(Motion.quick, value: focused)
    }
}

// MARK: - Settings building blocks

/// กลุ่มการตั้งค่าแบบการ์ด: หัวข้อ + แถวคั่นด้วยเส้น + คำอธิบายท้าย
struct SettingsGroup<Content: View>: View {
    var title: String? = nil
    var footer: String? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            if let title {
                Text(title).font(TypeScale.section).foregroundStyle(Theme.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.horizontal, Space.xxs)
            }
            VStack(alignment: .leading, spacing: 0) {
                Group(subviews: content) { subviews in
                    ForEach(subviews.indices, id: \.self) { i in
                        if i > 0 { Rectangle().fill(Theme.border).frame(height: 1).padding(.leading, Space.md) }
                        subviews[i]
                            .padding(.horizontal, Space.md).padding(.vertical, Space.sm)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .card()
            if let footer {
                Text(footer).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, Space.xxs)
            }
        }
    }
}

/// แถวการตั้งค่า: ชื่อ + คำอธิบาย (ตัดบรรทัดได้) แล้ว control ชิดท้าย
struct SettingRow<Control: View>: View {
    let title: String
    var subtitle: String? = nil
    var icon: String? = nil
    var appIcon: NSImage? = nil
    @ViewBuilder var control: Control
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        HStack(alignment: .center, spacing: Space.md) {
            if let appIcon {
                Image(nsImage: appIcon).resizable().frame(width: 22, height: 22).accessibilityHidden(true)
            }
            if let icon {
                Image(systemName: icon).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary).frame(width: 20)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(TypeScale.body).foregroundStyle(Theme.textPrimary)
                if let subtitle {
                    Text(subtitle).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .opacity(enabled ? 1 : 0.5)
            control
        }
        .accessibilityElement(children: .contain)
    }
}

/// แถวที่ control อยู่ใต้ชื่อ (ใช้ในคอลัมน์แคบ เช่นแผงรายละเอียด)
struct SettingColumn<Control: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var control: Control
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(TypeScale.body).foregroundStyle(Theme.textPrimary)
                if let subtitle { Text(subtitle).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary) }
            }
            .fixedSize(horizontal: false, vertical: true)
            .opacity(enabled ? 1 : 0.5)
            control
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

/// แถวสวิตช์
struct SettingToggle: View {
    let title: String
    var subtitle: String? = nil
    @Binding var isOn: Bool

    var body: some View {
        SettingRow(title: title, subtitle: subtitle) {
            Toggle(title, isOn: $isOn).toggleStyle(SwitchToggleStyle()).labelsHidden()
        }
    }
}

/// แถวสถานะ (ไอคอนสี + ข้อความ) — ไม่ใช้สีอย่างเดียวในการสื่อความหมาย
struct StatusRow<Trailing: View>: View {
    enum Kind { case ok, warning, info }
    let kind: Kind
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: Space.sm) {
            Image(systemName: symbol).font(.system(size: 16, weight: .semibold)).foregroundStyle(color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(TypeScale.body).foregroundStyle(Theme.textPrimary)
                if let subtitle { Text(subtitle).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary) }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        switch kind {
        case .ok: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .info: "info.circle.fill"
        }
    }
    private var color: Color {
        switch kind {
        case .ok: Theme.success
        case .warning: Theme.warning
        case .info: Theme.textSecondary
        }
    }
}

extension StatusRow where Trailing == EmptyView {
    init(kind: Kind, title: String, subtitle: String? = nil) {
        self.init(kind: kind, title: title, subtitle: subtitle) { EmptyView() }
    }
}

/// ภาพตัวอย่างในหน้าตั้งค่า (เต็มความกว้างการ์ด)
struct PreviewCard<Content: View>: View {
    var height: CGFloat = 150
    var dimmed = false
    @ViewBuilder var content: Content
    var body: some View {
        content
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
            .opacity(dimmed ? 0.45 : 1)
            .accessibilityHidden(true)
    }
}

/// ภาพบนพื้นไล่สีของหน้าตั้งค่า (ใช้แทนหน้าจอ)
struct DesktopBackdrop: View {
    var body: some View {
        LinearGradient(colors: [Color(hex: 0x3B1D7A), Color(hex: 0x5B2A6E), Color(hex: 0x14121C)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - Toast

struct ToastView: View {
    let text: String
    let isError: Bool
    var body: some View {
        HStack(spacing: Space.xs) {
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundStyle(isError ? Theme.warning : Theme.success)
            Text(text).font(TypeScale.secondaryMedium).foregroundStyle(Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Space.md).padding(.vertical, Space.sm)
        .frame(maxWidth: 520)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Theme.borderStrong))
        .shadow(color: .black.opacity(0.45), radius: 18, y: 8)
        .accessibilityElement(children: .combine)
    }
}
