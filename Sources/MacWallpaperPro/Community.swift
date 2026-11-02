import AppKit
import Combine
import CryptoKit
import Foundation
import WebKit

// MARK: - API types (ตาม docs/ARCHITECTURE.md)

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
}

struct WallpaperListResponse: Codable { let items: [WallpaperSummary]; let next: String? }

struct SignedManifest: Codable, Equatable {
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
    case invalidID, badSignature, hashMismatch, tooLarge, server(String), network(String)

    var errorDescription: String? {
        switch self {
        case .invalidID: tr("Invalid wallpaper ID.")
        case .badSignature: tr("The file’s signature is invalid, so it wasn’t installed for your safety.")
        case .hashMismatch: tr("The downloaded file doesn’t match the original, so it wasn’t installed for your safety.")
        case .tooLarge: tr("The file is too large (maximum 10 MB).")
        case .server(let m): m
        case .network(let m): tr("Can’t connect to the server: %@", m)
        }
    }
}

// MARK: - Security helpers

enum ManifestVerifier {
    /// public key ของเซิร์ฟเวอร์ (Ed25519 raw 32 bytes)
    static let publicKeyBase64 = "4ACj7B0U1mZeAEoA9oiCy4JPSu3xO/CMuQqvRDYX604="
    static let maxBytes = 10 * 1024 * 1024

    static func message(for m: SignedManifest) -> Data {
        Data(["macwallpaperpro-manifest-v1", m.id, String(m.version), m.sha256.lowercased(), String(m.sizeBytes)]
            .joined(separator: "\n").utf8)
    }

    static func verify(_ m: SignedManifest) -> Bool {
        guard let keyData = Data(base64Encoded: publicKeyBase64),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData),
              let sig = Data(base64Encoded: m.signature) else { return false }
        return key.isValidSignature(sig, for: message(for: m))
    }

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// อนุญาตเฉพาะตัวอักษรปลอดภัย กัน path traversal
    static func isSafeID(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 64 && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }
}

/// บล็อกทุก request ที่ไม่ใช่ไฟล์ในเครื่อง — wallpaper ส่งข้อมูลออกหรือโหลดโค้ดภายนอกไม่ได้
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

struct InstalledWallpaper: Identifiable, Equatable {
    let manifest: SignedManifest
    let folder: URL
    var id: String { manifest.id }
    var indexURL: URL { folder.appendingPathComponent("index.html") }
    var thumbURL: URL { folder.appendingPathComponent("thumb") }
}

// MARK: - Model

@MainActor
final class Community: ObservableObject {
    static let shared = Community()

    @Published private(set) var items: [WallpaperSummary] = []
    @Published private(set) var installed: [InstalledWallpaper] = []
    @Published private(set) var loading = false
    @Published private(set) var loadError: String?
    @Published private(set) var installing: Set<String> = []
    @Published var notice: (text: String, isError: Bool)?

    /// เว็บทางการของ MacWallpaperPro — ผู้ใช้เปลี่ยนไม่ได้
    static let officialURL = URL(string: "https://macwallpaper.elizos.com")!

    /// นักพัฒนาทดสอบกับเซิร์ฟเวอร์ในเครื่องได้ด้วย `MWP_COMMUNITY_URL=http://localhost:8787` (ไม่มีในหน้าตั้งค่า)
    let baseURL: URL = ProcessInfo.processInfo.environment["MWP_COMMUNITY_URL"].flatMap(URL.init(string:)) ?? Community.officialURL

