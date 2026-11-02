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
        case .installed(let w): "โดย \(w.manifest.author)"
        }
    }

    var isCustom: Bool {
        if case .builtin(let o) = kind { return [.video, .web, .shader].contains(o.mode) }
        return false
    }

    var isInstalled: Bool {
        if case .installed = kind { return true }
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
        case .all: "ทั้งหมด"
        case .builtIn: "มากับแอป"
        case .community: "จาก Community"
        case .custom: "สร้างเอง"
        }
    }
}

// MARK: - Library

struct LibraryView: View {
    @EnvironmentObject var store: Store
    @ObservedObject private var community = Community.shared
    @ObservedObject private var thumbs = Thumbnails.shared
    @State private var selection: String?
    @State private var filter: LibraryFilter = .all
    @State private var search = ""
    @State private var showInspector = true
    @State private var desktopIconsVisible = LibraryView.readDesktopIcons()

    private var allEntries: [LibraryEntry] {
        StyleOption.all.map { LibraryEntry(kind: .builtin($0)) } + community.installed.map { LibraryEntry(kind: .installed($0)) }
    }

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

    private var selected: LibraryEntry? {
        let all = allEntries
        return all.first { $0.id == selection } ?? all.first { $0.isActive(store.config) } ?? all.first
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Picker("ตัวกรอง", selection: $filter) {
                    ForEach(LibraryFilter.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                if store.config.wallpaperMode == .off { pausedBanner }
                if filter == .all && search.isEmpty {
                    section("มากับแอป", entries(.builtIn))
                    section("จาก Community", entries(.community), empty: communityEmpty)
                    section("สร้างเอง", entries(.custom))
                } else {
                    let list = entries(filter)
                    if list.isEmpty {
                        ContentUnavailableView.search(text: search).frame(maxWidth: .infinity, minHeight: 300)
                    } else {
                        grid(list)
                    }
                }
            }
            .padding(20)
        }
        .background { ThumbnailWarmer(entries: allEntries.filter { !$0.isCustom && !$0.isInstalled }) }
        .task(id: Shaders.params(store.config)) {
            // เปลี่ยนสีแล้วหยุดปรับ 1 วินาที → สร้างภาพตัวอย่างใหม่ตามสีปัจจุบัน
            try? await Task.sleep(for: .seconds(1))
            if !Task.isCancelled { Thumbnails.shared.sync(signature: Shaders.params(store.config)) }
        }
        .searchable(text: $search, placement: .toolbar, prompt: "ค้นหาในคลัง")
        .toolbar { toolbar }
        .inspector(isPresented: $showInspector) {
            Group {
                if let e = selected { LibraryInspector(entry: e) } else { Color.clear }
            }
            .inspectorColumnWidth(min: 300, ideal: 340, max: 440)
        }
        .onAppear {
            if selection == nil { selection = allEntries.first { $0.isActive(store.config) }?.id }
        }
    }

    // MARK: Sections

