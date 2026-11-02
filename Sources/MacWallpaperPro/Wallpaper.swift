import AVFoundation
import AppKit
import Combine
import SwiftUI
import WebKit

// MARK: - Manager: one window per display at desktop level (below the desktop icons)

@MainActor
final class WallpaperManager {
    static let shared = WallpaperManager()
    private var windows: [NSWindow] = []
    private var cancellables = Set<AnyCancellable>()
    private let webViews = NSHashTable<WKWebView>.weakObjects()

    func start() {
        // Rebuild once the network-blocking rules are ready, so every web view has them from creation
        Task {
            await WallpaperSandbox.prepare()
            let c = Store.shared.config
            self.rebuild(visible: c.wallpaperMode != .off || c.showClock)
        }
        Store.shared.$config
            .map { $0.wallpaperMode != .off || $0.showClock }
            .removeDuplicates()
            .sink { [weak self] visible in self?.rebuild(visible: visible) }
            .store(in: &cancellables)
        startCursorFeed()

        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in
                self?.rebuild(visible: Store.shared.config.wallpaperMode != .off || Store.shared.config.showClock)
            }
            .store(in: &cancellables)
    }

    func register(_ wv: WKWebView) { webViews.add(wv) }

    func reload() { webViews.allObjects.forEach { $0.reload() } }

    // MARK: Cursor feed
    // Wallpaper windows get no mouse events (they're at the very back), so read the cursor position from the system
    // and forward it to the page as mousemove/mousedown/mouseup/click

    private var cursorTimer: Timer?
    private var clickMonitor: Any?
    private var lastMouse = NSPoint(x: -1, y: -1)

    private func startCursorFeed() {
        guard cursorTimer == nil else { return }
        cursorTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { _ in
            MainActor.assumeIsolated { WallpaperManager.shared.tickCursor() }
        }
        // A global mouse-event monitor needs no Accessibility permission
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp]) { e in
            let type = e.type == .leftMouseDown ? "down" : "up"
            MainActor.assumeIsolated {
                let p = NSEvent.mouseLocation
                if WallpaperManager.isDesktop(at: p) { WallpaperManager.shared.send(p, type) }
            }
        }
    }

    private func tickCursor() {
        guard !webViews.allObjects.isEmpty else { return }
        let p = NSEvent.mouseLocation
        guard p != lastMouse else { return }
        lastMouse = p
        send(p, "move")
    }

    private func send(_ p: NSPoint, _ type: String) {
        for wv in webViews.allObjects {
            guard let screen = wv.window?.screen, NSMouseInRect(p, screen.frame, false) else { continue }
            let x = p.x - screen.frame.minX, y = screen.frame.maxY - p.y
            wv.evaluateJavaScript("window.__mwpCursor&&__mwpCursor(\(x),\(y),'\(type)')")
        }
    }

    /// Whether this click really landed on the Desktop (no normal window/menu bar/Dock covering it)
    private static func isDesktop(at p: NSPoint) -> Bool {
        let primaryTop = NSScreen.screens.first?.frame.maxY ?? 0
        let cg = CGPoint(x: p.x, y: primaryTop - p.y)
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                as? [[String: Any]] else { return true }
        for w in list {
            guard let layer = w[kCGWindowLayer as String] as? Int, layer >= 0,
                  (w[kCGWindowAlpha as String] as? Double ?? 1) > 0.01,
                  let b = w[kCGWindowBounds as String] as? NSDictionary,
                  let r = CGRect(dictionaryRepresentation: b) else { continue }
            if r.contains(cg) { return false }
        }
        return true
    }

    private func rebuild(visible: Bool) {
        windows.forEach { $0.orderOut(nil) }
        windows.removeAll()
        guard visible else { return }
        for screen in NSScreen.screens {
            let w = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
            w.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
            w.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
            w.ignoresMouseEvents = true
            w.isOpaque = false
            w.backgroundColor = .clear
            w.hasShadow = false
            w.isReleasedWhenClosed = false
            w.contentView = NSHostingView(rootView: WallpaperRoot().environmentObject(Store.shared))
            w.setFrame(screen.frame, display: true)
            w.orderBack(nil)
            windows.append(w)
        }
    }

    // MARK: Snapshot → Desktop + Lock Screen image

    private static func frame(of url: URL) async -> NSImage? {
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        gen.appliesPreferredTrackTransform = true
        guard let cg = try? await gen.image(at: CMTime(seconds: 1, preferredTimescale: 600)).image else { return nil }
        return NSImage(cgImage: cg, size: .zero)
    }

    struct SnapshotResult { let success: Bool; let path: String?; let message: String }

    func applySnapshotAsSystemWallpaper() async -> SnapshotResult {
        let cfg = Store.shared.config
        var image: NSImage?
        let installedVideo = cfg.wallpaperMode == .installed
            ? Community.shared.installedWallpaper(cfg.installedID).flatMap { $0.isVideo ? $0.videoURL : nil } : nil
        switch cfg.wallpaperMode {
        case .installed where installedVideo != nil:
            image = await Self.frame(of: installedVideo!)
        case .interactive, .installed, .preset, .web:
            if let wv = webViews.allObjects.first {
                image = try? await wv.takeSnapshot(configuration: nil)
            }
        case .video:
            image = await Self.frame(of: URL(fileURLWithPath: cfg.videoPath))
        case .off:
            return SnapshotResult(success: false, path: nil, message: tr("Live wallpaper is off. Turn it on and try again."))
        }
        guard let image, let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:])
        else { return SnapshotResult(success: false, path: nil, message: tr("Couldn’t capture the image. Try again.")) }

        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Pictures/MacWallpaperPro")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // A new file name every time, because macOS caches images by path
        let url = dir.appendingPathComponent("wallpaper-\(Int(Date().timeIntervalSince1970)).png")
        do {
            try png.write(to: url)
            for s in NSScreen.screens { try NSWorkspace.shared.setDesktopImageURL(url, for: s, options: [:]) }
            return SnapshotResult(success: true, path: url.path, message: "")
        } catch {
            return SnapshotResult(success: false, path: nil, message: tr("Couldn’t set the image: %@", error.localizedDescription))
        }
    }
}

