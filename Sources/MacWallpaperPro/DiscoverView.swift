import AppKit
import SwiftUI

enum CommunityCategory: String, CaseIterable, Identifiable {
    case all, nature, cartoon, cute, scifi, space, abstract
    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: tr("All")
        case .nature: tr("Nature")
        case .cartoon: tr("Cartoon & Anime")
        case .cute: tr("Cute & Pastel")
        case .scifi: tr("Sci-fi")
        case .space: tr("Space & Stars")
        case .abstract: tr("Abstract")
        }
    }

    var symbol: String {
        switch self {
        case .all: "square.grid.2x2"
        case .nature: "leaf.fill"
        case .cartoon: "paintpalette.fill"
        case .cute: "heart.fill"
        case .scifi: "bolt.fill"
        case .space: "moon.stars.fill"
        case .abstract: "scribble.variable"
        }
    }

    var query: String? { self == .all ? nil : rawValue }
}

struct DiscoverView: View {
    @EnvironmentObject var store: Store
    @ObservedObject private var community = Community.shared
    @State private var selection: String?
    @State private var showDetails = false
    @State private var search = ""
    @State private var sort = "new"
    @State private var category: CommunityCategory = .all
    /// "Videos" chip: mutually exclusive with the categories (same as on the website)
    @State private var videosOnly = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var selected: WallpaperSummary? { community.items.first { $0.id == selection } }

