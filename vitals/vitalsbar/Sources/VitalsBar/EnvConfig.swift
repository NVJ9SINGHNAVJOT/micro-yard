import Foundation

// Reads the shared Vitals `.env` file so the menu-bar app and the Go agent agree
// on the URL without a hardcoded constant. The Go side loads the same file via
// go-shared/env.LoadEnv; here we parse it in Swift because the app can't import Go.
//
// Parsing mirrors LoadEnv: skip blank/`#` lines, split on the first `=`, trim.
enum EnvConfig {
    // Candidate paths, tried in order. A Finder-launched menu-bar app has no
    // shell cwd/env, so ~/.config/vitals/.env is the reliable production spot;
    // the relative paths cover `task bar-start` (cwd = vitalsbar/).
    private static var candidatePaths: [String] {
        var paths: [String] = []
        if let override = ProcessInfo.processInfo.environment["VITALS_ENV"], !override.isEmpty {
            paths.append(override)
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        paths.append(contentsOf: [
            "../.env",                              // vitals/.env from vitalsbar/
            "\(home)/.config/vitals/.env",
            "../../vitals/.env",
        ])
        return paths
    }

    // Parsed key/value pairs from the first readable candidate file (empty if none).
    private static let values: [String: String] = {
        for path in candidatePaths {
            guard let contents = try? String(contentsOfFile: path, encoding: .utf8) else { continue }
            var out: [String: String] = [:]
            for rawLine in contents.split(separator: "\n", omittingEmptySubsequences: false) {
                let line = rawLine.trimmingCharacters(in: .whitespaces)
                if line.isEmpty || line.hasPrefix("#") { continue }
                guard let eq = line.firstIndex(of: "=") else { continue }
                let key = line[..<eq].trimmingCharacters(in: .whitespaces)
                let val = line[line.index(after: eq)...].trimmingCharacters(in: .whitespaces)
                if !key.isEmpty { out[key] = val }
            }
            return out
        }
        return [:]
    }()

    static func string(_ key: String) -> String? {
        values[key]
    }
}
