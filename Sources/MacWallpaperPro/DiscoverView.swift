import AppKit
import SwiftUI

struct DiscoverView: View {
    @EnvironmentObject var store: Store
    @ObservedObject private var community = Community.shared
    @State private var selection: String?
    @State private var search = ""
    @State private var sort = "new"
    @State private var showInspector = true
    @State private var editingServer = false

    private var selected: WallpaperSummary? {
        community.items.first { $0.id == selection } ?? community.items.first
    }

    var body: some View {
        ScrollView {
            content.padding(20)
        }
        .searchable(text: $search, placement: .toolbar, prompt: "ค้นหาใน Community")
        .onSubmit(of: .search) { reload() }
        .onChange(of: search) { if search.isEmpty { reload() } }
        .onChange(of: sort) { reload() }
        .toolbar { toolbar }
        .inspector(isPresented: $showInspector) {
            Group {
                if let item = selected { DiscoverInspector(item: item) } else { Color.clear }
            }
            .inspectorColumnWidth(min: 300, ideal: 340, max: 440)
        }
        .overlay(alignment: .bottom) { toast }
        .task { await community.load(query: search, sort: sort); await community.refreshMe() }
        .sheet(isPresented: $editingServer) { ServerSheet() }
    }

    @ViewBuilder
    private var content: some View {
        if community.loading && community.items.isEmpty {
            LazyVGrid(columns: galleryColumns, spacing: 16) {
                ForEach(0..<8, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(.quaternary)
                        .aspectRatio(16 / 10, contentMode: .fit)
                }
            }
            .redacted(reason: .placeholder)
        } else if let err = community.loadError {
            ContentUnavailableView {
                Label("เชื่อมต่อ Community ไม่ได้", systemImage: "wifi.exclamationmark")
            } description: {
                Text(err)
            } actions: {
                Button("ลองอีกครั้ง") { reload() }.buttonStyle(.borderedProminent)
                Button("ตั้งค่าเซิร์ฟเวอร์…") { editingServer = true }
            }
            .frame(maxWidth: .infinity, minHeight: 360)
        } else if community.items.isEmpty {
            ContentUnavailableView(search.isEmpty ? "ยังไม่มี wallpaper" : "ไม่พบ “\(search)”",
                                   systemImage: "magnifyingglass",
                                   description: Text(search.isEmpty ? "เป็นคนแรกที่ส่งผลงานขึ้น Community" : "ลองค้นหาด้วยคำอื่น"))
                .frame(maxWidth: .infinity, minHeight: 360)
        } else {
            LazyVGrid(columns: galleryColumns, spacing: 16) {
                ForEach(community.items) { item in
                    GalleryTile(title: item.title, subtitle: "โดย \(item.author.name)",
                                selected: selected?.id == item.id,
                                active: activeID == item.id) {
                        AsyncImage(url: community.thumbURL(item)) { phase in
                            if case .success(let img) = phase {
                                img.resizable().aspectRatio(contentMode: .fill)
                            } else {
                                PlaceholderThumb(symbol: "photo")
                            }
                        }
                    } badge: {
                        if community.isInstalled(item.id) {
                            PriceBadge(text: "อยู่ในคลัง")
                        } else {
                            PriceBadge(text: item.priceLabel)
                        }
                    }
                    .onTapGesture { selection = item.id }
                }
            }
        }
    }

    private var activeID: String? {
        store.config.wallpaperMode == .installed ? store.config.installedID : nil
    }

    @ViewBuilder
    private var toast: some View {
        if let n = community.notice {
            Label(n.text, systemImage: n.isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundStyle(n.isError ? AnyShapeStyle(.orange) : AnyShapeStyle(.primary))
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .shadow(radius: 10, y: 4)
                .padding(.bottom, 20)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: n.text) {
                    try? await Task.sleep(for: .seconds(n.isError ? 6 : 4))
                    withAnimation { community.notice = nil }
                }
                .onTapGesture { withAnimation { community.notice = nil } }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Picker("เรียงตาม", selection: $sort) {
                Text("ใหม่ล่าสุด").tag("new")
                Text("ยอดนิยม").tag("popular")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button { reload() } label: { Label("รีเฟรช", systemImage: "arrow.clockwise") }
            Menu {
                if community.isConnected {
                    Text(community.me.map { "\($0.displayName) · \($0.email)" } ?? "เชื่อมบัญชีแล้ว")
                    Button("ยกเลิกการเชื่อมบัญชี") { community.disconnect() }
                } else {
                    Button("เชื่อมบัญชี…") { community.connect() }
                }
                Divider()
                Button("ส่ง wallpaper ของคุณ…") { NSWorkspace.shared.open(community.baseURL.appendingPathComponent("community/upload")) }
                Button("เปิด Community บนเว็บ") { NSWorkspace.shared.open(community.baseURL.appendingPathComponent("community")) }
                Divider()
                Button("ตั้งค่าเซิร์ฟเวอร์…") { editingServer = true }
            } label: {
                Label("บัญชี", systemImage: community.isConnected ? "person.crop.circle.fill" : "person.crop.circle")
            }
            Button { showInspector.toggle() } label: { Label("แผงรายละเอียด", systemImage: "sidebar.right") }
        }
    }

    private func reload() { Task { await community.load(query: search, sort: sort) } }
}

struct DiscoverInspector: View {
    let item: WallpaperSummary
    @ObservedObject private var community = Community.shared

