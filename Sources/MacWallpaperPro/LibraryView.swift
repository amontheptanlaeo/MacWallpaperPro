import AppKit
import SwiftUI
import WebKit

// MARK: - Entries

struct LibraryEntry: Identifiable, Equatable {
    enum Kind: Equatable {
        case builtin(StyleOption)
        case installed(InstalledWallpaper)
    }

    let kind: Kind

    var id: String {
        switch kind {
        case .builtin(let o): "b:" + o.id
        case .installed(let w): "i:" + w.id
        }
    }

    var title: String {
        switch kind {
        case .builtin(let o): o.name
        case .installed(let w): w.manifest.title
        }
    }

    var subtitle: String {
        switch kind {
        case .builtin(let o): o.detail
        case .installed(let w): tr("By %@", w.manifest.author)
        }
    }

    var isCustom: Bool {
        if case .builtin(let o) = kind { return [.video, .web].contains(o.mode) }
        return false
    }

    var isInstalled: Bool {
        if case .installed = kind { return true }
        return false
    }

    /// Community video (no color/speed adjustments)
    var isVideo: Bool {
        if case .installed(let w) = kind { return w.isVideo }
        return false
    }

    func isActive(_ c: Config) -> Bool {
        guard c.wallpaperMode != .off else { return false }
        switch kind {
        case .builtin(let o): return o.isSelected(c)
        case .installed(let w): return c.wallpaperMode == .installed && c.installedID == w.id
        }
    }

    @MainActor func apply() {
        switch kind {
        case .builtin(let o):
            if let p = o.preset { Store.shared.config.preset = p }
            Store.shared.config.lastActiveMode = o.mode
            Store.shared.config.wallpaperMode = o.mode
        case .installed(let w):
            Community.shared.use(w)
        }
    }
}

enum LibraryFilter: String, CaseIterable, Identifiable {
    case all, builtIn, community, custom
    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: tr("All")
        case .builtIn: tr("Built-in")
        case .community: tr("From Community")
        case .custom: tr("Custom")
        }
    }
}

// MARK: - Library

extension LibraryEntry {
    @MainActor static var all: [LibraryEntry] {
        StyleOption.all.map { LibraryEntry(kind: .builtin($0)) } + Community.shared.installed.map { LibraryEntry(kind: .installed($0)) }
    }

    /// The wallpaper in use (or the last one used, while off)
    @MainActor static func current(_ c: Config) -> LibraryEntry? {
        all.first { e in
            switch e.kind {
            case .builtin(let o): return o.isSelected(c)
            case .installed(let w):
                let mode = c.wallpaperMode == .off ? c.lastActiveMode : c.wallpaperMode
                return mode == .installed && c.installedID == w.id
            }
        }
    }

    @MainActor func canApplyDirectly(_ c: Config) -> Bool {
        guard case .builtin(let o) = kind else { return true }
        switch o.mode {
        case .video: return !c.videoPath.isEmpty
        case .web: return WallpaperRoot.resolve(c.webURL) != nil
        default: return true
        }
    }
}

struct LibraryView: View {
    @EnvironmentObject var store: Store
    @ObservedObject private var community = Community.shared
    @ObservedObject private var nav = Navigator.shared
    @State private var selection: String?
    @State private var showDetails = false
    @State private var filter: LibraryFilter = .all
    @State private var search = ""
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var allEntries: [LibraryEntry] { LibraryEntry.all }

    private func entries(_ f: LibraryFilter) -> [LibraryEntry] {
        allEntries.filter { e in
            let match: Bool = switch f {
            case .all: true
            case .builtIn: !e.isCustom && !e.isInstalled
            case .community: e.isInstalled
            case .custom: e.isCustom
            }
            return match && (search.isEmpty || e.title.localizedCaseInsensitiveContains(search)
                             || e.subtitle.localizedCaseInsensitiveContains(search))
        }
    }

