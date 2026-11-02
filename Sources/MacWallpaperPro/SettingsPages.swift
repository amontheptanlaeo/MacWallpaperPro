import AppKit
import SwiftUI
import UniformTypeIdentifiers

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

    /// computed so the text follows the language immediately
    static var all: [StyleOption] { [
        StyleOption(id: "nebula", name: "Nebula", detail: tr("Responds to your pointer"), symbol: "cursorarrow.motionlines", mode: .interactive),
        StyleOption(id: "aurora", name: "Aurora", detail: tr("Northern lights"), symbol: "sparkles", mode: .preset, preset: .aurora),
        StyleOption(id: "liquid", name: "Liquid", detail: tr("Swirling liquid"), symbol: "drop.fill", mode: .preset, preset: .liquid),
        StyleOption(id: "plasma", name: "Plasma", detail: tr("Soft color waves"), symbol: "waveform", mode: .preset, preset: .plasma),
        StyleOption(id: "synthwave", name: "Synthwave", detail: tr("’80s neon"), symbol: "sun.horizon.fill", mode: .preset, preset: .synthwave),
        StyleOption(id: "starfield", name: "Starfield", detail: tr("Fly through the stars"), symbol: "star.fill", mode: .preset, preset: .starfield),
        StyleOption(id: "video", name: tr("Video"), detail: tr("Your own file"), symbol: "film.fill", mode: .video),
        StyleOption(id: "web", name: tr("Website"), detail: tr("URL or HTML file"), symbol: "globe", mode: .web),
    ] }

    func isSelected(_ c: Config) -> Bool {
        let mode = c.wallpaperMode == .off ? c.lastActiveMode : c.wallpaperMode
        return mode == self.mode && (preset == nil || preset == c.preset)
    }

    var usesColors: Bool { [.interactive, .preset].contains(mode) }
}


// MARK: - Settings (one page, sections listed on the left)

struct SettingsView: View {
    @ObservedObject private var nav = Navigator.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 0) {
            sectionList
            ZStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: Space.lg) {
                        Text(nav.settingsSection.title).font(TypeScale.pageTitle)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        sectionContent
                    }
                    .frame(maxWidth: 720, alignment: .leading)
                    .padding(.horizontal, Space.page).padding(.bottom, Space.page).padding(.top, Space.xxs)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .id(nav.settingsSection)
                .transition(.opacity)
            }
            .animation(reduceMotion ? nil : Motion.standard, value: nav.settingsSection)
        }
    }

    private var sectionList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(SettingsSection.allCases) { s in
                    let on = nav.settingsSection == s
                    Button { nav.settingsSection = s } label: {
                        HStack(spacing: Space.sm) {
                            Image(systemName: s.symbol)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(on ? .white : Theme.textSecondary)
                                .frame(width: 26, height: 26)
                                .background(on ? AnyShapeStyle(Theme.accentGradientTextSafeDiagonal) : AnyShapeStyle(Theme.surfaceRaised),
                                            in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                            Text(s.title)
                                .font(on ? TypeScale.secondaryMedium.weight(.semibold) : TypeScale.secondaryMedium)
                                .foregroundStyle(on ? Theme.textPrimary : Theme.textSecondary)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.horizontal, Space.xs).padding(.vertical, 5)
                        .frame(minHeight: 36)
                        .background(on ? Theme.surfaceRaised : .clear, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                        .contentShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(s.title)
                    .accessibilityAddTraits(on ? [.isSelected] : [])
                }
            }
            .padding(Space.sm)
        }
        .frame(width: 220)
        .overlay(alignment: .trailing) { Rectangle().fill(Theme.border).frame(width: 1) }
    }

    @ViewBuilder
    private var sectionContent: some View {
        switch nav.settingsSection {
        case .general: GeneralPage()
        case .clock: ClockPage()
        case .borders: BordersPage()
        case .snapping: SnappingPage()
        case .menuBar: MenuBarPage(); CustomBarPage()
        case .autoQuit: AutoQuitPage()
        case .lockScreen: LockScreenPage()
        case .about: AboutPage()
        }
    }
}

// MARK: - General

