import AppKit
import SwiftUI

// MARK: - Navigation (only 3 main destinations)

enum AppPage: String, CaseIterable, Identifiable {
    case library, discover, settings
    var id: String { rawValue }

    var title: String {
        switch self {
        case .library: tr("My library")
        case .discover: "Discover"
        case .settings: tr("Settings")
        }
    }

    var symbol: String {
        switch self {
        case .library: "square.stack.fill"
        case .discover: "sparkles"
        case .settings: "gearshape.fill"
        }
    }
}

/// Sections inside the Settings page
enum SettingsSection: String, CaseIterable, Identifiable {
    case general, clock, borders, snapping, menuBar, autoQuit, lockScreen, about
    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: tr("General")
        case .clock: tr("Clock")
        case .borders: tr("Window borders")
        case .snapping: tr("Window snapping")
        case .menuBar: tr("Menu bar")
        case .autoQuit: tr("Auto quit")
        case .lockScreen: tr("Lock screen")
        case .about: tr("About")
        }
    }

    var symbol: String {
        switch self {
        case .general: "slider.horizontal.3"
        case .clock: "clock.fill"
        case .borders: "square.dashed"
        case .snapping: "rectangle.split.2x1.fill"
        case .menuBar: "menubar.rectangle"
        case .autoQuit: "xmark.app.fill"
        case .lockScreen: "lock.fill"
        case .about: "info.circle.fill"
        }
    }
}

@MainActor
final class Navigator: ObservableObject {
    static let shared = Navigator()
    @Published var page: AppPage = .library
    @Published var settingsSection: SettingsSection = .general
    /// Asks the Library page to open the details panel of the wallpaper in use (from the Customize button on other pages)
    @Published var showActiveDetails = false
}

// MARK: - Main window

struct MainView: View {
    @ObservedObject private var nav = Navigator.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var loc: Localizer { Localizer.shared }

    /// Window chrome follows the system direction (traffic lights stay on the left in an LTR system); content follows the app language's direction
    private var shellDirection: LayoutDirection {
        NSApp.userInterfaceLayoutDirection == .rightToLeft ? .rightToLeft : .leftToRight
    }
    private var contentDirection: LayoutDirection { loc.language.rtl ? .rightToLeft : .leftToRight }

