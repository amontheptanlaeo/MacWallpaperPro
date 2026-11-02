import AppKit
import Carbon.HIToolbox
import SwiftUI

// MARK: - Shared rows

/// Slider row with a description and the current value
struct FeatureSlider: View {
    let title: String
    var subtitle: String? = nil
    @Binding var value: Double
    let range: ClosedRange<Double>
    var step: Double? = nil   // nil = continuous, no tick marks
    var unit = "pt"

    var body: some View {
        SettingRow(title: title, subtitle: subtitle) {
            ValueSlider(label: title, value: $value, range: range, step: step) { v in
                unit == "%" ? "\(Int((v * 100).rounded()))%" : "\(Int(v.rounded())) \(unit)"
            }
        }
    }
}

/// Accessibility permission status, same as on the Auto Quit page
struct AXPermissionSection: View {
    @ObservedObject private var trust = AXTrust.shared

    var body: some View {
        SettingsGroup(title: tr("Accessibility access")) {
            if trust.isTrusted {
                StatusRow(kind: .ok, title: tr("Allowed"))
            } else {
                StatusRow(kind: .warning, title: tr("Not allowed yet"),
                          subtitle: tr("Go to Privacy & Security › Accessibility and turn on MacWallpaperPro.")) {
                    Button(tr("Open Settings…")) { trust.openSettings() }
                        .buttonStyle(PrimaryButtonStyle())
                }
            }
        }
        .onAppear { trust.refresh(); trust.watch() }
    }
}

/// Color picker row
struct ColorRow: View {
    let title: String
    var subtitle: String? = nil
    let selection: Binding<Color>
    var supportsOpacity = true
    var body: some View {
        SettingRow(title: title, subtitle: subtitle) {
            ColorPicker(title, selection: selection, supportsOpacity: supportsOpacity).labelsHidden()
        }
    }
}

// MARK: - Borders

struct BordersPage: View {
    @ObservedObject private var fs = FeatureStore.shared
    @ObservedObject private var trust = AXTrust.shared

