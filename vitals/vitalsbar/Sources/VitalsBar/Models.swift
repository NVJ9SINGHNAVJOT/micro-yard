import Foundation

// Codable structs mirroring the Go /stats payload (see agent/stats.go).

struct SystemStats: Codable {
    var cpuTotalPercent: Double = 0
    var memUsedMB: Double = 0
    var memTotalMB: Double = 0
    var memPercent: Double = 0

    enum CodingKeys: String, CodingKey {
        case cpuTotalPercent = "cpu_total_percent"
        case memUsedMB = "mem_used_mb"
        case memTotalMB = "mem_total_mb"
        case memPercent = "mem_percent"
    }
}

struct GPUStats: Codable {
    var gpuUtilPercent: Double = 0
    var available: Bool = false

    enum CodingKeys: String, CodingKey {
        case gpuUtilPercent = "gpu_util_percent"
        case available
    }
}

// Only system + GPU are shown; the agent's `services` key in the JSON is simply
// ignored by the decoder.
struct Snapshot: Codable {
    var system: SystemStats = SystemStats()
    var gpu: GPUStats = GPUStats()
    var ts: Int64 = 0
}