    var body: some View {
        HStack(spacing: 0) {
            NavRail(contentDirection: contentDirection)
            VStack(spacing: 0) {
                titleBand
                ZStack {
                    switch nav.page {
                    case .library: LibraryView().transition(.opacity)
                    case .discover: DiscoverView().transition(.opacity)
                    case .settings: SettingsView().transition(.opacity)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .environment(\.layoutDirection, contentDirection)
                .animation(reduceMotion ? nil : Motion.standard, value: nav.page)
            }
        }
        .environment(\.layoutDirection, shellDirection)
        .background(Theme.background)
        .foregroundStyle(Theme.textPrimary)
        .tint(Theme.accent)
        .ignoresSafeArea()
        .frame(minWidth: 1000, minHeight: 640)
        .preferredColorScheme(.dark)
        .modifier(RemovalDialogs())
        .localized()
    }

    /// Top strip (titlebar height): drags the window and has the language picker at the top-right
    private var titleBand: some View {
        HStack {
            Spacer()
            LanguagePicker().environment(\.layoutDirection, contentDirection)
        }
        .padding(.horizontal, Space.sm)
        .frame(height: Metrics.titlebarHeight + 4)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Rail

private struct NavRail: View {
    let contentDirection: LayoutDirection
    @ObservedObject private var nav = Navigator.shared
    @Namespace private var ns

    var body: some View {
        VStack(spacing: Space.xs) {
            // Leave room for the window's traffic-light buttons
            Color.clear.frame(height: Metrics.titlebarHeight + Space.md)
            ForEach(AppPage.allCases) { p in item(p) }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Space.xs)
        .frame(width: Metrics.railWidth)
        .frame(maxHeight: .infinity)
        .background(Theme.rail)
        .overlay(alignment: .trailing) { Rectangle().fill(Theme.border).frame(width: 1) }
        .environment(\.layoutDirection, contentDirection)
        .accessibilityElement(children: .contain)
    }

    private func item(_ p: AppPage) -> some View {
        let on = nav.page == p
        return Button {
            withMotion(Motion.standard) { nav.page = p }
        } label: {
            VStack(spacing: 6) {
                Image(systemName: p.symbol).font(.system(size: 18, weight: .semibold))
                    .frame(height: 22)
                Text(p.title)
                    .font(.system(size: 12, weight: on ? .semibold : .medium))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(on ? .white : Theme.textSecondary)
            .padding(.vertical, Space.sm).padding(.horizontal, Space.xxs)
            .frame(maxWidth: .infinity, minHeight: 64)
            .background {
                if on {
                    RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                        .fill(Theme.accentGradientTextSafeDiagonal)
                        .shadow(color: Theme.accentStart.opacity(0.35), radius: 10, y: 4)
                        .matchedGeometryEffect(id: "rail-pill", in: ns)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        }
        .buttonStyle(RailHoverStyle(selected: on))
        .accessibilityLabel(p.title)
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }
}

private struct RailHoverStyle: ButtonStyle {
    let selected: Bool
    func makeBody(configuration: Configuration) -> some View { RailBody(configuration: configuration, selected: selected) }
    private struct RailBody: View {
        let configuration: Configuration
        let selected: Bool
        @State private var hover = false
        var body: some View {
            configuration.label
                .background {
                    if !selected && hover {
                        RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(Theme.surfaceRaised)
                    }
                }
                .opacity(configuration.isPressed ? 0.85 : 1)
                .onHover { hover = $0 }
                .animation(Motion.quick, value: hover)
        }
    }
}

// MARK: - Shared gallery tile

/// 16:10 wallpaper card, 16 pt corners: image + title below (wraps); an extra button (such as Get) sits on the image corner and is always visible
struct WallpaperTile<Thumb: View, Accessory: View>: View {
    let title: String
    let subtitle: String
    let selected: Bool
    let active: Bool
    /// Show a "Video" badge on the image corner
    var isVideo = false
    let action: () -> Void
    @ViewBuilder var thumbnail: Thumb
    @ViewBuilder var accessory: Accessory
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: Space.xs) {
                Color.clear
                    .aspectRatio(16 / 10, contentMode: .fit)
                    .overlay { thumbnail }
                    .clipShape(RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.tile, style: .continuous)
                            .strokeBorder(selected ? AnyShapeStyle(Theme.accentGradientDiagonal)
                                          : AnyShapeStyle(hovering ? Theme.borderStrong : Theme.border),
                                          lineWidth: selected ? 2.5 : 1)
                    }
                    .overlay(alignment: .topLeading) {
                        if active { InUseBadge().padding(Space.xs) }
                    }
                    .overlay(alignment: .topTrailing) {
                        if isVideo { VideoBadge().padding(Space.xs) }
                    }
                    .shadow(color: .black.opacity(hovering ? 0.45 : 0.25), radius: hovering ? 14 : 6, y: hovering ? 6 : 2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(TypeScale.bodySemibold).foregroundStyle(Theme.textPrimary)
                        .lineLimit(2)
                    Text(subtitle).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, Space.xxs)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(TilePressStyle())
        .overlay(alignment: .topTrailing) {
            // Placed over the image (outside the main button) so it can be pressed separately; positioned from the image corner with the same aspect ratio
            Color.clear.aspectRatio(16 / 10, contentMode: .fit)
                .overlay(alignment: .bottomTrailing) { accessory.padding(Space.xs) }
        }
        .scaleEffect(hovering && !reduceMotion ? 1.02 : 1)
        .animation(Motion.quick, value: hovering)
        .animation(Motion.quick, value: selected)
        .onHover { hovering = $0 }
        .accessibilityLabel(active ? tr("%1$@, %2$@, in use", title, subtitle) : "\(title), \(subtitle)")
        .accessibilityValue(isVideo ? tr("Video") : "")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct TilePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.85 : 1)
    }
}

/// Badge marking a video wallpaper (used in Library and Discover)
struct VideoBadge: View {
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "play.fill").font(.system(size: 8, weight: .bold))
            Text(tr("Video")).font(TypeScale.badge)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, Space.xs).padding(.vertical, Space.xxs)
        .background(.black.opacity(0.7), in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.12)))
        .accessibilityHidden(true)
    }
}

struct InUseBadge: View {
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(Theme.success).frame(width: 7, height: 7)
            Text(tr("In use")).font(TypeScale.badge)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, Space.xs).padding(.vertical, Space.xxs)
        .background(.black.opacity(0.7), in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.12)))
        .accessibilityHidden(true)
    }
}

/// Placeholder background until the real preview image exists
struct PlaceholderThumb: View {
    let symbol: String
    var colors: [Color] = [Theme.surfaceHover, Theme.surface]
    var body: some View {
        LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
            .overlay {
                Image(systemName: symbol)
                    .font(.system(size: 26, weight: .medium))
                    .foregroundStyle(.white.opacity(0.85))
            }
    }
}

/// Loading skeleton
struct SkeletonTile: View {
    @State private var on = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            RoundedRectangle(cornerRadius: Radius.tile, style: .continuous).fill(Theme.surfaceRaised)
                .aspectRatio(16 / 10, contentMode: .fit)
            RoundedRectangle(cornerRadius: 4).fill(Theme.surfaceRaised).frame(width: 120, height: 12)
            RoundedRectangle(cornerRadius: 4).fill(Theme.surface).frame(width: 80, height: 10)
        }
        .opacity(on ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { on = true }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Page scaffolding

/// Page header: title + trailing controls; when too narrow the controls wrap to a new line (no overlap)
struct PageHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: Space.md) {
                titleView
                Spacer(minLength: Space.md)
                HStack(spacing: Space.xs) { trailing }.fixedSize()
            }
            VStack(alignment: .leading, spacing: Space.sm) {
                titleView
                HStack(spacing: Space.xs) { trailing }
            }
        }
    }

    private var titleView: some View {
        Text(title).font(TypeScale.pageTitle).foregroundStyle(Theme.textPrimary)
            .fixedSize()
            .accessibilityAddTraits(.isHeader)
    }
}

