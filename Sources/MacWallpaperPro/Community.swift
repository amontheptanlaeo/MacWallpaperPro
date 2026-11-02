import AppKit
import Combine
import CryptoKit
import Foundation
import WebKit

// MARK: - API types (see docs/ARCHITECTURE.md)

struct WallpaperSummary: Codable, Identifiable, Equatable {
    struct Author: Codable, Equatable { let id: String; let name: String }
    let id: String
    let title: String
    let author: Author
    let thumbUrl: String
    let downloads: Int
    let tags: [String]
    let createdAt: String
    /// nature, cartoon, cute, scifi, space, abstract
    let category: String?
    /// "html" | "video" (absent on servers that predate video support = html)
    let kind: String?

    var isVideo: Bool { kind == "video" }
}

/// Display-only fields (video credits): they are not covered by the signature, so they are only shown, never trusted
struct WallpaperDetailInfo: Codable, Equatable {
    let credit: String?
    let license: String?
    let sourceUrl: String?
}

struct WallpaperListResponse: Codable { let items: [WallpaperSummary]; let next: String? }

/// v1 (HTML): no format/kind, so it re-encodes byte for byte (nil optionals are not written)
/// v2 (video): format = 2, kind = "video", and the kind is part of the signed message
struct SignedManifest: Codable, Equatable {
    var format: Int? = nil
    var kind: String? = nil
    let id: String
    let version: Int
    let sha256: String
    let sizeBytes: Int
    let title: String
    let author: String
    let signature: String
}

struct APIErrorBody: Codable { struct E: Codable { let code: String; let message: String }; let error: E }

enum CommunityError: LocalizedError {
    case invalidID, badSignature, hashMismatch, tooLarge, videoTooLarge, server(String), network(String)

    var errorDescription: String? {
        switch self {
        case .invalidID: tr("Invalid wallpaper ID.")
        case .badSignature: tr("The file’s signature is invalid, so it wasn’t installed for your safety.")
        case .hashMismatch: tr("The downloaded file doesn’t match the original, so it wasn’t installed for your safety.")
        case .tooLarge: tr("The file is too large (maximum 10 MB).")
        case .videoTooLarge: tr("The video is too large (maximum 60 MB).")
        case .server(let m): m
        case .network(let m): tr("Can’t connect to the server: %@", m)
        }
    }
}

// MARK: - Security helpers

enum ManifestVerifier {
    /// The server's public key (Ed25519, raw 32 bytes)
    static let publicKeyBase64 = "4ACj7B0U1mZeAEoA9oiCy4JPSu3xO/CMuQqvRDYX604="
    static let maxBytes = 10 * 1024 * 1024
    static let maxVideoBytes = 60 * 1024 * 1024

    /// The signed kind: v1 is always html (an unsigned kind field is ignored), v2 is the kind inside the signature
    static func kind(of m: SignedManifest) -> WallpaperKind? {
        switch m.format {
        case nil: .html
        case 2: m.kind.flatMap(WallpaperKind.init(rawValue:))
        default: nil
        }
    }

    static func message(for m: SignedManifest) -> Data {
        if m.format == 2 {
            return Data(["macwallpaperpro-manifest-v2", m.id, String(m.version), m.kind ?? "", m.sha256.lowercased(), String(m.sizeBytes)]
                .joined(separator: "\n").utf8)
        }
        return Data(["macwallpaperpro-manifest-v1", m.id, String(m.version), m.sha256.lowercased(), String(m.sizeBytes)]
            .joined(separator: "\n").utf8)
    }

    static func verify(_ m: SignedManifest) -> Bool {
        guard kind(of: m) != nil else { return false }
        guard let keyData = Data(base64Encoded: publicKeyBase64),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData),
              let sig = Data(base64Encoded: m.signature) else { return false }
        return key.isValidSignature(sig, for: message(for: m))
    }

    static func sha256Hex(_ data: Data) -> String {
        hex(SHA256.hash(data: data))
    }

    static func hex(_ d: SHA256.Digest) -> String { d.map { String(format: "%02x", $0) }.joined() }

    /// Hash a large file in chunks without loading it all into memory
    static func sha256Hex(fileAt url: URL) -> String? {
        guard let h = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? h.close() }
        var hasher = SHA256()
        while let chunk = try? h.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        return hex(hasher.finalize())
    }

    /// Only safe characters are allowed (prevents path traversal)
    static func isSafeID(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 64 && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }
}

