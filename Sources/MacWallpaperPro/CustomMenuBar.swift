import AppKit
import Combine
import Darwin
import IOKit.ps
import Network
import SwiftUI

/// แถบเมนูแบบกำหนดเอง (แนวเดียวกับ SketchyBar) หนึ่งหน้าต่างต่อหนึ่งจอ คลิกทะลุได้
/// ถ้าแถบเมนูของระบบยังแสดงอยู่ จะวางไว้ใต้แถบเมนูของระบบเสมอ ไม่ทับกัน
@MainActor
final class CustomMenuBar: ObservableObject {
    static let shared = CustomMenuBar()

    @Published private(set) var isRunning = false
    /// แถบเมนูของระบบแสดงอยู่บนจอหลัก (ไม่ได้ตั้งให้ซ่อนอัตโนมัติ)
    @Published private(set) var systemBarVisible = true

    private var windows: [NSWindow] = []
    private var cancellables = Set<AnyCancellable>()

    func setEnabled(_ on: Bool) { on ? start() : stop() }

    func start() {
        guard !isRunning else { return }
        isRunning = true
        BarStats.shared.start()
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in self?.layout() }
            .store(in: &cancellables)
        DistributedNotificationCenter.default()
            .publisher(for: Self.hidingChanged)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                // visibleFrame ของจออัปเดตช้ากว่า notification เล็กน้อย
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self?.layout() }
            }
            .store(in: &cancellables)
        FeatureStore.shared.$config
            .map { [$0.barHeight, $0.barMargin, $0.barAllScreens ? 1 : 0] }
            .removeDuplicates()
            .sink { [weak self] _ in DispatchQueue.main.async { self?.layout() } }
            .store(in: &cancellables)
        layout()
    }

    func stop() {
        cancellables.removeAll()
        windows.forEach { $0.orderOut(nil) }
        windows.removeAll()
        BarStats.shared.stop()
        isRunning = false
        refreshSystemBarState()
    }

    func refreshSystemBarState() {
        systemBarVisible = NSScreen.screens.first.map(Self.hasSystemBar) ?? true
    }

    /// จอนี้มีแถบเมนูของระบบกินพื้นที่อยู่หรือไม่ (ถ้าตั้งให้ซ่อนอัตโนมัติ visibleFrame จะสูงเท่าจอ)
    static func hasSystemBar(_ s: NSScreen) -> Bool { s.frame.maxY - s.visibleFrame.maxY > 0.5 }

    private func shows(on s: NSScreen) -> Bool {
        FeatureStore.shared.config.barAllScreens || s == NSScreen.screens.first
    }

    /// ความสูงที่แถบนี้ใช้บนจอนั้น (ให้การจัดหน้าต่างเว้นที่ไว้)
    func reservedTop(on s: NSScreen) -> CGFloat {
        guard isRunning, shows(on: s) else { return 0 }
        let c = FeatureStore.shared.config
        return c.barHeight + c.barMargin
    }

    private func frame(on s: NSScreen) -> CGRect {
        let c = FeatureStore.shared.config
        let top = (Self.hasSystemBar(s) ? s.visibleFrame.maxY : s.frame.maxY) - c.barMargin
        return CGRect(x: s.frame.minX + c.barMargin, y: top - c.barHeight,
                      width: s.frame.width - c.barMargin * 2, height: c.barHeight)
    }

    private func layout() {
        refreshSystemBarState()
        guard isRunning else { return }
        let screens = NSScreen.screens.filter(shows)
        while windows.count > screens.count { windows.removeLast().orderOut(nil) }
        while windows.count < screens.count { windows.append(makeWindow()) }
        for (w, s) in zip(windows, screens) {
            w.setFrame(frame(on: s), display: true)
            w.orderFrontRegardless()
        }
    }

    private func makeWindow() -> NSWindow {
        let w = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = false
        w.ignoresMouseEvents = true
        w.isReleasedWhenClosed = false
        w.animationBehavior = .none
        // ต่ำกว่าแถบเมนูของระบบหนึ่งระดับ เมื่อแถบของระบบเลื่อนลงมาจะทับแถบนี้ ไม่ใช่ถูกบัง
        w.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue - 1)
        w.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        let host = NSHostingView(rootView: CustomBarView())
        host.sizingOptions = []
        w.contentView = host
        return w
    }

    // MARK: ตั้งค่า "ซ่อนแถบเมนูอัตโนมัติ" ของ macOS

    private static let hidingChanged = Notification.Name("AppleInterfaceMenuBarHidingChangedNotification")
    private static let hideKey = "_HIHideMenuBar" as CFString

    static var systemAutoHide: Bool {
        CFPreferencesCopyValue(hideKey, kCFPreferencesAnyApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost) as? Bool ?? false
    }

    /// เทียบเท่า `defaults write NSGlobalDomain _HIHideMenuBar -bool …` แล้วแจ้งระบบด้วย distributed notification
    /// ตัวเดียวกับที่ System Settings ส่ง แถบเมนูจะเปลี่ยนทันทีโดยไม่ต้องรีสตาร์ต SystemUIServer
    static func setSystemAutoHide(_ on: Bool) {
        CFPreferencesSetValue(hideKey, on ? kCFBooleanTrue : kCFBooleanFalse,
                              kCFPreferencesAnyApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
        CFPreferencesSynchronize(kCFPreferencesAnyApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
        DistributedNotificationCenter.default().postNotificationName(hidingChanged, object: nil, userInfo: nil, deliverImmediately: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { CustomMenuBar.shared.layout() }
    }

    static func openSystemMenuBarSettings() {
        // macOS 15+: การตั้งค่าระบบ › แถบเมนู (เดิมอยู่ใน ศูนย์ควบคุม)
        let urls = ["x-apple.systempreferences:com.apple.ControlCenter-Settings.extension",
                    "x-apple.systempreferences:com.apple.preference.dock"]
        for u in urls { if let url = URL(string: u), NSWorkspace.shared.open(url) { return } }
    }
}

// MARK: - Stats (อัปเดตทุก 2 วินาที เฉพาะตอนแถบเปิดอยู่)

@MainActor
final class BarStats: ObservableObject {
    static let shared = BarStats()

    struct Battery: Equatable { var percent: Int; var charging: Bool; var onAC: Bool }
    enum Net: Equatable { case offline, wifi, ethernet, other }

    @Published var now = Date()
    @Published var appName = ""
    @Published var appIcon: NSImage?
    @Published var cpu = 0.0
    @Published var memory = 0.0
    @Published var battery: Battery?
    @Published var net: Net = .other
    @Published var downRate = 0.0
    @Published var upRate = 0.0

    private var timer: Timer?
    private var tick = 0
    private var cancellables = Set<AnyCancellable>()
    private var pathMonitor: NWPathMonitor?
    private var lastCPU: (busy: UInt64, total: UInt64)?
    private var lastBytes: (down: UInt64, up: UInt64, at: Date)?

    func start() {
        guard timer == nil else { return }
        updateApp()
        NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.didActivateApplicationNotification)
            .sink { [weak self] _ in self?.updateApp() }
            .store(in: &cancellables)

        let m = NWPathMonitor()
        m.pathUpdateHandler = { path in
            let n: Net = path.status != .satisfied ? .offline
                : path.usesInterfaceType(.wifi) ? .wifi
                : path.usesInterfaceType(.wiredEthernet) ? .ethernet : .other
            DispatchQueue.main.async { MainActor.assumeIsolated { BarStats.shared.net = n } }
        }
        m.start(queue: .global(qos: .utility))
        pathMonitor = m

        sample()
        let t = Timer(timeInterval: 2, repeats: true) { _ in
            MainActor.assumeIsolated { BarStats.shared.sample() }
        }
        t.tolerance = 0.5
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func stop() {
        timer?.invalidate(); timer = nil
        pathMonitor?.cancel(); pathMonitor = nil
        cancellables.removeAll()
        lastCPU = nil; lastBytes = nil
    }

    private func updateApp() {
        let app = NSWorkspace.shared.frontmostApplication
        appName = app?.localizedName ?? ""
        appIcon = app?.icon
    }

    private func sample() {
        now = Date()
        cpu = readCPU() ?? cpu
        memory = readMemory() ?? memory
        readNetworkRates()
        if tick % 15 == 0 { battery = readBattery() }   // ทุก 30 วินาที
        tick += 1
    }

    private func readCPU() -> Double? {
        var info = host_cpu_load_info()
        var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info_data_t>.size / MemoryLayout<integer_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return nil }
        let user = UInt64(info.cpu_ticks.0), sys = UInt64(info.cpu_ticks.1)
        let idle = UInt64(info.cpu_ticks.2), nice = UInt64(info.cpu_ticks.3)
        let busy = user + sys + nice, total = busy + idle
        defer { lastCPU = (busy, total) }
        guard let last = lastCPU, total > last.total else { return nil }
        return Double(busy - last.busy) / Double(total - last.total)
    }

    /// คิดแบบเดียวกับ "หน่วยความจำที่ใช้" ใน Activity Monitor (แอป + wired + compressed)
    private func readMemory() -> Double? {
        var vm = vm_statistics64()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.size / MemoryLayout<integer_t>.size)
        let kr = withUnsafeMutablePointer(to: &vm) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return nil }
        let page = Double(sysconf(_SC_PAGESIZE))
        let pages = Double(vm.internal_page_count) - Double(vm.purgeable_count)
            + Double(vm.wire_count) + Double(vm.compressor_page_count)
        return min(1, max(0, pages * page / Double(ProcessInfo.processInfo.physicalMemory)))
    }

    private func readBattery() -> Battery? {
        guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] else { return nil }
        for ps in list {
            guard let d = IOPSGetPowerSourceDescription(blob, ps)?.takeUnretainedValue() as? [String: Any],
                  (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType,
                  let cur = d[kIOPSCurrentCapacityKey] as? Int, let max = d[kIOPSMaxCapacityKey] as? Int, max > 0
            else { continue }
            return Battery(percent: cur * 100 / max,
                           charging: d[kIOPSIsChargingKey] as? Bool ?? false,
                           onAC: (d[kIOPSPowerSourceStateKey] as? String) == kIOPSACPowerValue)
        }
        return nil
    }

    private func readNetworkRates() {
        var down: UInt64 = 0, up: UInt64 = 0
        var ifap: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifap) == 0, let first = ifap else { return }
        defer { freeifaddrs(ifap) }
        var p: UnsafeMutablePointer<ifaddrs>? = first
        while let cur = p {
            let ifa = cur.pointee
            if let addr = ifa.ifa_addr, addr.pointee.sa_family == UInt8(AF_LINK),
               (ifa.ifa_flags & UInt32(IFF_LOOPBACK)) == 0, (ifa.ifa_flags & UInt32(IFF_UP)) != 0,
               String(cString: ifa.ifa_name).hasPrefix("en"),
               let data = ifa.ifa_data?.assumingMemoryBound(to: if_data.self) {
                down += UInt64(data.pointee.ifi_ibytes)
                up += UInt64(data.pointee.ifi_obytes)
            }
            p = ifa.ifa_next
        }
        let at = Date()
        if let last = lastBytes, down >= last.down, up >= last.up {
            let dt = max(0.5, at.timeIntervalSince(last.at))
            downRate = Double(down - last.down) / dt
            upRate = Double(up - last.up) / dt
        }
        lastBytes = (down, up, at)
    }

    static func rate(_ bps: Double) -> String {
        switch bps {
        case ..<1_000: "0 KB/s"
        case ..<1_000_000: String(format: "%.0f KB/s", bps / 1_000)
        default: String(format: "%.1f MB/s", bps / 1_000_000)
        }
    }
}

