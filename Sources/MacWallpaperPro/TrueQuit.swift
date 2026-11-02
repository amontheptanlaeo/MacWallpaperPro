import AppKit
import ApplicationServices
import Combine

/// ปิดแอปจริงเมื่อปิดหน้าต่างสุดท้าย (แทนที่พฤติกรรม macOS ที่แอปยังค้างอยู่)
/// ใช้ Accessibility API: เฝ้าดู window ทุกตัวของทุกแอป เมื่อ window ถูกทำลายแล้วแอปไม่เหลือหน้าต่าง → terminate()
@MainActor
final class TrueQuit: ObservableObject {
    static let shared = TrueQuit()

    @Published private(set) var isTrusted = AXIsProcessTrusted()
    @Published private(set) var isRunning = false
    @Published var lastEvent = ""

    private var observers: [pid_t: AXObserver] = [:]
    private var cancellables = Set<AnyCancellable>()
    private var trustTimer: Timer?

    func setEnabled(_ on: Bool) { on ? start() : stop() }

    func requestTrust() {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        isTrusted = AXIsProcessTrustedWithOptions(opts)
    }

    func start() {
        guard !isRunning else { return }
        isTrusted = AXIsProcessTrusted()
        guard isTrusted else {
            // ไม่เด้งหน้าต่างขอสิทธิ์เองตอนเปิดแอป — ขอเฉพาะตอนผู้ใช้กดปุ่มในหน้าตั้งค่า
            // รอจนผู้ใช้อนุญาตใน System Settings แล้วเริ่มเอง
            trustTimer?.invalidate()
            trustTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] t in
                MainActor.assumeIsolated {
                    guard let self else { t.invalidate(); return }
                    if AXIsProcessTrusted() {
                        t.invalidate()
                        self.isTrusted = true
                        if Store.shared.config.trueQuitEnabled { self.start() }
                    }
                }
            }
            return
        }
        isRunning = true
        NSWorkspace.shared.runningApplications.forEach(attach)

        let nc = NSWorkspace.shared.notificationCenter
        nc.publisher(for: NSWorkspace.didLaunchApplicationNotification)
            .compactMap { $0.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication }
            .receive(on: RunLoop.main)
            .sink { [weak self] app in
                // รอให้แอปสร้าง window แรกก่อน
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self?.attach(app) }
            }
            .store(in: &cancellables)
        nc.publisher(for: NSWorkspace.didTerminateApplicationNotification)
            .compactMap { $0.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication }
            .receive(on: RunLoop.main)
            .sink { [weak self] app in self?.detach(app.processIdentifier) }
            .store(in: &cancellables)
    }

    func stop() {
        trustTimer?.invalidate()
        cancellables.removeAll()
        observers.keys.forEach(detach)
        isRunning = false
    }

    private var refcon: UnsafeMutableRawPointer { Unmanaged.passUnretained(self).toOpaque() }

    private func attach(_ app: NSRunningApplication) {
        guard app.activationPolicy == .regular,
              app.bundleIdentifier != Bundle.main.bundleIdentifier,
              observers[app.processIdentifier] == nil else { return }
        let pid = app.processIdentifier
        var obs: AXObserver?
        guard AXObserverCreate(pid, trueQuitCallback, &obs) == .success, let obs else { return }
        let appEl = AXUIElementCreateApplication(pid)
        AXObserverAddNotification(obs, appEl, kAXWindowCreatedNotification as CFString, refcon)
        for w in Self.windows(of: appEl) ?? [] {
            AXObserverAddNotification(obs, w, kAXUIElementDestroyedNotification as CFString, refcon)
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
        observers[pid] = obs
    }

    private func detach(_ pid: pid_t) {
        guard let obs = observers.removeValue(forKey: pid) else { return }
        CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
    }

    fileprivate func handle(observer: AXObserver, element: AXUIElement, notification: String) {
        guard let pid = observers.first(where: { CFEqual($0.value, observer) })?.key else { return }
        if notification == kAXWindowCreatedNotification {
            AXObserverAddNotification(observer, element, kAXUIElementDestroyedNotification as CFString, refcon)
        } else if notification == kAXUIElementDestroyedNotification {
            // หน่วงเล็กน้อย: บางแอปปิดแล้วเปิดหน้าต่างใหม่ทันที (เช่น splash → main)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.quitIfNoWindows(pid) }
        }
    }

    private func quitIfNoWindows(_ pid: pid_t) {
        guard Store.shared.config.trueQuitEnabled,
              let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated,
              let bid = app.bundleIdentifier,
              !Store.shared.config.trueQuitExclusions.contains(bid),
              let wins = Self.windows(of: AXUIElementCreateApplication(pid)), wins.isEmpty
        else { return }
        lastEvent = tr("Quit %1$@ at %2$@", app.localizedName ?? bid, Date().formatted(date: .omitted, time: .shortened))
        app.terminate()
    }

    /// nil = อ่านไม่ได้ (ไม่ควรปิดแอป), [] = ไม่มีหน้าต่างเลย
    private static func windows(of app: AXUIElement) -> [AXUIElement]? {
        var value: CFTypeRef?
        switch AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) {
        case .success: return value as? [AXUIElement]
        case .noValue: return []
        default: return nil
        }
    }
}

private let trueQuitCallback: AXObserverCallback = { observer, element, notification, refcon in
    guard let refcon else { return }
    let me = Unmanaged<TrueQuit>.fromOpaque(refcon).takeUnretainedValue()
    let name = notification as String
    MainActor.assumeIsolated {
        me.handle(observer: observer, element: element, notification: name)
    }
}