/// Blocks every request that isn't a local file: a wallpaper can't send data out or load outside code
@MainActor
enum WallpaperSandbox {
    private(set) static var ruleList: WKContentRuleList?

    static func prepare() async {
        let rules = """
        [{"trigger":{"url-filter":".*"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"^file:"},"action":{"type":"ignore-previous-rules"}},
         {"trigger":{"url-filter":"^data:"},"action":{"type":"ignore-previous-rules"}},
         {"trigger":{"url-filter":"^blob:"},"action":{"type":"ignore-previous-rules"}},
         {"trigger":{"url-filter":"^about:"},"action":{"type":"ignore-previous-rules"}}]
        """
        ruleList = try? await WKContentRuleListStore.default()
            .compileContentRuleList(forIdentifier: "mwp-offline-v1", encodedContentRuleList: rules)
    }
}

// MARK: - Installed wallpapers

enum WallpaperKind: String, Codable, Equatable {
    case html, video
    var fileName: String { self == .video ? "video.mp4" : "index.html" }
}

struct InstalledWallpaper: Identifiable, Equatable {
    let manifest: SignedManifest
    let folder: URL
    /// From the signature-verified manifest (v1 = html, v2 = the signed kind)
    let kind: WallpaperKind
    /// Video credit/license (info.json, display only)
    var info: WallpaperDetailInfo? = nil
    var id: String { manifest.id }
    var isVideo: Bool { kind == .video }
    var indexURL: URL { folder.appendingPathComponent("index.html") }
    var videoURL: URL { folder.appendingPathComponent("video.mp4") }
    var fileURL: URL { folder.appendingPathComponent(kind.fileName) }
    var thumbURL: URL { folder.appendingPathComponent("thumb") }
}

// MARK: - Model

@MainActor
final class Community: ObservableObject {
    static let shared = Community()

    @Published private(set) var items: [WallpaperSummary] = []
    @Published private(set) var installed: [InstalledWallpaper] = []
    @Published private(set) var loading = false
    @Published private(set) var loadingMore = false
    /// Cursor for the next page (nil = everything loaded)
    @Published private(set) var nextCursor: String?
    private var lastQuery: [URLQueryItem] = []
    @Published private(set) var loadError: String?
    @Published private(set) var installing: Set<String> = []
    @Published var notice: (text: String, isError: Bool)?
    /// A removal waiting for the user's confirmation (one dialog at the app root serves every entry point)
    @Published var pendingRemoval: InstalledWallpaper?
    @Published var confirmRemoveAll = false
    /// Bytes on disk per installed wallpaper id (refreshed on every scan)
    @Published private(set) var sizes: [String: Int64] = [:]

    /// The official MacWallpaperPro site; users can't change it
    static let officialURL = URL(string: "https://macwallpaper.elizos.com")!

    /// Developers can test against a local server with `MWP_COMMUNITY_URL=http://localhost:8787` (not in Settings)
    let baseURL: URL = ProcessInfo.processInfo.environment["MWP_COMMUNITY_URL"].flatMap(URL.init(string:)) ?? Community.officialURL