    var body: some View {
        let c = fs.config
        SettingsGroup(footer: trust.isTrusted ? nil : tr("Allow accessibility access to track other apps’ windows.")) {
            SettingToggle(title: tr("Show a border around the active window"),
                          subtitle: tr("Draws a glowing border around the focused window so you can see where you’re typing. The border hides automatically in full screen."),
                          isOn: $fs.config.borderEnabled)
                .disabled(!trust.isTrusted && !c.borderEnabled)
        }

        AXPermissionSection()

        SettingsGroup(title: tr("Preview")) {
            PreviewCard(dimmed: !c.borderEnabled) { BorderPreview(cfg: c) }
        }

        SettingsGroup(title: tr("Appearance")) {
            ColorRow(title: tr("Border color"), subtitle: tr("The main color of the border and glow"), selection: fs.color(\.borderColor))
            SettingToggle(title: tr("Gradient"), subtitle: tr("Blends diagonally from the border color to a second color"),
                          isOn: $fs.config.borderUseGradient)
            if c.borderUseGradient {
                ColorRow(title: tr("Second color"), subtitle: tr("The end color of the gradient"), selection: fs.color(\.borderColor2))
            }
            FeatureSlider(title: tr("Width"), subtitle: tr("How thick the border is"), value: $fs.config.borderWidth, range: 1...12)
            FeatureSlider(title: tr("Corner radius"), subtitle: tr("Match macOS window corners (about 10–16)"), value: $fs.config.borderRadius, range: 0...28)
            FeatureSlider(title: tr("Glow"), subtitle: tr("Set to 0 for a plain line"), value: $fs.config.borderGlow, range: 0...30)
        }
        .disabled(!c.borderEnabled)

        SettingsGroup(title: tr("Other windows"), footer: tr("Reads the window list every second, so it uses slightly more energy.")) {
            SettingToggle(title: tr("Show borders on other windows"), subtitle: tr("Draws a thin border without glow around inactive windows"),
                          isOn: $fs.config.borderShowInactive)
            if c.borderShowInactive {
                ColorRow(title: tr("Inactive border color"), subtitle: tr("A light, translucent color works best so it doesn’t distract"),
                         selection: fs.color(\.borderInactiveColor))
            }
        }
        .disabled(!c.borderEnabled)
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
            DesktopBackdrop()
            RoundedRectangle(cornerRadius: cfg.borderRadius, style: .continuous)
                .fill(Theme.surfaceRaised)
                .overlay(alignment: .topLeading) {
                    HStack(spacing: 6) {
                        Circle().fill(Color(hex: 0xFF5F57)).frame(width: 10)
                        Circle().fill(Color(hex: 0xFEBC2E)).frame(width: 10)
                        Circle().fill(Color(hex: 0x28C840)).frame(width: 10)
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
        .environment(\.layoutDirection, .leftToRight)
    }
}

// MARK: - Snapping

struct SnappingPage: View {
    @ObservedObject private var fs = FeatureStore.shared
    @ObservedObject private var snapper = WindowSnapper.shared
    @ObservedObject private var trust = AXTrust.shared

    var body: some View {
        let c = fs.config
        SettingsGroup(footer: trust.isTrusted ? nil : tr("Shortcuts work right away, but moving other apps’ windows requires accessibility access.")) {
            SettingToggle(title: tr("Snap windows with shortcuts"),
                          subtitle: tr("Move and resize the active window to half the screen, a corner, or the full screen without covering the menu bar or Dock."),
                          isOn: $fs.config.snapEnabled)
        }

        AXPermissionSection()

        SettingsGroup {
            FeatureSlider(title: tr("Gap"), subtitle: tr("Space around windows and between adjacent windows"),
                          value: $fs.config.snapGap, range: 0...32)
        }
        .disabled(!c.snapEnabled)

        VStack(alignment: .leading, spacing: Space.xs) {
            SettingsGroup(title: tr("Shortcuts"),
                          footer: tr("Click a shortcut, then press a new key with ⌃, ⌥, or ⌘. Press esc to cancel or ⌫ to turn the shortcut off.")) {
                ForEach(SnapAction.allCases) { a in
                    SettingRow(title: a.label, icon: a.symbol) {
                        HStack(spacing: Space.xs) {
                            if snapper.failed.contains(a) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(Theme.warning)
                                    .help(tr("Another app is using this shortcut. Try a different one."))
                                    .accessibilityLabel(tr("Another app is using this shortcut. Try a different one."))
                            }
                            ShortcutRecorder(action: a)
                        }
                    }
                }
            }
            Button(tr("Restore defaults")) { fs.config.snapShortcuts = SnapAction.defaultShortcuts }
                .buttonStyle(SecondaryButtonStyle())
        }
        .disabled(!c.snapEnabled)
        .onDisappear { ShortcutRecording.shared.stop() }
    }
}

/// Shortcut recording state (one field at a time)
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

    /// Returns true when this event was consumed
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
        // If another action already uses it, move it here
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
            Text(recording ? tr("Press shortcut…") : combo?.display ?? tr("None"))
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(recording ? Theme.accentEnd : combo == nil ? Theme.textSecondary : Theme.textPrimary)
                .frame(minWidth: 84)
        }
        .buttonStyle(SecondaryButtonStyle())
        .overlay {
            if recording {
                RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                    .strokeBorder(Theme.accentGradientDiagonal, lineWidth: 1.5)
            }
        }
        .accessibilityLabel(tr("Shortcut for %@", action.label))
        .accessibilityValue(recording ? tr("Waiting for new shortcut") : combo?.display ?? tr("None"))
    }
}

// MARK: - Menu bar icon hiding

struct MenuBarPage: View {
    @ObservedObject private var fs = FeatureStore.shared
    @ObservedObject private var hider = MenuBarHider.shared

