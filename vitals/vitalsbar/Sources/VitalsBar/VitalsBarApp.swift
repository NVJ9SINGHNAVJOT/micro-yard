import SwiftUI
import AppKit
import Combine

// AppKit NSStatusItem + a borderless floating panel (not NSPopover, so there is
// no arrow). Gives a fixed item width, left-aligned numbers, the red alert
// color, and a panel dropped straight below the item.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let store = StatsStore()
    private var cancellables = Set<AnyCancellable>()

    private var panel: NSPanel!
    private var clickMonitor: Any?

    private static let alertThreshold: Double = 80
    private static let font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize,
                                                               weight: .regular)

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)   // menu bar only, no Dock icon
        setupPanel()
        setupStatusItem()

        store.start()
        store.objectWillChange
            .sink { [weak self] in Task { @MainActor in self?.refreshTitle() } }
            .store(in: &cancellables)
        refreshTitle()
    }

    // MARK: Status item (the menu bar label)

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.target = self
            button.action = #selector(togglePanel)
            button.alignment = .left   // pin text to the left so it never shifts
        }
        // Lock the item to the widest reading it can ever show, so it never
        // resizes as the numbers change. Measure a few candidates (in case the
        // padded shorter values are ever wider) and take the max.
        let candidates = [
            Self.title(cpu: 100, ram: 100, gpu: 100, gpuAvailable: true),
            Self.title(cpu: 8, ram: 8, gpu: 8, gpuAvailable: true),
            Self.title(cpu: 0, ram: 0, gpu: 0, gpuAvailable: false)
        ]
        let maxWidth = candidates.map { $0.size().width }.max() ?? 120
        statusItem.length = ceil(maxWidth) + 8
    }

    private func refreshTitle() {
        guard let button = statusItem.button else { return }
        if let snap = store.latest, store.reachable {
            button.attributedTitle = Self.title(cpu: snap.system.cpuTotalPercent,
                                                ram: snap.system.memPercent,
                                                gpu: snap.gpu.gpuUtilPercent,
                                                gpuAvailable: snap.gpu.available)
        } else {
            button.attributedTitle = NSAttributedString(
                string: "Vitals —",
                attributes: [.font: Self.font, .foregroundColor: NSColor.secondaryLabelColor])
        }
    }

    // MARK: Panel (the drop-down)

    private func setupPanel() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 320, height: 120),
                        styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.hidesOnDeactivate = false
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true

        let content = PopoverView(store: store)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        panel.contentView = NSHostingView(rootView: content)
    }

    @objc private func togglePanel() {
        panel.isVisible ? closePanel() : openPanel()
    }

    private func openPanel() {
        guard let button = statusItem.button, let win = button.window,
              let content = panel.contentView else { return }

        let size = content.fittingSize
        panel.setContentSize(size)

        // Place the panel centered under the item, just below the menu bar.
        let btnScreen = win.convertToScreen(button.convert(button.bounds, to: nil))
        let origin = NSPoint(x: btnScreen.midX - size.width / 2,
                             y: btnScreen.minY - size.height - 4)
        panel.setFrameOrigin(origin)
        panel.makeKeyAndOrderFront(nil)

        // Close when the user clicks anywhere outside the panel.
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) {
            [weak self] _ in self?.closePanel()
        }
    }

    private func closePanel() {
        panel.orderOut(nil)
        if let m = clickMonitor { NSEvent.removeMonitor(m); clickMonitor = nil }
    }

    // MARK: Title builder

    // "C 9%   R 80%   G 100%": each value LEFT-aligned in a fixed 4-char slot
    // (figure-space padded, one digit wide) so letters/gaps never move; a value
    // at/over the threshold is drawn red.
    static func title(cpu: Double, ram: Double, gpu: Double, gpuAvailable: Bool) -> NSAttributedString {
        let out = NSMutableAttributedString()

        func pad(_ s: String) -> String {
            s.count >= 4 ? s : s + String(repeating: "\u{2007}", count: 4 - s.count)
        }
        func gap() { out.append(NSAttributedString(string: "   ", attributes: [.font: font])) }
        func seg(_ label: String, _ value: Double, available: Bool = true) {
            let token = available ? pad("\(Int(value.rounded()))%") : pad("n/a")
            let color: NSColor = (available && value >= alertThreshold) ? .systemRed : .labelColor
            out.append(NSAttributedString(string: "\(label) \(token)",
                                          attributes: [.font: font, .foregroundColor: color]))
        }

        seg("C", cpu)
        gap()
        seg("R", ram)
        gap()
        seg("G", gpu, available: gpuAvailable)
        return out
    }
}

@main
struct VitalsBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings { EmptyView() }   // no real window; app lives in the menu bar
    }
}