    static var libraryFolder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MacWallpaperPro/Wallpapers", isDirectory: true)
    }

    private init() {
        scanInstalled()
        cleanUpStorage()
    }

    // MARK: Browse

    func load(query: String = "", sort: String = "new", category: String? = nil, videosOnly: Bool = false) async {
        loading = true; loadError = nil
        defer { loading = false }
        var c = URLComponents(url: baseURL.appendingPathComponent("api/wallpapers"), resolvingAgainstBaseURL: false)!
        // kind=all: this app version can install videos (older versions send no kind and get HTML only)
        c.queryItems = [URLQueryItem(name: "sort", value: sort), URLQueryItem(name: "kind", value: videosOnly ? "video" : "all")]
            + (query.isEmpty ? [] : [URLQueryItem(name: "q", value: query)])
            + (category.map { [URLQueryItem(name: "category", value: $0)] } ?? [])
        lastQuery = c.queryItems ?? []
        do {
            let page: WallpaperListResponse = try await getJSON(c.url!)
            items = page.items
            nextCursor = page.next
        } catch {
            loadError = error.localizedDescription
            nextCursor = nil
        }
    }

    /// Next page of the current listing (same sort/filters), appended without duplicates
    func loadMore() async {
        guard let cursor = nextCursor, !loading, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        var c = URLComponents(url: baseURL.appendingPathComponent("api/wallpapers"), resolvingAgainstBaseURL: false)!
        c.queryItems = lastQuery + [URLQueryItem(name: "cursor", value: cursor)]
        do {
            let page: WallpaperListResponse = try await getJSON(c.url!)
            let seen = Set(items.map(\.id))
            items += page.items.filter { !seen.contains($0.id) }
            nextCursor = page.next
        } catch {
            notice = (error.localizedDescription, true)
        }
    }

    func thumbURL(_ w: WallpaperSummary) -> URL? { URL(string: w.thumbUrl, relativeTo: baseURL)?.absoluteURL }
    func webPage(for id: String) -> URL { baseURL.appendingPathComponent("community/w/\(id)") }

    /// Credit/license (used in the details panel)
    func detailInfo(id: String) async -> WallpaperDetailInfo? {
        guard ManifestVerifier.isSafeID(id) else { return nil }
        return try? await getJSON(baseURL.appendingPathComponent("api/wallpapers/\(id)"))
    }

    /// Title, author and thumbnail for the deep-link confirmation. Only from the configured server.
    func deepLinkPreview(id: String) async -> (title: String, author: String, image: NSImage?)? {
        guard ManifestVerifier.isSafeID(id),
              let w: WallpaperSummary = try? await getJSON(baseURL.appendingPathComponent("api/wallpapers/\(id)")),
              w.id == id
        else { return nil }
        var image: NSImage?
        if let url = thumbURL(w), url.host == baseURL.host, let (d, r) = try? await request(url), (200..<300).contains(r.statusCode) {
            image = NSImage(data: d)
        }
        return (w.title, w.author.name, image)
    }

    // MARK: Install

    func isInstalled(_ id: String) -> Bool { installed.contains { $0.id == id } }

    /// Install, then set it as the wallpaper right away
    func install(id: String, apply: Bool = true) async {
        guard ManifestVerifier.isSafeID(id) else { notice = (CommunityError.invalidID.localizedDescription, true); return }
        guard !installing.contains(id) else { return }
        installing.insert(id)
        defer { installing.remove(id) }
        do {
            let w = try await performInstall(id: id)
            scanInstalled()
            if apply { use(w) }
            notice = (tr("Installed “%@”.", w.manifest.title), false)
        } catch {
            notice = (error.localizedDescription, true)
        }
    }

    private func performInstall(id: String) async throws -> InstalledWallpaper {
        let manifest: SignedManifest = try await getJSON(baseURL.appendingPathComponent("api/wallpapers/\(id)/manifest"))
        guard manifest.id == id, ManifestVerifier.verify(manifest), let kind = ManifestVerifier.kind(of: manifest)
        else { throw CommunityError.badSignature }
        let limit = kind == .video ? ManifestVerifier.maxVideoBytes : ManifestVerifier.maxBytes
        guard manifest.sizeBytes <= limit else { throw kind == .video ? CommunityError.videoTooLarge : CommunityError.tooLarge }

        // Write to a temporary folder first, then swap it into place (atomic)
        let fm = FileManager.default
        try fm.createDirectory(at: Self.libraryFolder, withIntermediateDirectories: true)
        let tmp = Self.libraryFolder.appendingPathComponent(".tmp-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tmp) }

        let downloadURL = baseURL.appendingPathComponent("api/wallpapers/\(id)/download")
        var info: WallpaperDetailInfo?
        switch kind {
        case .html:
            let (data, resp) = try await request(downloadURL)
            try Self.check(resp, data)
            guard data.count == manifest.sizeBytes, data.count <= ManifestVerifier.maxBytes else { throw CommunityError.hashMismatch }
            guard ManifestVerifier.sha256Hex(data) == manifest.sha256.lowercased() else { throw CommunityError.hashMismatch }
            try data.write(to: tmp.appendingPathComponent("index.html"))
        case .video:
            // Stream to disk while hashing, so 60 MB never sits in memory
            try await Self.streamDownload(downloadURL, to: tmp.appendingPathComponent("video.mp4"),
                                          expectedSize: manifest.sizeBytes, expectedSHA256: manifest.sha256.lowercased())
            info = await detailInfo(id: id)
            if let info, let d = try? JSONEncoder().encode(info) { try? d.write(to: tmp.appendingPathComponent("info.json")) }
        }
        try JSONEncoder().encode(manifest).write(to: tmp.appendingPathComponent("manifest.json"))
        if let (thumb, r) = try? await request(baseURL.appendingPathComponent("api/wallpapers/\(id)/thumb")),
           r.statusCode == 200, thumb.count < 3 * 1024 * 1024, NSImage(data: thumb) != nil {
            try? thumb.write(to: tmp.appendingPathComponent("thumb"))
        }
        let dest = Self.libraryFolder.appendingPathComponent(id, isDirectory: true)
        if fm.fileExists(atPath: dest.path) { _ = try fm.replaceItemAt(dest, withItemAt: tmp) } else { try fm.moveItem(at: tmp, to: dest) }
        Self.verifiedFiles[dest.appendingPathComponent(kind.fileName).path] = nil
        return InstalledWallpaper(manifest: manifest, folder: dest, kind: kind, info: info)
    }

    /// Download in chunks -> write to the file and update SHA-256 per chunk; stop at once if it exceeds the signed size
    nonisolated private static func streamDownload(_ url: URL, to file: URL, expectedSize: Int, expectedSHA256: String) async throws {
        let bytes: URLSession.AsyncBytes, resp: URLResponse
        do {
            (bytes, resp) = try await URLSession.shared.bytes(for: URLRequest(url: url, timeoutInterval: 60))
        } catch {
            throw CommunityError.network(error.localizedDescription)
        }
        guard let http = resp as? HTTPURLResponse else { throw CommunityError.network(tr("No response")) }
        guard (200..<300).contains(http.statusCode) else { throw CommunityError.server(tr("The server returned an error (%d).", http.statusCode)) }
        guard FileManager.default.createFile(atPath: file.path, contents: nil),
              let out = try? FileHandle(forWritingTo: file) else { throw CommunityError.hashMismatch }
        defer { try? out.close() }
        var hasher = SHA256()
        var total = 0
        let chunk = 256 * 1024
        var buf = [UInt8](); buf.reserveCapacity(chunk)
        func flush() throws {
            total += buf.count
            guard total <= expectedSize else { throw CommunityError.hashMismatch }
            let d = Data(buf)
            hasher.update(data: d); try out.write(contentsOf: d); buf.removeAll(keepingCapacity: true)
        }
        do {
            for try await b in bytes {
                buf.append(b)
                if buf.count >= chunk { try flush() }
            }
            try flush()
        } catch let e as CommunityError {
            throw e
        } catch {
            throw CommunityError.network(error.localizedDescription)
        }
        guard total == expectedSize, ManifestVerifier.hex(hasher.finalize()) == expectedSHA256 else { throw CommunityError.hashMismatch }
    }

    /// Cache of video hash checks (path -> size + modification date + hash), so 60 MB isn't re-hashed on every scan
    private static var verifiedFiles: [String: (size: Int, mtime: Date, sha: String)] = [:]

    private static func fileSHA256(_ url: URL) -> String? {
        guard let a = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = (a[.size] as? NSNumber)?.intValue, let mtime = a[.modificationDate] as? Date else { return nil }
        if let c = verifiedFiles[url.path], c.size == size, c.mtime == mtime { return c.sha }
        guard let sha = ManifestVerifier.sha256Hex(fileAt: url) else { return nil }
        verifiedFiles[url.path] = (size, mtime, sha)
        return sha
    }

    func use(_ w: InstalledWallpaper) {
        Store.shared.config.installedID = w.id
        Store.shared.config.lastActiveMode = .installed
        Store.shared.config.wallpaperMode = .installed
    }

    func uninstall(_ w: InstalledWallpaper) {
        let wasActive = Store.shared.config.installedID == w.id
        try? FileManager.default.removeItem(at: w.folder)
        if wasActive {
            Store.shared.config.installedID = ""
            if Store.shared.config.wallpaperMode == .installed { Store.shared.config.wallpaperMode = .interactive }
            if Store.shared.config.lastActiveMode == .installed { Store.shared.config.lastActiveMode = .interactive }
        }
        scanInstalled()
        notice = (tr("Removed “%@” from this Mac.", w.manifest.title), false)
    }

    /// Ask before removing (the dialog lives at the app root)
    func requestRemove(_ w: InstalledWallpaper) { pendingRemoval = w }

    func removeAll() {
        let all = installed
        for w in all { try? FileManager.default.removeItem(at: w.folder) }
        if Store.shared.config.wallpaperMode == .installed { Store.shared.config.wallpaperMode = .interactive }
        if Store.shared.config.lastActiveMode == .installed { Store.shared.config.lastActiveMode = .interactive }
        Store.shared.config.installedID = ""
        scanInstalled()
        cleanUpStorage()
        notice = (tr("Removed all Community wallpapers."), false)
    }

    var totalSize: Int64 { sizes.values.reduce(0, +) }

    /// Delete leftovers that would otherwise pile up: interrupted downloads (.tmp-*) and folders that
    /// failed verification (they are never shown or used). Only runs when nothing is installing.
    func cleanUpStorage() {
        guard installing.isEmpty else { return }
        let fm = FileManager.default
        let valid = Set(installed.map { $0.folder.standardizedFileURL.path })
        let dirs = (try? fm.contentsOfDirectory(at: Self.libraryFolder, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
        for dir in dirs where !valid.contains(dir.standardizedFileURL.path) {
            let isDir = (try? dir.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDir { try? fm.removeItem(at: dir) }
        }
    }

    private static func folderSize(_ url: URL) -> Int64 {
        let keys: [URLResourceKey] = [.totalFileAllocatedSizeKey, .fileAllocatedSizeKey]
        guard let e = FileManager.default.enumerator(at: url, includingPropertiesForKeys: keys) else { return 0 }
        var total: Int64 = 0
        for case let f as URL in e {
            let v = try? f.resourceValues(forKeys: Set(keys))
            total += Int64(v?.totalFileAllocatedSize ?? v?.fileAllocatedSize ?? 0)
        }
        return total
    }

    /// Load the installed list, re-checking signature and hash every time; modified files are never used
    func scanInstalled() {
        let fm = FileManager.default
        let dirs = (try? fm.contentsOfDirectory(at: Self.libraryFolder, includingPropertiesForKeys: nil)) ?? []
        installed = dirs.compactMap { dir in
            guard ManifestVerifier.isSafeID(dir.lastPathComponent),
                  let md = try? Data(contentsOf: dir.appendingPathComponent("manifest.json")),
                  let m = try? JSONDecoder().decode(SignedManifest.self, from: md),
                  m.id == dir.lastPathComponent, ManifestVerifier.verify(m),
                  let kind = ManifestVerifier.kind(of: m)
            else { return nil }
            switch kind {
            case .html:
                guard let html = try? Data(contentsOf: dir.appendingPathComponent("index.html")),
                      ManifestVerifier.sha256Hex(html) == m.sha256.lowercased() else { return nil }
                return InstalledWallpaper(manifest: m, folder: dir, kind: .html)
            case .video:
                let file = dir.appendingPathComponent("video.mp4")
                guard m.sizeBytes <= ManifestVerifier.maxVideoBytes,
                      Self.fileSHA256(file) == m.sha256.lowercased() else { return nil }
                let info = (try? Data(contentsOf: dir.appendingPathComponent("info.json")))
                    .flatMap { try? JSONDecoder().decode(WallpaperDetailInfo.self, from: $0) }
                return InstalledWallpaper(manifest: m, folder: dir, kind: .video, info: info)
            }
        }
        .sorted { $0.manifest.title.localizedCompare($1.manifest.title) == .orderedAscending }
        sizes = Dictionary(uniqueKeysWithValues: installed.map { ($0.id, Self.folderSize($0.folder)) })
    }

    func installedWallpaper(_ id: String) -> InstalledWallpaper? { installed.first { $0.id == id } }

    // MARK: HTTP

    private func request(_ url: URL) async throws -> (Data, HTTPURLResponse) {
        let req = URLRequest(url: url, timeoutInterval: 30)
        do {
            let (d, r) = try await URLSession.shared.data(for: req)
            guard let http = r as? HTTPURLResponse else { throw CommunityError.network(tr("No response")) }
            return (d, http)
        } catch let e as CommunityError {
            throw e
        } catch {
            throw CommunityError.network(error.localizedDescription)
        }
    }

    private static func check(_ r: HTTPURLResponse, _ d: Data) throws {
        guard (200..<300).contains(r.statusCode) else {
            let msg = (try? JSONDecoder().decode(APIErrorBody.self, from: d))?.error.message
            throw CommunityError.server(msg ?? tr("The server returned an error (%d).", r.statusCode))
        }
    }

    private func getJSON<T: Decodable>(_ url: URL) async throws -> T {
        let (d, r) = try await request(url)
        try Self.check(r, d)
        do { return try JSONDecoder().decode(T.self, from: d) } catch {
            throw CommunityError.server(tr("The server returned data in an unexpected format."))
        }
    }
}

// MARK: - Deep links

@MainActor
enum DeepLink {
    static func handle(_ url: URL) {
        guard url.scheme == "macwallpaperpro",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return }
        let value = { (name: String) in items.first { $0.name == name }?.value }
        switch url.host {
        case "install":
            guard let id = value("id"), ManifestVerifier.isSafeID(id) else { return }
            Navigator.shared.page = .discover
            (NSApp.delegate as? AppDelegate)?.openSettings()
            // A web page can open this link without the user asking, so never install silently:
            // show what will be installed and wait for an explicit "Install". (Get buttons inside
            // the app stay one-click.)
            Task { await confirmInstall(id: id) }
        default:
            break
        }
    }

    private static func confirmInstall(id: String) async {
        let community = Community.shared
        guard let preview = await community.deepLinkPreview(id: id) else {
            community.notice = (tr("This wallpaper isn’t available."), true)
            return
        }
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = tr("Install “%@”?", preview.title)
        alert.informativeText = tr("By %@. A web link asked to install this Community wallpaper and set it as your wallpaper.", preview.author)
        if let image = preview.image {
            let view = NSImageView(frame: NSRect(x: 0, y: 0, width: 320, height: 200))
            view.image = image
            view.imageScaling = .scaleProportionallyUpOrDown
            view.wantsLayer = true
            view.layer?.cornerRadius = 8
            view.layer?.masksToBounds = true
            view.setAccessibilityLabel(preview.title)
            alert.accessoryView = view
        }
        alert.addButton(withTitle: tr("Install"))
        let cancel = alert.addButton(withTitle: tr("Cancel"))
        cancel.keyEquivalent = "\u{1b}"
        NSApp.activate()
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        await community.install(id: id)
    }
}