// MARK: - Views

struct WallpaperRoot: View {
    @EnvironmentObject var store: Store

    var body: some View {
        let c = store.config
        ZStack {
            switch c.wallpaperMode {
            case .off:
                Color.clear
            case .interactive:
                if let url = BuiltinWallpaper.url {
                    WebWallpaper(source: .url(url), params: Shaders.params(c))
                } else {
                    Color.black
                }
            case .installed:
                if let w = Community.shared.installedWallpaper(c.installedID), w.isVideo {
                    // Community videos play directly in AVPlayer (not WebKit), muted and looping
                    VideoWallpaper(url: w.videoURL)
                } else if WallpaperSandbox.ruleList != nil, let w = Community.shared.installedWallpaper(c.installedID) {
                    // No network-blocking rules = never load anything from the Community
                    WebWallpaper(source: .localHTML(w.indexURL), params: Shaders.speedOnly(c), offline: true)
                } else {
                    Color.black
                }
            case .preset:
                WebWallpaper(source: .html(Shaders.html(fragment: Shaders.source(for: c.preset), scale: c.renderScale)),
                             params: Shaders.params(c))
            case .video:
                if c.videoPath.isEmpty {
                    Color.black
                } else {
                    VideoWallpaper(url: URL(fileURLWithPath: c.videoPath))
                }
            case .web:
                if let url = Self.resolve(c.webURL) {
                    WebWallpaper(source: .url(url), params: "{}", offline: false)
                } else {
                    Color.black
                }
            }
            if c.showClock { ClockWidget(cfg: c) }
        }
        .ignoresSafeArea()
        .localized()
    }

    static func resolve(_ s: String) -> URL? {
        let t = s.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("/") { return URL(fileURLWithPath: t) }
        guard let u = URL(string: t) else { return nil }
        if u.isFileURL { return u }
        guard let host = u.host, !host.isEmpty else { return nil }
        return u
    }
}

struct ClockWidget: View {
    let cfg: Config
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            VStack(alignment: horizontal, spacing: 4) {
                Text(ctx.date, format: .dateTime.hour(.defaultDigits(amPM: .abbreviated)).minute(.twoDigits))
                    .font(cfg.font(cfg.clockSize, .semibold))
                    .monospacedDigit()
                Text(ctx.date, format: .dateTime.weekday(.wide).day().month(.wide))
                    .font(cfg.font(cfg.clockSize * 0.22, .medium))
                    .opacity(0.8)
            }
            .foregroundStyle(cfg.clockColor.color)
            .shadow(color: .black.opacity(0.35), radius: 18, y: 6)
        }
        .padding(80)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: cfg.clockPosition.alignment)
    }

    private var horizontal: HorizontalAlignment {
        switch cfg.clockPosition {
        case .topLeft, .bottomLeft: .leading
        case .topRight, .bottomRight: .trailing
        case .center: .center
        }
    }
}