    static var libraryFolder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MacWallpaperPro/Wallpapers", isDirectory: true)
    }

    private init() { scanInstalled() }

    // MARK: Browse

    func load(query: String = "", sort: String = "new", category: String? = nil) async {
        loading = true; loadError = nil
        defer { loading = false }
        var c = URLComponents(url: baseURL.appendingPathComponent("api/wallpapers"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "sort", value: sort)]
            + (query.isEmpty ? [] : [URLQueryItem(name: "q", value: query)])
            + (category.map { [URLQueryItem(name: "category", value: $0)] } ?? [])
        do {
            let page: WallpaperListResponse = try await getJSON(c.url!)
            items = page.items
        } catch {
            loadError = error.localizedDescription
        }
    }

    func thumbURL(_ w: WallpaperSummary) -> URL? { URL(string: w.thumbUrl, relativeTo: baseURL)?.absoluteURL }
    func webPage(for id: String) -> URL { baseURL.appendingPathComponent("community/w/\(id)") }

    // MARK: Install

    func isInstalled(_ id: String) -> Bool { installed.contains { $0.id == id } }

    /// ติดตั้งแล้วตั้งเป็นภาพพื้นหลังทันที
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
        guard manifest.id == id, ManifestVerifier.verify(manifest) else { throw CommunityError.badSignature }
        guard manifest.sizeBytes <= ManifestVerifier.maxBytes else { throw CommunityError.tooLarge }

        let (data, resp) = try await request(baseURL.appendingPathComponent("api/wallpapers/\(id)/download"))
        try Self.check(resp, data)
        guard data.count == manifest.sizeBytes, data.count <= ManifestVerifier.maxBytes else { throw CommunityError.hashMismatch }
        guard ManifestVerifier.sha256Hex(data) == manifest.sha256.lowercased() else { throw CommunityError.hashMismatch }

        // เขียนลงโฟลเดอร์ชั่วคราวก่อน แล้วสลับเข้าที่ (atomic)
        let fm = FileManager.default
        try fm.createDirectory(at: Self.libraryFolder, withIntermediateDirectories: true)
        let tmp = Self.libraryFolder.appendingPathComponent(".tmp-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tmp) }
        try data.write(to: tmp.appendingPathComponent("index.html"))
        try JSONEncoder().encode(manifest).write(to: tmp.appendingPathComponent("manifest.json"))
        if let (thumb, r) = try? await request(baseURL.appendingPathComponent("api/wallpapers/\(id)/thumb")),
           r.statusCode == 200, thumb.count < 3 * 1024 * 1024, NSImage(data: thumb) != nil {
            try? thumb.write(to: tmp.appendingPathComponent("thumb"))
        }
        let dest = Self.libraryFolder.appendingPathComponent(id, isDirectory: true)
        if fm.fileExists(atPath: dest.path) { _ = try fm.replaceItemAt(dest, withItemAt: tmp) } else { try fm.moveItem(at: tmp, to: dest) }
        return InstalledWallpaper(manifest: manifest, folder: dest)
    }

    func use(_ w: InstalledWallpaper) {
        Store.shared.config.installedID = w.id
        Store.shared.config.lastActiveMode = .installed
        Store.shared.config.wallpaperMode = .installed
    }

    func uninstall(_ w: InstalledWallpaper) {
        try? FileManager.default.removeItem(at: w.folder)
        if Store.shared.config.installedID == w.id, Store.shared.config.wallpaperMode == .installed {
            Store.shared.config.wallpaperMode = .interactive
            Store.shared.config.lastActiveMode = .interactive
        }
        scanInstalled()
    }

    /// โหลดรายการที่ติดตั้ง — ตรวจลายเซ็นและ hash ใหม่ทุกครั้ง ไฟล์ที่ถูกแก้ไขจะไม่ถูกใช้
    func scanInstalled() {
        let fm = FileManager.default
        let dirs = (try? fm.contentsOfDirectory(at: Self.libraryFolder, includingPropertiesForKeys: nil)) ?? []
        installed = dirs.compactMap { dir in
            guard ManifestVerifier.isSafeID(dir.lastPathComponent),
                  let md = try? Data(contentsOf: dir.appendingPathComponent("manifest.json")),
                  let m = try? JSONDecoder().decode(SignedManifest.self, from: md),
                  m.id == dir.lastPathComponent, ManifestVerifier.verify(m),
                  let html = try? Data(contentsOf: dir.appendingPathComponent("index.html")),
                  ManifestVerifier.sha256Hex(html) == m.sha256.lowercased()
            else { return nil }
            return InstalledWallpaper(manifest: m, folder: dir)
        }
        .sorted { $0.manifest.title.localizedCompare($1.manifest.title) == .orderedAscending }
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
            guard let id = value("id") else { return }
            Navigator.shared.page = .discover
            (NSApp.delegate as? AppDelegate)?.openSettings()
            Task { await Community.shared.install(id: id) }
        default:
            break
        }
    }
}