struct GeneralPage: View {
    @EnvironmentObject var store: Store
    @ObservedObject private var community = Community.shared
    @State private var desktopIconsVisible = GeneralPage.readDesktopIcons()

    var body: some View {
        SettingsGroup {
            SettingRow(title: tr("Language")) { LanguagePicker() }
        }
        SettingsGroup(title: tr("Wallpaper")) {
            SettingToggle(title: tr("Live wallpaper"),
                          subtitle: tr("Turn off live wallpaper and return to your regular macOS wallpaper"),
                          isOn: Binding(get: { store.config.wallpaperMode != .off },
                                        set: { store.config.wallpaperMode = $0 ? store.config.lastActiveMode : .off }))
            SettingToggle(title: tr("Show desktop icons"),
                          isOn: Binding(get: { desktopIconsVisible }, set: setDesktopIcons))
            SettingRow(title: tr("Reload wallpaper")) {
                Button { WallpaperManager.shared.reload() } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(IconButtonStyle())
                    .help(tr("Reload wallpaper"))
                    .accessibilityLabel(tr("Reload wallpaper"))
            }
        }
        storage
    }

    /// Space used by Community downloads, with per-item and bulk removal
    @ViewBuilder
    private var storage: some View {
        let list = community.installed
        SettingsGroup(title: tr("Storage"),
                      footer: list.isEmpty ? nil : tr("Wallpapers that come with the app take no extra space and can't be removed.")) {
            SettingRow(title: tr("Community wallpapers"),
                       subtitle: list.isEmpty
                           ? tr("No Community wallpapers installed")
                           : tr("%1$d wallpapers · %2$@", list.count,
                                ByteCountFormatter.string(fromByteCount: community.totalSize, countStyle: .file)),
                       icon: "internaldrive") {
                if !list.isEmpty {
                    Button(role: .destructive) { community.confirmRemoveAll = true } label: {
                        Text(tr("Remove all…"))
                    }
                    .buttonStyle(SecondaryButtonStyle(tint: Theme.destructiveText))
                }
            }
            ForEach(list) { w in
                SettingRow(title: w.manifest.title,
                           subtitle: storageSubtitle(w),
                           appIcon: NSImage(contentsOf: w.thumbURL)) {
                    Button { community.requestRemove(w) } label: { Image(systemName: "trash") }
                        .buttonStyle(IconButtonStyle())
                        .help(tr("Remove from Mac…"))
                        .accessibilityLabel(tr("Remove “%@” from this Mac?", w.manifest.title))
                }
            }
        }
    }

    private func storageSubtitle(_ w: InstalledWallpaper) -> String {
        let size = ByteCountFormatter.string(fromByteCount: community.sizes[w.id] ?? Int64(w.manifest.sizeBytes), countStyle: .file)
        let inUse = store.config.wallpaperMode == .installed && store.config.installedID == w.id
        let kind = w.isVideo ? tr("Video") : tr("Interactive")
        return inUse ? "\(kind) · \(size) · \(tr("In use"))" : "\(kind) · \(size)"
    }

    private static func readDesktopIcons() -> Bool {
        UserDefaults(suiteName: "com.apple.finder")?.object(forKey: "CreateDesktop") as? Bool ?? true
    }

    private func setDesktopIcons(_ visible: Bool) {
        desktopIconsVisible = visible
        Shell.run("/usr/bin/defaults", ["write", "com.apple.finder", "CreateDesktop", "-bool", visible ? "true" : "false"])
        Shell.run("/usr/bin/killall", ["Finder"])
    }
}

// MARK: - Clock

struct ClockPage: View {
    @EnvironmentObject var store: Store
    private static let families = NSFontManager.shared.availableFontFamilies.sorted()

