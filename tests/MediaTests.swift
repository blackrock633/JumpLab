import Foundation
import AVFoundation

@main struct MediaTests {
  static func reject(_ label: String, contains reason: String? = nil, _ work: () async throws -> Void) async {
    do { try await work(); fatalError("Expected rejection: \(label)") }
    catch {
      if let reason { precondition(error.localizedDescription.contains(reason), "Unexpected rejection for \(label): \(error.localizedDescription)") }
      print("PASS media rejection: \(label)")
    }
  }
  static func main() async throws {
    func mapping(source: Int64, target: Int64, length: Int64, targetLength: Int64? = nil) -> CMTimeMapping {
      func time(_ value: Int64) -> CMTime { CMTime(value: value, timescale: 600) }
      return CMTimeMapping(source: CMTimeRange(start: time(source), duration: time(length)),
        target: CMTimeRange(start: time(target), duration: time(targetLength ?? length)))
    }
    let first = mapping(source: 120, target: 60, length: 600)
    precondition(!hasAmbiguousEdits([first, mapping(source: 720, target: 660, length: 600)]))
    precondition(hasAmbiguousEdits([first, mapping(source: 840, target: 660, length: 600)]))
    precondition(hasAmbiguousEdits([first, mapping(source: 720, target: 720, length: 600)]))
    precondition(hasAmbiguousEdits([mapping(source: 120, target: 60, length: 600, targetLength: 1200)]))
    print("PASS continuous nonzero origin, same-rate source cut, target gap and retiming")

    func background(shift: Int = 0, flat: Bool = false) -> CVPixelBuffer {
      var buffer: CVPixelBuffer?
      precondition(CVPixelBufferCreate(kCFAllocatorDefault, 320, 240, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, nil, &buffer) == kCVReturnSuccess)
      let pixel = buffer!
      precondition(CVPixelBufferLockBaseAddress(pixel, []) == kCVReturnSuccess)
      let base = CVPixelBufferGetBaseAddressOfPlane(pixel, 0)!.assumingMemoryBound(to: UInt8.self)
      let stride = CVPixelBufferGetBytesPerRowOfPlane(pixel, 0)
      for y in 0..<240 {
        for x in 0..<320 {
          let source = y - shift
          base[y * stride + x] = flat ? 100 : UInt8(truncatingIfNeeded: x * 19 + source * 39 + (x * source) % 57)
        }
      }
      CVPixelBufferUnlockBaseAddress(pixel, [])
      return pixel
    }
    var camera = CameraEvidence()
    try camera.check(background()); try camera.check(background())
    await reject("vertical camera displacement", contains: "fixed camera") { try camera.check(background(shift: 8)) }
    var blank = CameraEvidence()
    await reject("camera evidence unavailable on flat background", contains: "textured") { try blank.check(background(flat: true)) }
    let cancellation = AnalysisCancellation()
    try cancellation.check()
    cancellation.cancel()
    await reject("cancel/interruption flag", contains: "cancelled") { try cancellation.check() }
    try AnalysisCancellation().check()
    let dir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(".cache/native-media")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let analyzer = VideoAnalyzer(), missing = dir.appendingPathComponent("missing.mov")
    await reject("unavailable picker copy", contains: "Import again") { _ = try await analyzer.inspect(missing) }
    let large = dir.appendingPathComponent("large.mov")
    _ = FileManager.default.createFile(atPath: large.path, contents: Data())
    let handle = try FileHandle(forWritingTo: large); try handle.truncate(atOffset: 250_000_001); try handle.close()
    await reject("oversized media", contains: "250 MB") { _ = try await analyzer.inspect(large) }
    let cancelled = dir.appendingPathComponent("cancelled.mov")
    try Data("not a movie".utf8).write(to: cancelled)
    await reject("pre-cancelled run does not reset cancellation", contains: "cancelled") {
      _ = try await analyzer.run(cancelled, fps: 60, type: "standing", deleteAfter: true, cancellation: cancellation)
    }
    precondition(!FileManager.default.fileExists(atPath: cancelled.path))
    let broken = dir.appendingPathComponent("broken.mov")
    try Data("not a movie".utf8).write(to: broken)
    await reject("corrupt media") { _ = try await analyzer.run(broken, fps: 60, type: "standing", deleteAfter: true) }
    precondition(!FileManager.default.fileExists(atPath: broken.path), "Rejected analysis must remove disposable media")
    print("Native file/metadata failure tests only. No real athlete footage or accuracy evidence.")
  }
}
