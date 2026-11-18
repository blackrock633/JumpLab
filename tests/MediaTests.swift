import Foundation
import AVFoundation

@main struct MediaTests {
  static func reject(_ label: String, _ work: () async throws -> Void) async {
    do { try await work(); fatalError("Expected rejection: \(label)") }
    catch { print("PASS media rejection: \(label)") }
  }
  static func main() async throws {
    let cancellation = AnalysisCancellation()
    try cancellation.check()
    cancellation.cancel()
    await reject("cancel/interruption flag") { try cancellation.check() }
    try AnalysisCancellation().check()
    let dir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(".cache/native-media")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let analyzer = VideoAnalyzer(), missing = dir.appendingPathComponent("missing.mov")
    await reject("unavailable picker copy") { _ = try await analyzer.inspect(missing) }
    let large = dir.appendingPathComponent("large.mov")
    _ = FileManager.default.createFile(atPath: large.path, contents: Data())
    let handle = try FileHandle(forWritingTo: large); try handle.truncate(atOffset: 250_000_001); try handle.close()
    await reject("oversized media") { _ = try await analyzer.inspect(large) }
    let cancelled = dir.appendingPathComponent("cancelled.mov")
    try Data("not a movie".utf8).write(to: cancelled)
    await reject("pre-cancelled run does not reset cancellation") {
      do {
        _ = try await analyzer.run(cancelled, fps: 60, type: "standing", deleteAfter: true, cancellation: cancellation)
      } catch {
        precondition(error.localizedDescription.contains("cancelled"), "Cancellation must be observed before decoding")
        throw error
      }
    }
    precondition(!FileManager.default.fileExists(atPath: cancelled.path))
    let broken = dir.appendingPathComponent("broken.mov")
    try Data("not a movie".utf8).write(to: broken)
    await reject("corrupt media") { _ = try await analyzer.run(broken, fps: 60, type: "standing", deleteAfter: true) }
    precondition(!FileManager.default.fileExists(atPath: broken.path), "Rejected analysis must remove disposable media")
    print("Native file/metadata failure tests only. No real athlete footage or accuracy evidence.")
  }
}