    var body: some View {
        let c = store.config
        SettingsGroup {
            SettingToggle(title: tr("Show clock on desktop"), subtitle: tr("Shows the time and date on your wallpaper"),
                          isOn: $store.config.showClock)
        }

        SettingsGroup(title: tr("Preview")) {
            PreviewCard(dimmed: !c.showClock) {
                ZStack {
                    LinearGradient(colors: [c.color3.color, c.color2.color.opacity(0.6)], startPoint: .top, endPoint: .bottom)
                    VStack(spacing: 2) {
                        Text(Date.now, format: .dateTime.hour(.defaultDigits(amPM: .abbreviated)).minute(.twoDigits))
                            .font(c.font(min(c.clockSize * 0.45, 64), .semibold))
                            .monospacedDigit()
                        Text(Date.now, format: .dateTime.weekday(.wide).day().month(.wide))
                            .font(c.font(13, .medium)).opacity(0.8)
                    }
                    .foregroundStyle(c.clockColor.color)
                }
            }
        }

        SettingsGroup(title: tr("Appearance")) {
            SettingRow(title: tr("Font")) {
                MenuPicker(label: tr("Font"), selection: $store.config.fontFamily,
                           current: c.fontFamily.isEmpty ? tr("System default") : c.fontFamily) {
                    Text(tr("System default")).tag("")
                    Divider()
                    ForEach(Self.families, id: \.self) { Text($0).tag($0) }
                }
            }
            SettingRow(title: tr("Text color")) {
                ColorPicker(tr("Text color"), selection: store.binding(\.clockColor)).labelsHidden()
            }
            SettingRow(title: tr("Size")) {
                ValueSlider(label: tr("Size"), value: $store.config.clockSize, range: 40...240) { "\(Int($0)) pt" }
            }
            SettingRow(title: tr("Position")) {
                MenuPicker(label: tr("Position"), selection: $store.config.clockPosition, current: c.clockPosition.label) {
                    ForEach(ClockPosition.allCases) { Text($0.label).tag($0) }
                }
            }
        }
        .disabled(!c.showClock)
    }
}

// MARK: - Auto quit

struct AutoQuitPage: View {
    @EnvironmentObject var store: Store
    @ObservedObject private var tq = TrueQuit.shared

