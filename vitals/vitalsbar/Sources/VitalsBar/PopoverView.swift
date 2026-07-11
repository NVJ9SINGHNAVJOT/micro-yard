import SwiftUI
import AppKit

struct PopoverView: View {
    @ObservedObject var store: StatsStore
    var onDismiss: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header

            if store.reachable, let snap = store.latest {
                metricRow(title: "CPU", value: "\(fmt(snap.system.cpuTotalPercent))%",
                          history: store.cpuHistory, color: .blue)
                metricRow(title: "RAM",
                          value: "\(fmt(snap.system.memPercent))%  (\(fmt(snap.system.memUsedMB / 1024)) / \(fmt(snap.system.memTotalMB / 1024)) GB)",
                          history: store.ramHistory, color: .green)
                if snap.gpu.available {
                    metricRow(title: "GPU", value: "\(fmt(snap.gpu.gpuUtilPercent))%",
                              history: store.gpuHistory, color: .purple)
                } else {
                    gpuUnavailableRow
                }
            } else {
                agentOffView
            }

            Divider()
            footer
        }
        .padding(14)
        .frame(width: 320)
    }

    private var header: some View {
        HStack {
            Text("Vitals").font(.headline)
            Spacer()
            Circle()
                .fill(store.reachable ? Color.green : Color.secondary)
                .frame(width: 8, height: 8)
            Text(store.reachable ? "live" : "agent off")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func metricRow(title: String, value: String, history: [Double], color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(title).font(.subheadline.weight(.semibold))
                Spacer()
                Text(value).font(.system(.subheadline, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            Sparkline(values: history, maxValue: 100, color: color)
                .frame(height: 34)
        }
    }

    private var gpuUnavailableRow: some View {
        HStack {
            Text("GPU").font(.subheadline.weight(.semibold))
            Spacer()
            Text("n/a").font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }

    private var agentOffView: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Vitals data is unavailable")
                .font(.subheadline.weight(.semibold))
            Text("The monitoring service isn't running. It will reconnect automatically once it's back.")
                .font(.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var footer: some View {
        HStack {
            Button("Open full dashboard") {
                NSWorkspace.shared.open(Vitals.dashboardURL)
                onDismiss()
            }
            Spacer()
            Button("Quit") { NSApp.terminate(nil) }
                .foregroundStyle(.secondary)
        }
        .font(.callout)
    }

    private func fmt(_ v: Double) -> String {
        String(format: "%.1f", v)
    }
}
