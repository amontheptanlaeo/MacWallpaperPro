import SwiftUI

// MARK: - Navigation

enum AppPage: String, CaseIterable, Identifiable {
    case library, discover
    case clock, borders, snapping, menuBarIcons, customBar, autoQuit, lockScreen
    case about
    var id: String { rawValue }

    static let wallpaperPages: [AppPage] = [.library, .discover]
    static let customizePages: [AppPage] = [.clock, .borders, .snapping, .menuBarIcons, .customBar, .autoQuit, .lockScreen]

    var title: String {
        switch self {
        case .library: "คลังของฉัน"
        case .discover: "Discover"
        case .clock: "นาฬิกา"
        case .borders: "ขอบหน้าต่าง"
        case .snapping: "จัดหน้าต่าง"
        case .menuBarIcons: "ซ่อนไอคอนแถบเมนู"
        case .customBar: "แถบเมนูแบบกำหนดเอง"
        case .autoQuit: "ออกจากแอปอัตโนมัติ"
        case .lockScreen: "หน้าจอล็อก"
        case .about: "เกี่ยวกับ"
        }
    }

    var symbol: String {
        switch self {
        case .library: "square.stack.fill"
        case .discover: "sparkles"
        case .clock: "clock.fill"
        case .borders: "square.dashed"
        case .snapping: "rectangle.split.2x1.fill"
        case .menuBarIcons: "menubar.arrow.up.rectangle"
        case .customBar: "menubar.rectangle"
        case .autoQuit: "xmark.app.fill"
        case .lockScreen: "lock.fill"
        case .about: "info.circle.fill"
        }
    }

    var tint: Color {
        switch self {
        case .library: .indigo
        case .discover: .pink
        case .clock: .orange
        case .borders: .cyan
        case .snapping: .green
        case .menuBarIcons: .purple
        case .customBar: .teal
        case .autoQuit: .red
        case .lockScreen: .blue
        case .about: .gray
        }
    }
}

@MainActor
final class Navigator: ObservableObject {
    static let shared = Navigator()
    @Published var page: AppPage = .library
}

// MARK: - Main window

struct MainView: View {
    @ObservedObject private var nav = Navigator.shared

    var body: some View {
        NavigationSplitView {
            List(selection: Binding(get: { nav.page }, set: { if let p = $0 { nav.page = p } })) {
                Section("ภาพพื้นหลัง") { rows(AppPage.wallpaperPages) }
                Section("แต่งเครื่อง") { rows(AppPage.customizePages) }
                Section { rows([.about]) }
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 260)
        } detail: {
            detail.navigationTitle(nav.page.title)
        }
        .frame(minWidth: 1020, minHeight: 640)
    }

    private func rows(_ pages: [AppPage]) -> some View {
        ForEach(pages) { p in
            Label { Text(p.title) } icon: { IconTile(symbol: p.symbol, tint: p.tint) }
                .tag(p)
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch nav.page {
        case .library: LibraryView()
        case .discover: DiscoverView()
        case .clock: ClockPage().formStyle(.grouped)
        case .borders: BordersPage().formStyle(.grouped)
        case .snapping: SnappingPage().formStyle(.grouped)
        case .menuBarIcons: MenuBarPage().formStyle(.grouped)
        case .customBar: CustomBarPage().formStyle(.grouped)
        case .autoQuit: AutoQuitPage().formStyle(.grouped)
        case .lockScreen: LockScreenPage().formStyle(.grouped)
        case .about: AboutPage().formStyle(.grouped)
        }
    }
}

// MARK: - Shared gallery tile

/// การ์ด wallpaper แบบ Wallpaper Engine: ภาพเต็มการ์ด ชื่ออยู่บนแถบไล่สีด้านล่าง
struct GalleryTile<Thumb: View, Badge: View>: View {
    let title: String
    let subtitle: String
    let selected: Bool
    let active: Bool
    @ViewBuilder var thumbnail: Thumb
    @ViewBuilder var badge: Badge
    @State private var hovering = false

    var body: some View {
        thumbnail
            .frame(maxWidth: .infinity)
            .aspectRatio(16 / 10, contentMode: .fit)
            .clipped()
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.callout.weight(.semibold)).lineLimit(1)
                    Text(subtitle).font(.caption).opacity(0.8).lineLimit(1)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 10).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .top, endPoint: .bottom))
            }
            .overlay(alignment: .topLeading) {
                if active {
                    Label("กำลังใช้", systemImage: "circle.fill")
                        .labelStyle(ActiveBadgeStyle())
                        .padding(8)
                }
            }
            .overlay(alignment: .topTrailing) { badge.padding(8) }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(selected ? Color.accentColor : Color.primary.opacity(hovering ? 0.25 : 0.08),
                                  lineWidth: selected ? 3 : 1)
            }
            .shadow(color: .black.opacity(hovering ? 0.25 : 0.1), radius: hovering ? 12 : 4, y: hovering ? 6 : 2)
            .scaleEffect(hovering ? 1.015 : 1)
            .animation(.snappy(duration: 0.18), value: hovering)
            .animation(.snappy(duration: 0.18), value: selected)
            .onHover { hovering = $0 }
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(title), \(subtitle)\(active ? ", กำลังใช้" : "")")
            .accessibilityAddTraits(.isButton)
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct ActiveBadgeStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 5) {
            configuration.icon.font(.system(size: 6)).foregroundStyle(.green)
            configuration.title.font(.caption2.weight(.bold))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(.black.opacity(0.55), in: Capsule())
    }
}

struct PriceBadge: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(.black.opacity(0.55), in: Capsule())
    }
}

/// พื้นหลังแทนภาพตัวอย่าง ระหว่างที่ยังไม่มีภาพจริง
struct PlaceholderThumb: View {
    let symbol: String
    var colors: [Color] = [Color(white: 0.32), Color(white: 0.16)]
    var body: some View {
        LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
            .overlay {
                Image(systemName: symbol)
                    .font(.system(size: 26, weight: .medium))
                    .foregroundStyle(.white.opacity(0.85))
            }
    }
}

let galleryColumns = [GridItem(.adaptive(minimum: 200, maximum: 320), spacing: 16)]