/// Fixed 320 pt details column on the right: the grid reflows instead of being covered
struct DetailColumn<Content: View>: View {
    let title: String
    let close: () -> Void
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Space.xs) {
                Text(title).font(TypeScale.section).foregroundStyle(Theme.textPrimary)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                Button(action: close) { Image(systemName: "xmark") }
                    .buttonStyle(IconButtonStyle(size: 28))
                    .keyboardShortcut(.cancelAction)
                    .help(tr("Close"))
                    .accessibilityLabel(tr("Close"))
            }
            .padding(.horizontal, Space.md).padding(.top, Space.xs).padding(.bottom, Space.sm)
            Rectangle().fill(Theme.border).frame(height: 1)
            ScrollView {
                VStack(alignment: .leading, spacing: Space.lg) { content }
                    .padding(Space.md)
            }
            .scrollIndicators(.automatic)
        }
        .frame(width: Metrics.detailWidth)
        .frame(maxHeight: .infinity)
        .background(Theme.surface)
        .overlay(alignment: .leading) { Rectangle().fill(Theme.border).frame(width: 1) }
        .accessibilityElement(children: .contain)
    }
}

/// Show/hide the details column: slide + fade (Reduce Motion = fade only)
extension AnyTransition {
    @MainActor static func detailColumn(reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : .move(edge: .trailing).combined(with: .opacity)
    }
}

/// Lays chips out in rows, wrapping when full (no horizontal scrolling)
struct FlowLayout: Layout {
    var spacing: CGFloat = Space.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let h = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(rows.count - 1, 0))
        let w = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? w, height: h)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for i in row.items {
                let s = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: y + (row.height - s.height) / 2), proposal: ProposedViewSize(s))
                x += s.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var items: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for i in subviews.indices {
            let s = subviews[i].sizeThatFits(.unspecified)
            let extra = rows[rows.count - 1].items.isEmpty ? s.width : s.width + spacing
            if rows[rows.count - 1].width + extra > width, !rows[rows.count - 1].items.isEmpty {
                rows.append(Row())
            }
            let add = rows[rows.count - 1].items.isEmpty ? s.width : s.width + spacing
            rows[rows.count - 1].items.append(i)
            rows[rows.count - 1].width += add
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, s.height)
        }
        return rows
    }
}

/// Empty-state card (empty/offline/no results) with a single action
struct StateCard<Actions: View>: View {
    let symbol: String
    let title: String
    let message: String
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(spacing: Space.md) {
            Image(systemName: symbol)
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 60, height: 60)
                .background(Theme.accentGradientTextSafeDiagonal.opacity(0.9), in: Circle())
                .accessibilityHidden(true)
            VStack(spacing: Space.xxs) {
                Text(title).font(TypeScale.section).foregroundStyle(Theme.textPrimary)
                Text(message).font(TypeScale.secondary).foregroundStyle(Theme.textSecondary)
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 420)
            actions
        }
        .padding(Space.xl)
        .frame(maxWidth: .infinity)
        .card(radius: Radius.tile)
        .accessibilityElement(children: .contain)
    }
}

extension StateCard where Actions == EmptyView {
    init(symbol: String, title: String, message: String) {
        self.init(symbol: symbol, title: title, message: message) { EmptyView() }
    }
}

// MARK: - Removal confirmations (shared by Library, Discover and Settings)

private struct RemovalDialogs: ViewModifier {
    @ObservedObject private var community = Community.shared

    func body(content: Content) -> some View {
        content
            .confirmationDialog(
                tr("Remove “%@” from this Mac?", community.pendingRemoval?.manifest.title ?? ""),
                isPresented: Binding(get: { community.pendingRemoval != nil },
                                     set: { if !$0 { community.pendingRemoval = nil } }),
                presenting: community.pendingRemoval
            ) { w in
                Button(tr("Remove"), role: .destructive) { community.uninstall(w) }
                Button(tr("Cancel"), role: .cancel) {}
            } message: { w in
                Text(tr("Frees %@. You can reinstall it from Discover at any time.",
                        ByteCountFormatter.string(fromByteCount: community.sizes[w.id] ?? Int64(w.manifest.sizeBytes), countStyle: .file)))
            }
            .confirmationDialog(tr("Remove all Community wallpapers?"), isPresented: $community.confirmRemoveAll) {
                Button(tr("Remove all"), role: .destructive) { community.removeAll() }
                Button(tr("Cancel"), role: .cancel) {}
            } message: {
                Text(tr("Frees %@. You can reinstall them from Discover at any time.",
                        ByteCountFormatter.string(fromByteCount: community.totalSize, countStyle: .file)))
            }
    }
}
