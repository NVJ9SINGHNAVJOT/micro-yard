import Foundation
import SwiftUI

// Base URL of the Vitals Go agent, built from VITALS_PORT in the shared .env — the
// same variable the agent binds to, so the two can't drift. The agent always serves
// on localhost. Reused by the "Open full dashboard" button in the popover.
enum Vitals {
    // Matches the agent's default in config.go, used when .env is missing.
    private static let defaultPort = "4500"

    static let baseURL: String = {
        guard let port = EnvConfig.string("VITALS_PORT"), !port.isEmpty else {
            return "http://localhost:\(defaultPort)"
        }
        return "http://localhost:\(port)"
    }()
    static var statsURL: URL { URL(string: baseURL + "/stats")! }
    static var dashboardURL: URL { URL(string: baseURL + "/")! }
    static let pollInterval: TimeInterval = 2      // matches the agent cadence
    static let historyCap = 60                      // ~2 min of samples
}

// Polls /stats every 2s and keeps small in-memory ring buffers for sparklines.
@MainActor
final class StatsStore: ObservableObject {
    @Published var latest: Snapshot?
    @Published var reachable = false

    @Published var cpuHistory: [Double] = []
    @Published var ramHistory: [Double] = []
    @Published var gpuHistory: [Double] = []

    private var timer: Timer?

    func start() {
        guard timer == nil else { return }
        poll()  // immediate first sample
        let t = Timer.scheduledTimer(withTimeInterval: Vitals.pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.poll() }
        }
        t.tolerance = 0.5  // let the OS coalesce wakeups → lower power use
        timer = t
    }

    private func poll() {
        Task { await fetch() }
    }

    private func fetch() async {
        do {
            var req = URLRequest(url: Vitals.statsURL)
            req.timeoutInterval = Vitals.pollInterval
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
                reachable = false
                return
            }
            let snap = try JSONDecoder().decode(Snapshot.self, from: data)
            latest = snap
            reachable = true
            append(&cpuHistory, snap.system.cpuTotalPercent)
            append(&ramHistory, snap.system.memPercent)
            append(&gpuHistory, snap.gpu.available ? snap.gpu.gpuUtilPercent : 0)
        } catch {
            reachable = false
        }
    }

    private func append(_ buf: inout [Double], _ value: Double) {
        buf.append(value)
        if buf.count > Vitals.historyCap {
            buf.removeFirst(buf.count - Vitals.historyCap)
        }
    }
}
