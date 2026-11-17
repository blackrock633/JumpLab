import Foundation
import AVFoundation
import Vision
import Darwin
final class AnalysisCancellation: @unchecked Sendable {
  private let lock = NSLock()
  private var cancelled = false
  func cancel() { lock.lock(); cancelled = true; lock.unlock() }
  func reset() { lock.lock(); cancelled = false; lock.unlock() }
  func check() throws {
    lock.lock(); let value = cancelled; lock.unlock()
    if value { throw DetectionFailure.unsuitable("Analysis cancelled or interrupted. Import again when ready.") }
  }
}

final class VideoAnalyzer: @unchecked Sendable {
  private let cancellation = AnalysisCancellation()
  private let busyLock = NSLock()
  private var busy = false
  func cancel() { cancellation.cancel() }
  func inspect(_ url: URL) async throws -> [String: Any] {
    guard FileManager.default.fileExists(atPath: url.path) else { throw DetectionFailure.unsuitable("Video moved or deleted. Import again.") }
    let bytes = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
    guard bytes > 0 && bytes <= 250_000_000 else { throw DetectionFailure.unsuitable("Video exceeds 250 MB limit.") }
    let asset = AVURLAsset(url: url)
    let duration = try await asset.load(.duration).seconds
    guard duration.isFinite && duration >= 1 && duration <= 30 else { throw DetectionFailure.unsuitable("Choose a 1–30 second clip.") }
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw DetectionFailure.unsuitable("No decodable video track.") }
    let size = try await track.load(.naturalSize)
    guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0,
      max(size.width, size.height) <= 3840, min(size.width, size.height) <= 2160 else {
      throw DetectionFailure.unsuitable("Use video at 4K resolution or lower.")
    }
    let fps = Double(try await track.load(.nominalFrameRate))
    let segments = try await track.load(.segments)
    let retimed = segments.contains { segment in
      let m = segment.timeMapping
      return segment.isEmpty || abs(m.source.duration.seconds - m.target.duration.seconds) > 0.001
    }
    return ["id": url.deletingPathExtension().lastPathComponent, "bytes": bytes, "duration": duration, "playbackFPS": fps, "hasRetiming": retimed]
  }
  func run(_ url: URL, fps: Double, type: String, deleteAfter: Bool) async throws -> [String: Any] {
    guard busyLock.withLock({ if busy { return false }; busy = true; return true }) else { throw DetectionFailure.unsuitable("Finish or cancel the current analysis first.") }
    cancellation.reset()
    defer { busyLock.withLock { busy = false }; if deleteAfter { try? FileManager.default.removeItem(at: url) } }
    let info = try await inspect(url)
    guard ["standing", "running", "repeated"].contains(type), fps.isFinite, fps >= 24, fps <= 240,
      let playback = info["playbackFPS"] as? Double, abs(fps / playback - 1) <= 0.03, info["hasRetiming"] as? Bool == false else {
      throw DetectionFailure.unsuitable("Unresolved capture timing. Use the original unretimed clip with matching recording FPS. Slow-motion exports are not supported yet.")
    }
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw DetectionFailure.unsuitable("Missing video track.") }
    let transform = try await track.load(.preferredTransform)
    let cancellation = cancellation
    return try await Task.detached(priority: .userInitiated) {
      let start = ProcessInfo.processInfo.systemUptime
      let reader = try AVAssetReader(asset: asset)
      let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange])
      output.alwaysCopiesSampleData = false
      guard reader.canAdd(output) else { throw DetectionFailure.unsuitable("Unsupported video format.") }
      reader.add(output)
      guard reader.startReading() else { throw DetectionFailure.unsuitable("Video decoding failed. Try a local original recording.") }
      defer { reader.cancelReading() }
      let angle = atan2(transform.b, transform.a)
      let orientation: CGImagePropertyOrientation = abs(angle - .pi / 2) < 0.1 ? .right : abs(angle + .pi / 2) < 0.1 ? .left : abs(angle) > 3 ? .down : .up
      var detector = ContactDetector(), timestamps: [Double] = []
      var peak: UInt64 = 0
      while reader.status == .reading {
        try cancellation.check()
        let more: Bool = try autoreleasepool {
          guard let sample = output.copyNextSampleBuffer() else { return false }
          defer { CMSampleBufferInvalidate(sample) }
          let pts = CMSampleBufferGetPresentationTimeStamp(sample).seconds
          guard pts.isFinite, timestamps.count < 7201 else { throw DetectionFailure.unsuitable("Invalid timestamps or too many frames.") }
          if let last = timestamps.last {
            guard pts > last, pts - last <= 3 / fps else { throw DetectionFailure.unsuitable("Irregular timing or missing frames. Use the original recording.") }
          }
          timestamps.append(pts)
          guard let pixel = CMSampleBufferGetImageBuffer(sample) else { throw DetectionFailure.unsuitable("Video frame could not be decoded.") }
          let request = VNDetectHumanBodyPoseRequest()
          try VNImageRequestHandler(cvPixelBuffer: pixel, orientation: orientation).perform([request])
          let bodies = request.results ?? []
          guard bodies.count == 1, let body = bodies.first else { throw DetectionFailure.unsuitable("Keep exactly one athlete visible throughout the recording.") }
          let joints = try body.recognizedPoints(.all)
          guard let l = joints[.leftAnkle], let r = joints[.rightAnkle], let lh = joints[.leftHip], let rh = joints[.rightHip],
            let neck = joints[.neck] else { throw DetectionFailure.unsuitable("Feet or torso hidden. Use a clearer side view.") }
          let confidence = Double(min(l.confidence, r.confidence, lh.confidence, rh.confidence, neck.confidence))
          try detector.feed(PoseFrame(time: pts, leftY: Double(l.location.y), rightY: Double(r.location.y),
            hipY: Double(lh.location.y + rh.location.y) / 2, centerX: Double(lh.location.x + rh.location.x) / 2,
            scale: Double(neck.location.y - min(l.location.y, r.location.y)), confidence: confidence, people: bodies.count))
          var usage = rusage(); getrusage(RUSAGE_SELF, &usage); peak = max(peak, UInt64(usage.ru_maxrss))
          return true
        }
        if !more { break }
      }
      guard reader.status == .completed else { throw DetectionFailure.unsuitable("Decode interrupted or failed. Import again.") }
      try cancellation.check()
      let intervals = zip(timestamps.dropFirst(), timestamps).map { $0 - $1 }.sorted()
      guard intervals.count >= 3, abs(intervals[intervals.count / 2] * fps - 1) <= 0.15 else {
        throw DetectionFailure.unsuitable("Capture FPS conflicts with decoded timestamps. Import an original recording.")
      }
      return ["timestamps": timestamps, "events": try detector.finish(type: type).map(\.dictionary),
        "elapsedSeconds": ProcessInfo.processInfo.systemUptime - start, "decodedFrames": timestamps.count, "peakResidentBytes": peak,
        "memoryMetric": "process lifetime peak RSS, bytes; not incremental analysis allocation",
        "clipBytes": info["bytes"]!, "clipDurationSeconds": info["duration"]!, "playbackFPS": info["playbackFPS"]!,
        "os": ProcessInfo.processInfo.operatingSystemVersionString] as [String: Any]
    }.value
  }
}