    private var selected: LibraryEntry? { allEntries.first { $0.id == selection } }

    var body: some View {
        HStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.lg) {
                    PageHeader(title: tr("My library")) {
                        SearchField(prompt: tr("Search library"), text: $search).frame(width: 240)
                    }
                    filterChips
                    NowPlayingStrip { openDetails(LibraryEntry.current(store.config)) }
                    content
                }
                .padding(.horizontal, Space.page).padding(.bottom, Space.page).padding(.top, Space.xxs)
            }
            .frame(maxWidth: .infinity)
            if showDetails, let e = selected {
                DetailColumn(title: e.title, close: closeDetails) { LibraryDetails(entry: e) }
                    .transition(.detailColumn(reduceMotion: reduceMotion))
            }
        }
        // ⌫ removes the selected Community wallpaper (asks first)
        .onDeleteCommand {
            if case .installed(let w)? = selected?.kind { community.requestRemove(w) }
        }

        .background { ThumbnailWarmer(entries: allEntries.filter { !$0.isCustom && !$0.isInstalled }) }
        .task(id: Shaders.params(store.config)) {
            // After a color change settles for 1 second -> render a new preview with the current colors
            try? await Task.sleep(for: .seconds(1))
            if !Task.isCancelled { Thumbnails.shared.sync(signature: Shaders.params(store.config)) }
        }
        .onAppear(perform: consumeShowActive)
        .onChange(of: nav.showActiveDetails) { consumeShowActive() }
    }

    private func consumeShowActive() {
        guard nav.showActiveDetails else { return }
        nav.showActiveDetails = false
        openDetails(LibraryEntry.current(store.config))
    }

    private func openDetails(_ e: LibraryEntry?) {
        guard let e else { return }
        withMotion(Motion.panel) { selection = e.id; showDetails = true }
    }

    private func closeDetails() {
        withMotion(Motion.panel) { showDetails = false }
    }

    // MARK: Filter

    private var filterChips: some View {
        FlowLayout() {
            ForEach(LibraryFilter.allCases) { f in
                Button { withMotion(Motion.quick) { filter = f } } label: { Text(f.label) }
                    .buttonStyle(ChipButtonStyle(selected: filter == f))
                    .accessibilityAddTraits(filter == f ? .isSelected : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(tr("Filter"))
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if filter == .all && search.isEmpty {
            section(tr("Built-in"), entries(.builtIn))
            section(tr("From Community"), entries(.community), empty: AnyView(communityEmpty))
            section(tr("Custom"), entries(.custom))
        } else {
            let list = entries(filter)
            if list.isEmpty {
                if search.isEmpty && filter == .community {
                    communityEmpty
                } else {
                    StateCard(symbol: "magnifyingglass",
                              title: search.isEmpty ? tr("No wallpapers yet") : tr("No results for “%@”", search),
                              message: tr("Try a different search."))
                }
            } else {
                grid(list)
            }
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ list: [LibraryEntry], empty: AnyView? = nil) -> some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            Text(title).font(TypeScale.section).foregroundStyle(Theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if list.isEmpty, let empty { empty } else { grid(list) }
        }
    }

    private func grid(_ list: [LibraryEntry]) -> some View {
        LazyVGrid(columns: Metrics.gridColumns, spacing: Space.lg) {
            ForEach(list) { e in
                WallpaperTile(title: e.title, subtitle: e.subtitle,
                              selected: showDetails && selection == e.id,
                              active: e.isActive(store.config),
                              isVideo: e.isVideo,
                              action: { tap(e) }) {
                    EntryThumbnail(entry: e)
                } accessory: {
                    EmptyView()
                }
                .contextMenu { contextMenu(e) }
            }
        }
    }

    /// One click applies it right away (except custom ones with no file set yet), then opens the details
    private func tap(_ e: LibraryEntry) {
        if e.canApplyDirectly(store.config) { withMotion(Motion.quick) { e.apply() } }
        openDetails(e)
    }

    private var communityEmpty: some View {
        HStack(spacing: Space.md) {
            Image(systemName: "sparkles").font(.system(size: 18, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(Theme.accentGradientTextSafeDiagonal, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(tr("No Community wallpapers yet")).font(TypeScale.bodySemibold)
                Text(tr("Browse free and paid work from other creators.")).font(TypeScale.secondary)
                    .foregroundStyle(Theme.textSecondary)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(tr("Go to Discover")) { withMotion { nav.page = .discover } }
                .buttonStyle(SecondaryButtonStyle())
        }
        .padding(Space.md)
        .card()
    }

    @ViewBuilder
    private func contextMenu(_ e: LibraryEntry) -> some View {
        Button(tr("Set as wallpaper")) { e.apply() }
        if case .installed(let w) = e.kind {
            Button(tr("View in Community")) { NSWorkspace.shared.open(community.webPage(for: w.id)) }
            Button(tr("Show in Finder")) { NSWorkspace.shared.activateFileViewerSelecting([w.fileURL]) }
            Divider()
            Button(tr("Remove from Mac…"), role: .destructive) { community.requestRemove(w) }
        }
    }
}

/// Preview image of a Library item
struct EntryThumbnail: View {
    let entry: LibraryEntry
    @EnvironmentObject var store: Store
    @ObservedObject private var thumbs = Thumbnails.shared

    var body: some View {
        switch entry.kind {
        case .builtin(let o):
            if let img = thumbs.image(entry.id) {
                Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
            } else {
                PlaceholderThumb(symbol: o.symbol, colors: o.usesColors
                                 ? [store.config.color2.color, store.config.color3.color]
                                 : [Theme.surfaceHover, Theme.surface])
            }
        case .installed(let w):
            if let img = NSImage(contentsOf: w.thumbURL) {
                Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
            } else {
                PlaceholderThumb(symbol: "photo")
            }
        }
    }
}

// MARK: - Now playing

/// "Now playing" bar: thumbnail, title and pause/resume; used on the Library and Discover pages
struct NowPlayingStrip: View {
    let onCustomize: () -> Void
    @EnvironmentObject var store: Store
    @ObservedObject private var community = Community.shared

    var body: some View {
        let c = store.config
        let on = c.wallpaperMode != .off
        let entry = LibraryEntry.current(c)
        HStack(spacing: Space.md) {
            Group {
                if let entry { EntryThumbnail(entry: entry) } else { PlaceholderThumb(symbol: "photo") }
            }
            .frame(width: 96, height: 60)
            .clipShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Theme.border))
            .saturation(on ? 1 : 0.2)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Circle().fill(on ? Theme.success : Theme.textSecondary).frame(width: 7, height: 7)
                    Text(on ? tr("Now playing") : tr("Live wallpaper is off"))
                        .font(TypeScale.secondaryMedium).foregroundStyle(Theme.textSecondary)
                }
                Text(entry?.title ?? "—").font(TypeScale.section).foregroundStyle(Theme.textPrimary)
                if !on {
                    Text(tr("Your regular macOS wallpaper is showing. Click any wallpaper to turn it back on."))
                        .font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
                } else if let entry {
                    Text(entry.subtitle).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)

            HStack(spacing: Space.xs) {
                Button {
                    withMotion(Motion.quick) { store.config.wallpaperMode = on ? .off : c.lastActiveMode }
                } label: {
                    Label(on ? tr("Pause") : tr("Turn on"), systemImage: on ? "pause.fill" : "play.fill")
                }
                .buttonStyle(SecondaryButtonStyle())
                .help(on ? tr("Turn off live wallpaper and return to your regular macOS wallpaper") : tr("Turn live wallpaper back on"))
                .accessibilityLabel(on ? tr("Pause live wallpaper") : tr("Resume live wallpaper"))

                Button(action: onCustomize) { Label(tr("Customize"), systemImage: "slider.horizontal.3") }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(entry == nil)
            }
            .fixedSize()
        }
        .padding(Space.sm)
        .card()
    }
}

// MARK: - Details

struct LibraryDetails: View {
    let entry: LibraryEntry
    @EnvironmentObject var store: Store

    var body: some View {
        let c = store.config
        let active = entry.isActive(c)

        VStack(alignment: .leading, spacing: Space.sm) {
            preview
                .aspectRatio(16 / 10, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Theme.border))
                .accessibilityHidden(true)
            Text(entry.subtitle).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                withMotion(Motion.quick) { entry.apply() }
            } label: {
                Label(active ? tr("In use") : tr("Set as wallpaper"), systemImage: active ? "checkmark" : "photo.badge.checkmark")
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(active || !ready)
            if !ready {
                hint(readyHint)
            } else if entry.title == "Nebula" {
                hint(tr("Try moving the pointer or clicking in the preview."))
            }
        }

        sourceSections

        if usesColors {
            DetailGroup(title: tr("Customize"),
                        footer: tr("Colors and speed are shared by all styles. Higher quality uses more battery.")) {
                colorRow(tr("Primary color"), \.color1)
                colorRow(tr("Secondary color"), \.color2)
                colorRow(tr("Background color"), \.color3)
                speedControl
                SettingColumn(title: tr("Quality")) {
                    SegmentedControl(label: tr("Quality"), selection: $store.config.renderScale,
                                     options: [(0.5, tr("Power saving")), (1.0, tr("Balanced")), (2.0, tr("Maximum"))])
                }
                Button(tr("Reset colors and speed")) {
                    let d = Config.defaultColors
                    store.config.color1 = d.0; store.config.color2 = d.1; store.config.color3 = d.2
                    store.config.speed = 1
                }
                .buttonStyle(SecondaryButtonStyle(fullWidth: true))
            }
        } else if entry.isInstalled && !entry.isVideo {
            // Community wallpapers keep their creator's colors; only the speed can change (videos allow neither)
            DetailGroup(title: tr("Customize")) { speedControl }
        }

        if case .installed(let w) = entry.kind {
            DetailGroup(title: tr("Info"), footer: w.isVideo ? tr("Plays muted and looped.") : nil) {
                if w.isVideo {
                    infoRow(tr("Type"), tr("Video"))
                    if let credit = w.info?.credit, !credit.isEmpty { infoRow(tr("Credit"), credit) }
                    if let license = w.info?.license, !license.isEmpty { infoRow(tr("License"), license) }
                }
                infoRow(tr("Creator"), w.manifest.author)
                infoRow(tr("Version"), String(w.manifest.version))
                infoRow(tr("Size"), ByteCountFormatter.string(fromByteCount: Int64(w.manifest.sizeBytes), countStyle: .file))
                StatusRow(kind: .ok, title: tr("Security"), subtitle: tr("Signature verified · Offline"))
                if w.isVideo, let s = w.info?.sourceUrl, let u = URL(string: s), ["https", "http"].contains(u.scheme ?? "") {
                    Button(tr("View source")) { NSWorkspace.shared.open(u) }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                }
            }
            Button(role: .destructive) { Community.shared.requestRemove(w) } label: {
                Label(tr("Remove from Mac…"), systemImage: "trash")
            }
            .buttonStyle(SecondaryButtonStyle(fullWidth: true, tint: Theme.destructiveText))
        }
    }

    private var speedControl: some View {
        SettingColumn(title: tr("Speed")) {
            HStack(spacing: Space.xs) {
                Image(systemName: "tortoise.fill").foregroundStyle(Theme.textSecondary).accessibilityLabel(tr("Slow"))
                Slider(value: $store.config.speed, in: 0.2...3).labelsHidden().controlSize(.small)
                    .accessibilityLabel(tr("Speed"))
                    .accessibilityValue(String(format: "%.1f×", store.config.speed))
                Image(systemName: "hare.fill").foregroundStyle(Theme.textSecondary).accessibilityLabel(tr("Fast"))
            }
        }
    }

    private func hint(_ s: String) -> some View {
        Text(s).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
    }

    private func colorRow(_ title: String, _ kp: WritableKeyPath<Config, RGBA>) -> some View {
        SettingRow(title: title) {
            ColorPicker(title, selection: store.binding(kp), supportsOpacity: false).labelsHidden()
        }
    }

    private func infoRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
            Spacer(minLength: Space.sm)
            Text(value).font(TypeScale.secondaryMedium).foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Preview

    @ViewBuilder
    private var preview: some View {
        let c = store.config
        let params = Shaders.params(c)
        switch entry.kind {
        case .builtin(let o):
            switch o.mode {
            case .interactive:
                if let url = BuiltinWallpaper.url {
                    WebWallpaper(source: .url(url), params: params, isDesktop: false, onReady: snapshot)
                        .id(entry.id)
                }
            case .preset:
                WebWallpaper(source: .html(Shaders.html(fragment: Shaders.source(for: o.preset ?? .aurora), scale: 0.6)),
                             params: params, isDesktop: false, onReady: snapshot)
                    .id(entry.id)
            case .video:
                if c.videoPath.isEmpty { PlaceholderThumb(symbol: "film.fill") }
                else { VideoWallpaper(url: URL(fileURLWithPath: c.videoPath)).id(c.videoPath) }
            case .web:
                if let url = WallpaperRoot.resolve(c.webURL) {
                    WebWallpaper(source: .url(url), params: "{}", isDesktop: false, offline: false).id(url)
                } else {
                    PlaceholderThumb(symbol: "globe")
                }
            case .off, .installed:
                PlaceholderThumb(symbol: "photo")
            }
        case .installed(let w):
            if w.isVideo {
                VideoWallpaper(url: w.videoURL).id(entry.id)
            } else {
                WebWallpaper(source: .localHTML(w.indexURL), params: Shaders.speedOnly(c), isDesktop: false).id(entry.id)
            }
        }
    }

    /// Update the grid preview from the live preview (current colors)
    private func snapshot(_ wv: WKWebView) {
        Thumbnails.shared.capture(entry.id, from: wv)
    }

    @ViewBuilder
    private var sourceSections: some View {
        if case .builtin(let o) = entry.kind {
            switch o.mode {
            case .video:
                DetailGroup(title: tr("Video"), footer: tr("Loops silently. Supports MP4 and MOV.")) {
                    SettingColumn(title: tr("Video file"),
                                  subtitle: store.config.videoPath.isEmpty ? nil : (store.config.videoPath as NSString).lastPathComponent) {
                        Button(store.config.videoPath.isEmpty ? tr("Choose file…") : tr("Change file…")) {
                            if let u = chooseFile([.movie]) { store.config.videoPath = u.path; entry.apply() }
                        }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                        .help(store.config.videoPath)
                    }
                }
            case .web:
                DetailGroup(title: tr("Website"),
                            footer: tr("The page responds to pointer movement and clicks on the desktop. This mode can access the internet, so use only websites you trust.")) {
                    SettingColumn(title: tr("Web address")) {
                        TextField(tr("Web address"), text: $store.config.webURL, prompt: Text(verbatim: "https://example.com"))
                            .textFieldStyle(.plain)
                            .font(TypeScale.secondary)
                            .padding(.horizontal, Space.sm).frame(height: 30)
                            .background(Theme.background, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).strokeBorder(Theme.border))
                    }
                    Button(tr("Choose local HTML file…")) {
                        if let u = chooseFile([.html]) { store.config.webURL = u.path }
                    }
                    .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                }
            default:
                EmptyView()
            }
        }
    }

    /// Colors apply only to the built-in styles (Nebula/presets)
    private var usesColors: Bool {
        if case .builtin(let o) = entry.kind { return o.usesColors }
        return false
    }

    private var ready: Bool { entry.canApplyDirectly(store.config) }

    private var readyHint: String {
        guard case .builtin(let o) = entry.kind else { return "" }
        return o.mode == .video ? tr("Choose a video file to use it as your wallpaper.") : tr("Enter a web address or choose an HTML file first.")
    }
}