    var body: some View {
        HStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.lg) {
                    PageHeader(title: "Discover") { headerControls }
                    categoryChips
                    NowPlayingStrip {
                        Navigator.shared.showActiveDetails = true
                        withMotion { Navigator.shared.page = .library }
                    }
                    content
                }
                .padding(.horizontal, Space.page).padding(.bottom, Space.page).padding(.top, Space.xxs)
            }
            .frame(maxWidth: .infinity)
            if showDetails, let item = selected {
                DetailColumn(title: item.title, close: { withMotion(Motion.panel) { showDetails = false } }) {
                    DiscoverDetails(item: item)
                }
                .transition(.detailColumn(reduceMotion: reduceMotion))
            }
        }
        .overlay(alignment: .bottom) { toast }
        .onChange(of: sort) { reload() }
        .onChange(of: category) { reload() }
        .onChange(of: videosOnly) { reload() }
        .task { await community.load(query: search, sort: sort, category: category.query, videosOnly: videosOnly) }
    }

    @ViewBuilder
    private var headerControls: some View {
        SearchField(prompt: tr("Search Community"), text: $search, onSubmit: reload).frame(width: 220)
        SegmentedControl(label: tr("Sort by"), selection: $sort, options: [("new", tr("Newest")), ("popular", tr("Popular"))])
            .fixedSize()
        Button { reload() } label: { Image(systemName: "arrow.clockwise") }
            .buttonStyle(IconButtonStyle())
            .help(tr("Refresh"))
            .accessibilityLabel(tr("Refresh"))
        Menu {
            Button(tr("Submit your wallpaper…")) { NSWorkspace.shared.open(community.baseURL.appendingPathComponent("community/upload")) }
            Button(tr("Open Community on the web")) { NSWorkspace.shared.open(community.baseURL.appendingPathComponent("community")) }
        } label: {
            Image(systemName: "globe")
        }
        .menuStyle(.button)
        .menuIndicator(.hidden)
        .buttonStyle(IconButtonStyle())
        .fixedSize()
        .help(tr("Community"))
        .accessibilityLabel(tr("Community"))
    }

    private var categoryChips: some View {
        FlowLayout() {
            ForEach(CommunityCategory.allCases) { c in
                Button { withMotion(Motion.quick) { category = c; videosOnly = false } } label: {
                    Label(c.title, systemImage: c.symbol)
                }
                .buttonStyle(ChipButtonStyle(selected: !videosOnly && category == c))
                .accessibilityAddTraits(!videosOnly && category == c ? .isSelected : [])
            }
            Button { withMotion(Motion.quick) { videosOnly = true; category = .all } } label: {
                Label(tr("Videos"), systemImage: "play.rectangle.fill")
            }
            .buttonStyle(ChipButtonStyle(selected: videosOnly))
            .accessibilityAddTraits(videosOnly ? .isSelected : [])
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(tr("Category"))
    }

    @ViewBuilder
    private var content: some View {
        if community.loading && community.items.isEmpty {
            LazyVGrid(columns: Metrics.gridColumns, spacing: Space.lg) {
                ForEach(0..<8, id: \.self) { _ in SkeletonTile() }
            }
        } else if let err = community.loadError {
            StateCard(symbol: "wifi.exclamationmark", title: tr("Can’t connect to Community"), message: err) {
                Button { reload() } label: { Label(tr("Try again"), systemImage: "arrow.clockwise") }
                    .buttonStyle(PrimaryButtonStyle())
            }
        } else if community.items.isEmpty {
            StateCard(symbol: "magnifyingglass",
                      title: search.isEmpty ? tr("No wallpapers yet") : tr("No results for “%@”", search),
                      message: search.isEmpty ? tr("Be the first to share your work on Community.") : tr("Try a different search."))
        } else {
            LazyVGrid(columns: Metrics.gridColumns, spacing: Space.lg) {
                ForEach(community.items) { item in
                    WallpaperTile(title: item.title, subtitle: tr("By %@", item.author.name),
                                  selected: showDetails && selection == item.id,
                                  active: activeID == item.id,
                                  isVideo: item.isVideo,
                                  action: { withMotion(Motion.panel) { selection = item.id; showDetails = true } }) {
                        AsyncImage(url: community.thumbURL(item)) { phase in
                            if case .success(let img) = phase {
                                img.resizable().aspectRatio(contentMode: .fill)
                            } else {
                                PlaceholderThumb(symbol: "photo")
                            }
                        }
                    } accessory: {
                        GetButton(item: item)
                    }
                    .accessibilityAction(named: Text(tr("Get"))) { Task { await community.install(id: item.id) } }
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
            ToastView(text: n.text, isError: n.isError)
                .padding(.bottom, Space.lg)
                .padding(.horizontal, Space.lg)
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                .task(id: n.text) {
                    try? await Task.sleep(for: .seconds(n.isError ? 5 : 4))
                    withMotion { community.notice = nil }
                }
                .onTapGesture { withMotion { community.notice = nil } }
        }
    }

    private func reload() { Task { await community.load(query: search, sort: sort, category: category.query, videosOnly: videosOnly) } }
}

/// One-click Get button (like Wallpaper Engine's Subscribe): installs and applies right away
struct GetButton: View {
    let item: WallpaperSummary
    @ObservedObject private var community = Community.shared

    var body: some View {
        Group {
            if community.installing.contains(item.id) {
                ProgressView().controlSize(.small).tint(.white)
                    .frame(width: 28, height: 28)
                    .background(.black.opacity(0.7), in: Capsule())
                    .accessibilityLabel(tr("Installing and verifying…"))
            } else if community.isInstalled(item.id) {
                Label(tr("In library"), systemImage: "checkmark")
                    .font(TypeScale.badge)
                    .foregroundStyle(.white)
                    .padding(.horizontal, Space.sm).frame(minHeight: 28)
                    .background(.black.opacity(0.7), in: Capsule())
                    .overlay(Capsule().strokeBorder(.white.opacity(0.12)))
            } else {
                Button {
                    Task { await community.install(id: item.id) }
                } label: {
                    Label(tr("Get"), systemImage: "arrow.down")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, Space.sm).frame(minHeight: 28)
                        .background(Theme.accentGradient, in: Capsule())
                        .shadow(color: .black.opacity(0.35), radius: 6, y: 2)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .help(tr("Install and set as wallpaper"))
            }
        }
        .animation(Motion.quick, value: community.installing.contains(item.id))
    }
}

struct DiscoverDetails: View {
    let item: WallpaperSummary
    @EnvironmentObject var store: Store
    @ObservedObject private var community = Community.shared
    @State private var info: WallpaperDetailInfo?

    var body: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            // Live preview from the server's /preview page (its CSP blocks the network); nothing is installed yet
            WebWallpaper(source: .url(community.baseURL.appendingPathComponent("preview/\(item.id)")),
                         params: "{}", isDesktop: false, offline: false)
                .id(item.id)
                .aspectRatio(16 / 10, contentMode: .fit)
                .background {
                    AsyncImage(url: community.thumbURL(item)) { phase in
                        if case .success(let img) = phase { img.resizable().aspectRatio(contentMode: .fill) }
                        else { PlaceholderThumb(symbol: "photo") }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Theme.border))
                .accessibilityHidden(true)
            Text(tr("By %@", item.author.name)).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
            primaryAction
        }

        DetailGroup(title: tr("Info"), footer: item.isVideo ? tr("Plays muted and looped.") : nil) {
            if item.isVideo {
                infoRow(tr("Type"), tr("Video"))
                if let credit = info?.credit, !credit.isEmpty { infoRow(tr("Credit"), credit) }
                if let license = info?.license, !license.isEmpty { infoRow(tr("License"), license) }
            }
            if let c = item.category.flatMap(CommunityCategory.init(rawValue:)) {
                infoRow(tr("Category"), c.title)
            }
            infoRow(tr("Downloads"), item.downloads.formatted())
            if !item.tags.isEmpty { infoRow(tr("Tags"), item.tags.joined(separator: ", ")) }
            Button(tr("View on the web")) { NSWorkspace.shared.open(community.webPage(for: item.id)) }
                .buttonStyle(SecondaryButtonStyle(fullWidth: true))
            if item.isVideo, let s = info?.sourceUrl, let u = URL(string: s), ["https", "http"].contains(u.scheme ?? "") {
                Button(tr("View source")) { NSWorkspace.shared.open(u) }
                    .buttonStyle(SecondaryButtonStyle(fullWidth: true))
            }
        }
        .task(id: item.id) {
            info = nil
            if item.isVideo { info = await community.detailInfo(id: item.id) }
        }

        DetailGroup(title: tr("Security")) {
            StatusRow(kind: .ok, title: tr("Every file is reviewed by our team, and the app verifies its signature before installing."))
            StatusRow(kind: .info, title: tr("Community wallpapers can’t access the internet."))
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

    @ViewBuilder
    private var primaryAction: some View {
        if community.installing.contains(item.id) {
            HStack(spacing: Space.xs) {
                ProgressView().controlSize(.small)
                Text(tr("Installing and verifying…")).font(TypeScale.secondaryMedium)
            }
            .frame(maxWidth: .infinity, minHeight: 32)
        } else if let w = community.installedWallpaper(item.id) {
            let active = store.config.wallpaperMode == .installed && store.config.installedID == w.id
            Button { community.use(w) } label: {
                Label(active ? tr("In use") : tr("Set as wallpaper"), systemImage: active ? "checkmark" : "photo.badge.checkmark")
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
            .disabled(active)
        } else {
            Button { Task { await community.install(id: item.id) } } label: {
                Label(tr("Install and use"), systemImage: "arrow.down")
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))
        }
    }
}