    @ViewBuilder
    private func section(_ title: String, _ list: [LibraryEntry], empty: AnyView? = nil) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.title3.weight(.semibold))
            if list.isEmpty, let empty { empty } else { grid(list) }
        }
    }

    private func grid(_ list: [LibraryEntry]) -> some View {
        LazyVGrid(columns: galleryColumns, spacing: 16) {
            ForEach(list) { e in
                GalleryTile(title: e.title, subtitle: e.subtitle,
                            selected: selected?.id == e.id, active: e.isActive(store.config)) {
                    thumbnail(e)
                } badge: {
                    EmptyView()
                }
                .onTapGesture {
                    selection = e.id
                    // คลิกเดียวใช้ทันทีแบบ Wallpaper Engine (ยกเว้นแบบสร้างเองที่ยังไม่ได้ตั้งไฟล์)
                    if canApplyDirectly(e) { withAnimation(.snappy(duration: 0.2)) { e.apply() } }
                }
                .contextMenu { contextMenu(e) }
            }
        }
    }

    private var communityEmpty: AnyView {
        AnyView(
            HStack(spacing: 14) {
                Image(systemName: "sparkles").font(.title2).foregroundStyle(.pink)
                VStack(alignment: .leading, spacing: 2) {
                    Text("ยังไม่มี wallpaper จาก Community").font(.callout.weight(.semibold))
                    Text("เลือกดูผลงานจากผู้สร้างคนอื่น ทั้งฟรีและเสียเงิน").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("ไปที่ Discover") { Navigator.shared.page = .discover }
            }
            .padding(14)
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        )
    }

    private var pausedBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: "pause.circle.fill").font(.title2).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text("ภาพพื้นหลังเคลื่อนไหวปิดอยู่").font(.callout.weight(.semibold))
                Text("ตอนนี้ใช้ภาพพื้นหลังเดิมของ macOS คลิกภาพใดก็ได้เพื่อเปิดอีกครั้ง").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("เปิด") { store.config.wallpaperMode = store.config.lastActiveMode }.buttonStyle(.borderedProminent)
        }
        .padding(14)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder
    private func thumbnail(_ e: LibraryEntry) -> some View {
        switch e.kind {
        case .builtin(let o):
            if let img = thumbs.image(e.id) {
                Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
            } else {
                PlaceholderThumb(symbol: o.symbol, colors: o.usesColors
                                 ? [store.config.color2.color, store.config.color3.color]
                                 : [Color(white: 0.32), Color(white: 0.16)])
            }
        case .installed(let w):
            if let img = NSImage(contentsOf: w.thumbURL) {
                Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
            } else {
                PlaceholderThumb(symbol: "photo")
            }
        }
    }

    @ViewBuilder
    private func contextMenu(_ e: LibraryEntry) -> some View {
        Button("ใช้เป็นภาพพื้นหลัง") { e.apply() }
        if case .installed(let w) = e.kind {
            Button("ดูใน Community") { NSWorkspace.shared.open(community.webPage(for: w.id)) }
            Button("แสดงในไฟนด์เดอร์") { NSWorkspace.shared.activateFileViewerSelecting([w.indexURL]) }
        }
    }

    private func canApplyDirectly(_ e: LibraryEntry) -> Bool {
        guard case .builtin(let o) = e.kind else { return true }
        switch o.mode {
        case .video: return !store.config.videoPath.isEmpty
        case .web: return WallpaperRoot.resolve(store.config.webURL) != nil
        default: return true
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            let on = store.config.wallpaperMode != .off
            Button {
                store.config.wallpaperMode = on ? .off : store.config.lastActiveMode
            } label: {
                Label(on ? "ปิดภาพเคลื่อนไหว" : "เปิดภาพเคลื่อนไหว", systemImage: on ? "pause.circle" : "play.circle")
            }
            .help(on ? "ปิดภาพเคลื่อนไหว แล้วกลับไปใช้ภาพพื้นหลังเดิมของ macOS" : "เปิดภาพเคลื่อนไหวอีกครั้ง")

            Menu {
                Toggle("แสดงไอคอนบนเดสก์ท็อป", isOn: Binding(get: { desktopIconsVisible }, set: setDesktopIcons))
                Button("โหลดภาพพื้นหลังใหม่") { WallpaperManager.shared.reload() }
                Divider()
                Button("คืนค่าสีและความเร็วเริ่มต้น") {
                    let d = Config.defaultColors
                    store.config.color1 = d.0; store.config.color2 = d.1; store.config.color3 = d.2
                    store.config.speed = 1
                }
            } label: {
                Label("ตัวเลือกเพิ่มเติม", systemImage: "ellipsis.circle")
            }

            Button { showInspector.toggle() } label: {
                Label("แผงรายละเอียด", systemImage: "sidebar.right")
            }
            .help("แสดงหรือซ่อนแผงรายละเอียด")
        }
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

// MARK: - Inspector

struct LibraryInspector: View {
    let entry: LibraryEntry
    @EnvironmentObject var store: Store
    @State private var confirmDelete = false

    var body: some View {
        let c = store.config
        let active = entry.isActive(c)
        Form {
            Section {
                preview
                    .aspectRatio(16 / 10, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .listRowInsets(EdgeInsets(top: 10, leading: 10, bottom: 4, trailing: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title).font(.title3.weight(.semibold))
                    Text(entry.subtitle).foregroundStyle(.secondary)
                }
                Button {
                    withAnimation(.snappy(duration: 0.2)) { entry.apply() }
                } label: {
                    Label(active ? "กำลังใช้อยู่" : "ใช้เป็นภาพพื้นหลัง", systemImage: active ? "checkmark" : "photo.badge.checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(active || !ready)
            } footer: {
                if !ready { Text(readyHint).foregroundStyle(.secondary) }
                else if entry.title == "Nebula" { Text("ลองขยับเมาส์หรือคลิกในตัวอย่างได้เลย") }
            }

            sourceSections

            if usesColors {
                Section {
                    ColorPicker("สีหลัก", selection: store.binding(\.color1), supportsOpacity: false)
                    ColorPicker("สีรอง", selection: store.binding(\.color2), supportsOpacity: false)
                    ColorPicker("สีพื้นหลัง", selection: store.binding(\.color3), supportsOpacity: false)
                    LabeledContent("ความเร็ว") {
                        Slider(value: $store.config.speed, in: 0.2...3) {
                            EmptyView()
                        } minimumValueLabel: {
                            Image(systemName: "tortoise.fill").accessibilityLabel("ช้า")
                        } maximumValueLabel: {
                            Image(systemName: "hare.fill").accessibilityLabel("เร็ว")
                        }
                    }
                    Picker("คุณภาพ", selection: $store.config.renderScale) {
                        Text("ประหยัดพลังงาน").tag(0.5)
                        Text("สมดุล").tag(1.0)
                        Text("คมชัดสูงสุด").tag(2.0)
                    }
                } header: {
                    Text("ปรับแต่ง")
                } footer: {
                    Text(entry.isInstalled
                         ? "สีจะมีผลเฉพาะกับ wallpaper ที่ผู้สร้างรองรับการปรับสี"
                         : "สีและความเร็วใช้ร่วมกันทุกสไตล์ · คุณภาพสูงขึ้นใช้แบตเตอรี่มากขึ้น")
                }
            }

            if case .installed(let w) = entry.kind {
                Section("ข้อมูล") {
                    LabeledContent("ผู้สร้าง", value: w.manifest.author)
                    LabeledContent("เวอร์ชัน", value: String(w.manifest.version))
                    LabeledContent("ขนาด", value: ByteCountFormatter.string(fromByteCount: Int64(w.manifest.sizeBytes), countStyle: .file))
                    LabeledContent("ความปลอดภัย") {
                        Label("ตรวจลายเซ็นแล้ว · ออฟไลน์", systemImage: "checkmark.shield.fill").foregroundStyle(.green)
                    }
                }
                Section {
                    Button("ลบออกจากเครื่อง…", role: .destructive) { confirmDelete = true }
                }
                .confirmationDialog("ลบ “\(w.manifest.title)” ออกจากเครื่อง?", isPresented: $confirmDelete) {
                    Button("ลบ", role: .destructive) { Community.shared.uninstall(w) }
                } message: {
                    Text("ติดตั้งใหม่จาก Discover ได้ทุกเมื่อ")
                }
            }
        }
        .formStyle(.grouped)
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
            case .shader:
                WebWallpaper(source: .html(Shaders.html(fragment: c.customShader, scale: 0.6)), params: params, isDesktop: false)
                    .id(entry.id + c.customShader.hashValue.description)
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
            WebWallpaper(source: .localHTML(w.indexURL), params: params, isDesktop: false).id(entry.id)
        }
    }

    /// อัปเดตภาพตัวอย่างในตารางจากตัวอย่างสด (ใช้สีปัจจุบัน)
    private func snapshot(_ wv: WKWebView) {
        Thumbnails.shared.capture(entry.id, from: wv)
    }

    @ViewBuilder
    private var sourceSections: some View {
        if case .builtin(let o) = entry.kind {
            switch o.mode {
            case .video:
                Section {
                    LabeledContent("ไฟล์วิดีโอ") {
                        Button(store.config.videoPath.isEmpty ? "เลือกไฟล์…" : "เปลี่ยนไฟล์…") {
                            if let u = chooseFile([.movie]) { store.config.videoPath = u.path; entry.apply() }
                        }
                    }
                    if !store.config.videoPath.isEmpty {
                        Text((store.config.videoPath as NSString).lastPathComponent)
                            .foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                            .help(store.config.videoPath)
                    }
                } header: { Text("วิดีโอ") } footer: { Text("เล่นวนซ้ำแบบปิดเสียง รองรับ MP4 และ MOV") }
            case .web:
                Section {
                    TextField("ที่อยู่เว็บ", text: $store.config.webURL, prompt: Text("https://example.com"))
                    Button("เลือกไฟล์ HTML ในเครื่อง…") {
                        if let u = chooseFile([.html]) { store.config.webURL = u.path }
                    }
                } header: { Text("เว็บไซต์") } footer: {
                    Text("หน้าเว็บจะรับการขยับเมาส์และการคลิกบนเดสก์ท็อปได้ โหมดนี้ต่ออินเทอร์เน็ตได้ จึงควรใช้เฉพาะเว็บที่เชื่อถือได้")
                }
            case .shader:
                ShaderEditorSection()
            default:
                EmptyView()
            }
        }
    }

    private var usesColors: Bool {
        switch entry.kind {
        case .builtin(let o): o.usesColors
        case .installed: true
        }
    }

    private var ready: Bool {
        guard case .builtin(let o) = entry.kind else { return true }
        switch o.mode {
        case .video: return !store.config.videoPath.isEmpty
        case .web: return WallpaperRoot.resolve(store.config.webURL) != nil
        default: return true
        }
    }

    private var readyHint: String {
        guard case .builtin(let o) = entry.kind else { return "" }
        return o.mode == .video ? "เลือกไฟล์วิดีโอก่อน แล้วจึงใช้เป็นภาพพื้นหลังได้" : "ใส่ที่อยู่เว็บหรือเลือกไฟล์ HTML ก่อน"
    }
}

// MARK: - Thumbnails

/// ภาพตัวอย่างของสไตล์ที่มากับแอป: เก็บจากตัวอย่างสดในแผงรายละเอียด แล้วแคชไว้ในเครื่อง
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

    /// ล้างภาพตัวอย่างเมื่อสี/ความเร็วต่างจากตอนที่สร้างภาพไว้
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

/// เรนเดอร์ภาพตัวอย่างของสไตล์ที่ยังไม่มีภาพทีละอัน แบบมองไม่เห็นอยู่หลังหน้าคลัง
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
