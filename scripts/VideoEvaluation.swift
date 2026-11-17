import Foundation
import Darwin
@main struct VideoEvaluation {
  static func main() async {
    guard CommandLine.arguments.count == 4, let fps = Double(CommandLine.arguments[2]) else {
      fputs("Usage: video-evaluation <local-clip> <original-fps> <standing|running|repeated>\n", stderr); exit(64)
    }
    var report: [String: Any] = ["os": ProcessInfo.processInfo.operatingSystemVersionString,
      "host": "local macOS CLI (not physical iPhone)", "method": "vision-feet-flight/0.1-unvalidated"]
    let start = ProcessInfo.processInfo.systemUptime
    do {
      let value = try await VideoAnalyzer().run(URL(fileURLWithPath: CommandLine.arguments[1]), fps: fps, type: CommandLine.arguments[3], deleteAfter: false)
      report["outcome"] = "accept"; report["analysis"] = value
    } catch { report["outcome"] = "reject"; report["reason"] = String(describing: error) }
    report["pipelineElapsedSeconds"] = ProcessInfo.processInfo.systemUptime - start
    var usage = rusage(); getrusage(RUSAGE_SELF, &usage)
    report["processLifetimePeakResidentBytes"] = usage.ru_maxrss
    do { let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]); print(String(decoding: data, as: UTF8.self)) }
    catch { fputs("Evaluation output serialization failed\n", stderr); exit(1) }
  }
}