    var body: some View {
        Form {
            Section {
                AsyncImage(url: community.thumbURL(item)) { phase in
                    if case .success(let img) = phase { img.resizable().aspectRatio(contentMode: .fill) }
                    else { PlaceholderThumb(symbol: "photo") }
                }
                .aspectRatio(16 / 10, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .listRowInsets(EdgeInsets(top: 10, leading: 10, bottom: 4, trailing: 10))

                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.title3.weight(.semibold))
                    Text("โดย \(item.author.name)").foregroundStyle(.secondary)
                }
                primaryAction
            } footer: {
                if !item.isFree && !community.isInstalled(item.id) {
                    Text("ซื้อบนเว็บแล้วกด “ติดตั้ง” อีกครั้ง (ต้องเชื่อมบัญชีก่อน)")
                }
            }

            Section("ข้อมูล") {
                LabeledContent("ราคา", value: item.priceLabel)
                LabeledContent("ดาวน์โหลด", value: item.downloads.formatted())
                if !item.tags.isEmpty {
                    LabeledContent("แท็ก", value: item.tags.joined(separator: ", "))
                }
                Button("ดูหน้าเต็มบนเว็บ") { NSWorkspace.shared.open(community.webPage(for: item.id)) }
            }

            Section {
                Label("ทุกไฟล์ผ่านการตรวจจากทีมงาน และแอปตรวจลายเซ็นก่อนติดตั้ง", systemImage: "checkmark.shield.fill")
                Label("wallpaper จาก Community ต่ออินเทอร์เน็ตไม่ได้", systemImage: "wifi.slash")
            } header: {
                Text("ความปลอดภัย")
            }
            .foregroundStyle(.secondary)
        }
        .formStyle(.grouped)
    }

    @ViewBuilder
    private var primaryAction: some View {
        if community.installing.contains(item.id) {
            HStack { ProgressView().controlSize(.small); Text("กำลังติดตั้งและตรวจสอบไฟล์…") }
                .frame(maxWidth: .infinity)
        } else if let w = community.installedWallpaper(item.id) {
            Button { community.use(w) } label: {
                Label("ใช้เป็นภาพพื้นหลัง", systemImage: "photo.badge.checkmark").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
        } else if item.isFree {
            Button { Task { await community.install(id: item.id) } } label: {
                Label("ติดตั้งและใช้", systemImage: "arrow.down.circle.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
        } else {
            Button { NSWorkspace.shared.open(community.webPage(for: item.id)) } label: {
                Label("ซื้อ \(item.priceLabel) บนเว็บ", systemImage: "cart.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
            Button { Task { await community.install(id: item.id) } } label: {
                Text("ติดตั้ง (ซื้อแล้ว)").frame(maxWidth: .infinity)
            }
            .controlSize(.large)
        }
    }
}

struct ServerSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""

    var body: some View {
        Form {
            Section {
                TextField("ที่อยู่เซิร์ฟเวอร์", text: $draft, prompt: Text("https://macwallpaperpro.com"))
            } header: {
                Text("เซิร์ฟเวอร์ Community")
            } footer: {
                Text("ใช้สำหรับนักพัฒนา ไฟล์ทุกชิ้นยังต้องมีลายเซ็นจากเซิร์ฟเวอร์ทางการเสมอ")
            }
        }
        .formStyle(.grouped)
        .frame(width: 420)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("บันทึก") {
                    store.config.communityURL = draft.trimmingCharacters(in: .whitespaces)
                    dismiss()
                    Task { await Community.shared.load() }
                }
                .disabled(URL(string: draft)?.host == nil)
            }
        }
        .onAppear { draft = store.config.communityURL }
    }
}