    var body: some View {
        let c = fs.config
        SettingsGroup {
            SettingToggle(title: tr("Hide menu bar icons"),
                          subtitle: tr("Adds an arrow button to the menu bar. Click it to hide or show icons you rarely use for a cleaner menu bar."),
                          isOn: $fs.config.hiderEnabled)
        }

        SettingsGroup(title: tr("Behavior")) {
            SettingToggle(title: tr("Hide again automatically"), subtitle: tr("After you show the icons, they hide again when the time is up"),
                          isOn: $fs.config.hiderAutoRehide)
            FeatureSlider(title: tr("Hide again after"), subtitle: tr("Counted from when you show the icons"),
                          value: $fs.config.hiderDelay, range: 3...60, unit: tr("sec"))
                .disabled(!c.hiderAutoRehide)
            SettingRow(title: tr("Current status"),
                       subtitle: hider.isHidden ? tr("Icons left of the divider are hidden") : tr("All icons are visible")) {
                Button(hider.isHidden ? tr("Show icons") : tr("Hide icons")) { hider.setHidden(!hider.isHidden) }
                    .buttonStyle(SecondaryButtonStyle())
            }
            if hider.misordered {
                StatusRow(kind: .warning,
                          title: tr("The divider is to the right of the arrow button, so icons can’t be hidden. Hold ⌘ and drag the divider to the left of the arrow button."))
            }
        }
        .disabled(!c.hiderEnabled)

        SettingsGroup(title: tr("How to choose icons to hide"),
                      footer: tr("macOS doesn’t let apps rearrange other apps’ icons, so you drag them yourself. Some system icons, like Control Center and the clock, can’t be moved. On Macs with a notch, overflowing icons may already be hidden behind it.")) {
            step(1, tr("Click the arrow button in the menu bar to show the divider."))
            step(2, tr("Hold ⌘ and drag the icons you want to hide to the left of the divider."))
            step(3, tr("Click the arrow button again. Icons left of the divider disappear; icons to the right stay visible."))
            step(4, tr("Right-click the arrow button to open this feature’s menu."))
        }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: Space.sm) {
            Text("\(n)").font(TypeScale.badge).foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(Theme.accentGradientTextSafeDiagonal, in: Circle())
                .accessibilityHidden(true)
            Text(text).font(TypeScale.body).foregroundStyle(Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
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
        SettingsGroup(title: tr("Custom menu bar"),
                      footer: tr("Works best with the macOS menu bar hidden. Clicks pass through the bar, so it never blocks the windows below.")) {
            SettingToggle(title: tr("Show custom menu bar"),
                          subtitle: tr("A bar at the top of the screen showing the app name, time, battery, CPU, memory, and network, with adjustable colors and shape."),
                          isOn: $fs.config.barEnabled)
        }

        SettingsGroup(title: tr("System menu bar")) {
            if bar.systemBarVisible {
                StatusRow(kind: .warning, title: tr("The macOS menu bar is still showing"),
                          subtitle: tr("This bar sits below the system menu bar to avoid overlapping, which takes up two rows. Hiding the system menu bar is recommended."))
            } else {
                StatusRow(kind: .ok, title: tr("The macOS menu bar is hidden. Move the pointer to the top edge to reveal it as usual."))
            }
            SettingToggle(title: tr("Automatically hide the macOS menu bar"),
                          subtitle: tr("Same as “Automatically hide and show the menu bar: Always” in System Settings. Takes effect immediately."),
                          isOn: Binding(get: { systemHide }, set: { on in
                              systemHide = on
                              CustomMenuBar.setSystemAutoHide(on)
                              DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { bar.refreshSystemBarState() }
                          }))
            SettingRow(title: tr("Set it in System Settings"),
                       subtitle: tr("If the switch above has no effect, go to System Settings › Menu Bar and choose to hide the menu bar automatically.")) {
                Button(tr("Open System Settings…")) { CustomMenuBar.openSystemMenuBarSettings() }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }

        SettingsGroup(title: tr("Preview")) {
            PreviewCard(height: 110, dimmed: !c.barEnabled) {
                ZStack(alignment: .top) {
                    DesktopBackdrop()
                    CustomBarView()
                        .frame(height: c.barHeight)
                        .padding(c.barMargin)
                }
                .environment(\.layoutDirection, .leftToRight)
            }
        }

        SettingsGroup(title: tr("Widgets")) {
            widget(\.barShowApp, tr("Active app"), tr("Icon and name of the frontmost app"))
            widget(\.barShowClock, tr("Time"), tr("Hours and minutes"))
            widget(\.barShowDate, tr("Date"), tr("Weekday, day, and month"))
            widget(\.barShowBattery, tr("Battery"), tr("Percentage and charging status (hidden on Macs without a battery)"))
            widget(\.barShowCPU, "CPU", tr("Total processor usage across all cores"))
            widget(\.barShowMemory, tr("Memory"), tr("Calculated the same way as “Memory Used” in Activity Monitor"))
            widget(\.barShowNetwork, tr("Network"), tr("Connection type and download speed"))
        }
        .disabled(!c.barEnabled)

        SettingsGroup(title: tr("Colors and text")) {
            ColorRow(title: tr("Background color"), subtitle: tr("The color of the bar itself"), selection: fs.color(\.barColor), supportsOpacity: false)
            FeatureSlider(title: tr("Opacity"), subtitle: tr("Lower values let more of the wallpaper show through"),
                          value: $fs.config.barOpacity, range: 0...1, unit: "%")
            SettingToggle(title: tr("Blur background"), subtitle: tr("Gives the bar a frosted-glass look like the macOS menu bar"),
                          isOn: $fs.config.barBlur)
            ColorRow(title: tr("Text color"), subtitle: tr("The color of text and icons in the bar"), selection: fs.color(\.barTextColor))
            SettingRow(title: tr("Font"), subtitle: tr("Used for all text in the bar")) {
                MenuPicker(label: tr("Font"), selection: $fs.config.barFontFamily,
                           current: c.barFontFamily.isEmpty ? tr("System default") : c.barFontFamily) {
                    Text(tr("System default")).tag("")
                    Divider()
                    ForEach(Self.families, id: \.self) { Text($0).tag($0) }
                }
            }
            FeatureSlider(title: tr("Font size"), value: $fs.config.barFontSize, range: 10...16)
        }
        .disabled(!c.barEnabled)

        SettingsGroup(title: tr("Shape"),
                      footer: tr("Window snapping leaves room for this bar automatically, but windows maximized other ways may sit under it. Now Playing isn’t supported because macOS has no public API for it.")) {
            FeatureSlider(title: tr("Height"), subtitle: tr("The macOS menu bar is about 24–37 pt tall"),
                          value: $fs.config.barHeight, range: 22...44)
            FeatureSlider(title: tr("Corner radius"), subtitle: tr("Set to 0 for square corners"),
                          value: $fs.config.barRadius, range: 0...22)
            FeatureSlider(title: tr("Margin"), subtitle: tr("Above 0 the bar floats; set to 0 to span the full width at the screen edge"),
                          value: $fs.config.barMargin, range: 0...16)
            SettingToggle(title: tr("Show on all displays"), subtitle: tr("When off, the bar appears only on the main display"),
                          isOn: $fs.config.barAllScreens)
        }
        .disabled(!c.barEnabled)
        .onAppear {
            systemHide = CustomMenuBar.systemAutoHide
            bar.refreshSystemBarState()
            BarStats.shared.start()   // so the preview shows real data
        }
        .onDisappear {
            if !bar.isRunning { BarStats.shared.stop() }
        }
    }

    private func widget(_ kp: WritableKeyPath<FeatureConfig, Bool>, _ title: String, _ subtitle: String) -> some View {
        SettingToggle(title: title, subtitle: subtitle,
                      isOn: Binding(get: { fs.config[keyPath: kp] }, set: { fs.config[keyPath: kp] = $0 }))
    }
}