/// Group in the details column: small heading + card of rows
struct DetailGroup<Content: View>: View {
    let title: String
    var footer: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(title).font(TypeScale.bodySemibold).foregroundStyle(Theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: Space.sm) { content }
                .padding(Space.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .card(fill: Theme.surfaceRaised)
            if let footer {
                Text(footer).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - Thumbnails

/// Previews of the built-in styles: captured from the live preview in the details panel and cached locally
@MainActor
final class Thumbnails: ObservableObject {
    static let shared = Thumbnails()
    @Published private var images: [String: NSImage] = [:]

    private var cacheDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("com.macwallpaperpro.app/Thumbnails", isDirectory: true)
    }

    private func file(_ id: String) -> URL {
        cacheDir.appendingPathComponent(id.replacingOccurrences(of: ":", with: "_") + ".png")
    }

    /// Drop the preview when colors/speed differ from when it was captured
    func sync(signature: String) {
        let key = "MacWallpaperPro.thumbSignature"
        guard UserDefaults.standard.string(forKey: key) != signature else { return }
        UserDefaults.standard.set(signature, forKey: key)
        try? FileManager.default.removeItem(at: cacheDir)
        images.removeAll()
        bundledDisabled = true
    }

    private var bundledDisabled = false

    func image(_ id: String) -> NSImage? {
        if let img = images[id] { return img }
        let bundled = Bundle.main.url(forResource: id.replacingOccurrences(of: "b:", with: ""), withExtension: "png",
                                      subdirectory: "Thumbnails")
        guard let img = NSImage(contentsOf: file(id)) ?? (bundledDisabled ? nil : bundled.flatMap(NSImage.init(contentsOf:)))
        else { return nil }
        DispatchQueue.main.async { self.images[id] = img }
        return img
    }

    func capture(_ id: String, from wv: WKWebView) {
        let cfg = WKSnapshotConfiguration()
        cfg.snapshotWidth = 640
        wv.takeSnapshot(with: cfg) { [weak self] img, _ in
            MainActor.assumeIsolated {
                guard let self, let img, let tiff = img.tiffRepresentation,
                      let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
                try? FileManager.default.createDirectory(at: self.cacheDir, withIntermediateDirectories: true)
                try? png.write(to: self.file(id))
                self.images[id] = img
            }
        }
    }
}

/// Renders missing style previews one at a time, invisibly behind the Library page
struct ThumbnailWarmer: View {
    let entries: [LibraryEntry]
    @EnvironmentObject var store: Store
    @ObservedObject private var thumbs = Thumbnails.shared

    var body: some View {
        if let e = entries.first(where: { thumbs.image($0.id) == nil }), case .builtin(let o) = e.kind {
            Group {
                if o.mode == .interactive, let url = BuiltinWallpaper.url {
                    WebWallpaper(source: .url(url), params: Shaders.params(store.config), isDesktop: false,
                                 onReady: { Thumbnails.shared.capture(e.id, from: $0) })
                } else {
                    WebWallpaper(source: .html(Shaders.html(fragment: Shaders.source(for: o.preset ?? .aurora), scale: 0.6)),
                                 params: Shaders.params(store.config), isDesktop: false,
                                 onReady: { Thumbnails.shared.capture(e.id, from: $0) })
                }
            }
            .id(e.id)
            .frame(width: 480, height: 300)
            .opacity(0.01)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}