struct WebWallpaper: NSViewRepresentable {
    enum Source: Equatable { case html(String), url(URL), localHTML(URL) }
    let source: Source
    let params: String
    /// false = a preview in Settings (no system cursor input, not used for capture)
    var isDesktop = true
    /// true = block all network access (used for everything except the user's own website mode)
    var offline = true
    /// Called once the page has loaded and rendered for a moment (used to capture previews)
    var onReady: ((WKWebView) -> Void)? = nil

    final class Coordinator: NSObject, WKNavigationDelegate {
        var source: Source?
        var params = ""
        var onReady: ((WKWebView) -> Void)?
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.evaluateJavaScript("window.setP&&setP(\(params))")
            guard let onReady else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak webView] in
                if let webView, webView.window != nil { onReady(webView) }
            }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.userContentController.addUserScript(
            WKUserScript(source: Self.cursorBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if offline, let rules = WallpaperSandbox.ruleList { cfg.userContentController.add(rules) }
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.navigationDelegate = context.coordinator
        if isDesktop { WallpaperManager.shared.register(wv) }
        return wv
    }

    /// Turns the app's cursor into standard DOM events, so ordinary HTML pages just work
    private static let cursorBridge = """
    window.__mwpCursor = function (x, y, type) {
      const t = document.elementFromPoint(x, y) || document.body || document;
      const o = { clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true, cancelable: true, view: window, button: 0, buttons: type === 'down' ? 1 : 0 };
      const fire = (P, M) => { t.dispatchEvent(new PointerEvent(P, Object.assign({ pointerType: 'mouse', isPrimary: true }, o))); t.dispatchEvent(new MouseEvent(M, o)); };
      if (type === 'move') fire('pointermove', 'mousemove');
      else if (type === 'down') fire('pointerdown', 'mousedown');
      else if (type === 'up') { fire('pointerup', 'mouseup'); t.dispatchEvent(new MouseEvent('click', o)); }
    };
    """

    func updateNSView(_ wv: WKWebView, context: Context) {
        let co = context.coordinator
        co.params = params
        co.onReady = onReady
        if co.source != source {
            co.source = source
            switch source {
            case .html(let html): wv.loadHTMLString(html, baseURL: nil)
            case .localHTML(let url):
                // Always force UTF-8 so files without a charset aren't garbled
                if let data = try? Data(contentsOf: url) {
                    wv.load(data, mimeType: "text/html", characterEncodingName: "utf-8", baseURL: url)
                }
            case .url(let url):
                if url.isFileURL {
                    wv.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
                } else {
                    wv.load(URLRequest(url: url))
                }
            }
        } else {
            wv.evaluateJavaScript("window.setP&&setP(\(params))")
        }
    }
}

final class PlayerView: NSView {
    let player = AVQueuePlayer()
    private var looper: AVPlayerLooper?
    private let playerLayer = AVPlayerLayer()
    var url: URL?

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer = CALayer()
        playerLayer.player = player
        playerLayer.videoGravity = .resizeAspectFill
        layer?.addSublayer(playerLayer)
        player.isMuted = true
    }

    required init?(coder: NSCoder) { fatalError() }

    func load(_ url: URL) {
        guard url != self.url else { return }
        self.url = url
        player.removeAllItems()
        looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
        player.play()
    }

    override func layout() {
        super.layout()
        playerLayer.frame = bounds
    }
}

struct VideoWallpaper: NSViewRepresentable {
    let url: URL
    func makeNSView(context: Context) -> PlayerView { PlayerView() }
    func updateNSView(_ v: PlayerView, context: Context) { v.load(url) }
}

enum BuiltinWallpaper {
    /// Wallpapers/nebula/index.html in the app bundle (or from the source tree when run with swift run)
    static var url: URL? {
        if let u = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Wallpapers/nebula") {
            return u
        }
        let src = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Wallpapers/nebula/index.html")
        return FileManager.default.fileExists(atPath: src.path) ? src : nil
    }
}