    var body: some View {
        SettingsGroup(footer: tq.isTrusted ? nil : tr("Allow accessibility access to turn this on.")) {
            SettingToggle(title: tr("Quit apps when last window closes"),
                          subtitle: tr("macOS normally keeps apps running after you close all their windows. Turn this on to quit them instead. Apps still ask before discarding unsaved work."),
                          isOn: $store.config.trueQuitEnabled)
                .disabled(!tq.isTrusted)
        }

        SettingsGroup(title: tr("Accessibility access")) {
            if tq.isTrusted {
                StatusRow(kind: .ok, title: tr("Allowed"))
            } else {
                StatusRow(kind: .warning, title: tr("Not allowed yet"),
                          subtitle: tr("Go to Privacy & Security › Accessibility and turn on MacWallpaperPro.")) {
                    Button(tr("Open Settings…")) {
                        tq.requestTrust()
                        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
            }
        }

        if !tq.lastEvent.isEmpty {
            SettingsGroup(title: tr("Recent")) {
                Text(tq.lastEvent).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
            }
        }

        SettingsGroup(title: tr("Don’t quit these apps"), footer: tr("Shows apps that are open now and apps you’ve already chosen.")) {
            ForEach(exceptionCandidates, id: \.id) { item in
                SettingRow(title: item.name, appIcon: item.icon) {
                    Toggle(item.name, isOn: exceptionBinding(item.id)).toggleStyle(SwitchToggleStyle()).labelsHidden()
                }
            }
        }
        .disabled(!store.config.trueQuitEnabled)
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
        SettingsGroup(title: tr("Lock screen image"),
                      footer: tr("macOS doesn’t let other apps change the lock screen’s appearance, so only a still image can be set.")) {
            SettingRow(title: tr("Use the current wallpaper"),
                       subtitle: tr("Saves the current frame as a still image and sets it as the lock screen and system wallpaper.")) {
                Button {
                    status = .working
                    Task {
                        let r = await WallpaperManager.shared.applySnapshotAsSystemWallpaper()
                        status = r.success ? .done(r.path ?? "") : .failed(r.message)
                    }
                } label: {
                    ZStack {
                        Text(tr("Set as lock screen")).opacity(status == .working ? 0 : 1)
                        if status == .working { ProgressView().controlSize(.small).tint(.white) }
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(status == .working)
            }

            switch status {
            case .done(let path):
                StatusRow(kind: .ok, title: tr("Image set")) {
                    Button(tr("Show file")) { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) }
                        .buttonStyle(SecondaryButtonStyle())
                }
            case .failed(let msg):
                StatusRow(kind: .warning, title: msg)
            default:
                EmptyView()
            }
        }

        SettingsGroup {
            SettingRow(title: tr("Lock screen now"),
                       subtitle: tr("Turns off the display and locks your Mac (if System Settings › Lock Screen requires a password immediately).")) {
                Button { Shell.run("/usr/bin/pmset", ["displaysleepnow"]) } label: { Label(tr("Lock"), systemImage: "lock.fill") }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
    }
}

// MARK: - About

enum SupportLinks {
    static let githubSponsors = URL(string: "https://github.com/sponsors/amontheptanlaeo")!
    static let kofi = URL(string: "https://ko-fi.com/amontheptanlaeo")!
}

struct AboutPage: View {
    private enum Level { case full, partial, none }
    private var items: [(Level, String, String)] { [
        (.full, tr("Live wallpaper"), tr("Preset styles, video, web pages, and pointer interaction")),
        (.full, tr("Desktop clock"), tr("Choose the font, color, size, and position")),
        (.full, "Community", tr("Free and paid wallpapers, every file signature-checked, running offline")),
        (.full, tr("Window borders"), tr("A glowing colored frame around the active window")),
        (.full, tr("Window snapping"), tr("Left/right halves, quarters, and full screen with shortcuts")),
        (.full, tr("Menu bar"), tr("Hide cluttering icons and use a custom menu bar")),
        (.full, tr("Auto quit"), tr("Quit apps when last window closes")),
        (.partial, tr("Lock screen"), tr("Change the image, but not the appearance or layout")),
        (.none, tr("System-wide fonts and colors"), tr("Requires disabling macOS protection (SIP), which is a security risk")),
    ] }

    var body: some View {
        HStack(spacing: Space.md) {
            Image(systemName: "paintpalette.fill")
                .font(.system(size: 26, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 60, height: 60)
                .background(Theme.accentGradientTextSafeDiagonal, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: "MacWallpaperPro").font(TypeScale.section)
                Text(tr("Version %@", Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"))
                    .font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
        }
        .padding(Space.md)
        .card()

        SettingsGroup(footer: tr("Free to use, modify, and redistribute under GPL-3.0. The MacWallpaperPro name and logo are reserved.")) {
            SettingRow(title: tr("Creator")) {
                Text(verbatim: "Amonthep tanlaeo").font(TypeScale.secondaryMedium).foregroundStyle(Theme.textSecondary)
            }
            SettingRow(title: tr("License")) {
                Link(tr("GPL-3.0 (open source)"), destination: URL(string: "https://www.gnu.org/licenses/gpl-3.0.html")!)
                    .font(TypeScale.secondaryMedium)
                    .foregroundStyle(Theme.accentEnd)
            }
        }

        // Optional support links. Shown only here, never as a popup or prompt.
        SettingsGroup(title: tr("Support MacWallpaperPro"),
                      footer: tr("MacWallpaperPro is free and always will be. If you enjoy it, you can support its development.")) {
            FlowLayout(spacing: Space.sm) {
                Button { NSWorkspace.shared.open(SupportLinks.githubSponsors) } label: {
                    Label(tr("Sponsor on GitHub"), systemImage: "heart.fill")
                }
                .buttonStyle(SecondaryButtonStyle())
                Button { NSWorkspace.shared.open(SupportLinks.kofi) } label: {
                    Label(tr("Buy me a coffee on Ko-fi"), systemImage: "cup.and.saucer.fill")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Space.md)
        }

        SettingsGroup(title: tr("What it can do")) {
            ForEach(items, id: \.1) { item in
                HStack(alignment: .top, spacing: Space.sm) {
                    Group {
                        switch item.0 {
                        case .full: Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                        case .partial: Image(systemName: "minus.circle.fill").foregroundStyle(Theme.warning)
                        case .none: Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .font(.system(size: 16, weight: .semibold))
                    .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.1).font(TypeScale.body)
                        Text(item.2).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}