// MARK: - View

struct CustomBarView: View {
    @ObservedObject private var fs = FeatureStore.shared
    @ObservedObject private var st = BarStats.shared

    var body: some View {
        let c = fs.config
        HStack(spacing: 14) {
            if c.barShowApp, !st.appName.isEmpty {
                HStack(spacing: 6) {
                    if let icon = st.appIcon {
                        Image(nsImage: icon).resizable().frame(width: c.barFontSize + 4, height: c.barFontSize + 4)
                    }
                    Text(st.appName).font(c.barFont(.semibold)).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if c.barShowNetwork { network(c) }
            if c.barShowCPU { item("cpu", "\(Int((st.cpu * 100).rounded()))%", c) }
            if c.barShowMemory { item("memorychip", "\(Int((st.memory * 100).rounded()))%", c) }
            if c.barShowBattery, let b = st.battery { item(Self.batterySymbol(b), "\(b.percent)%", c) }
            if c.barShowDate {
                Text(st.now, format: .dateTime.weekday(.abbreviated).day().month(.abbreviated)).font(c.barFont())
            }
            if c.barShowClock {
                Text(st.now, format: .dateTime.hour(.defaultDigits(amPM: .abbreviated)).minute(.twoDigits))
                    .font(c.barFont(.semibold)).monospacedDigit()
            }
        }
        .foregroundStyle(c.barTextColor.color)
        .padding(.horizontal, max(10, c.barRadius * 0.8))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { background(c) }
        .clipShape(RoundedRectangle(cornerRadius: c.barRadius, style: .continuous))
    }

    @ViewBuilder
    private func background(_ c: FeatureConfig) -> some View {
        ZStack {
            if c.barBlur { BarBlur() }
            c.barColor.opacity(c.barOpacity).color
        }
    }

    private func item(_ symbol: String, _ text: String, _ c: FeatureConfig) -> some View {
        HStack(spacing: 4) {
            Image(systemName: symbol).font(.system(size: c.barFontSize - 1, weight: .medium))
            Text(text).font(c.barFont()).monospacedDigit()
        }
    }

    @ViewBuilder
    private func network(_ c: FeatureConfig) -> some View {
        let symbol = switch st.net {
        case .offline: "wifi.slash"
        case .wifi: "wifi"
        case .ethernet: "cable.connector"
        case .other: "network"
        }
        if st.net == .offline {
            item(symbol, tr("Offline"), c)
        } else {
            item(symbol, "↓ " + BarStats.rate(st.downRate), c)
        }
    }

    static func batterySymbol(_ b: BarStats.Battery) -> String {
        if b.charging { return "battery.100percent.bolt" }
        return switch b.percent {
        case ..<13: "battery.0percent"
        case ..<38: "battery.25percent"
        case ..<63: "battery.50percent"
        case ..<88: "battery.75percent"
        default: "battery.100percent"
        }
    }
}

private struct BarBlur: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = .hudWindow
        v.blendingMode = .behindWindow
        v.state = .active
        return v
    }
    func updateNSView(_ v: NSVisualEffectView, context: Context) {}
}
