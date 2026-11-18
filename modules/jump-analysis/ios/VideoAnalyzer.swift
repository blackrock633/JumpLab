import Foundation
import AVFoundation
import Vision
import Darwin
import os

private let measurementLog = OSLog(subsystem: "app.jumplab", category: "Analysis")

// A rate-preserving edit can still skip or repeat capture time.
func hasAmbiguousEdits(_ mappings: [CMTimeMapping]) -> Bool {
  guard !mappings.isEmpty else { return true }
  var previous: CMTimeMapping?
  for m in mappings {
    guard m.source.start.isNumeric, m.target.start.isNumeric,
      m.source.duration.isNumeric, m.target.duration.isNumeric,
      m.source.duration.seconds > 0, m.target.duration.seconds > 0,
      CMTimeCompare(m.source.duration, m.target.duration) == 0 else { return true }
    if let p = previous,
      CMTimeCompare(CMTimeRangeGetEnd(p.source), m.source.start) != 0 ||
      CMTimeCompare(CMTimeRangeGetEnd(p.target), m.target.start) != 0 { return true }
    previous = m
  }
  return false
}

// Compare fixed background patches against the first frame, so gradual drift
// cannot accumulate undetected. Sample only a bounded number of luma pixels.
struct CameraEvidence {
  private var anchors: [(x: Int, y: Int, samples: [Double], energy: Double)] = []
  private var dimensions: (Int, Int)?

  mutating func check(_ pixel: CVPixelBuffer) throws {
    let message = "Camera stability could not be established. Use a fixed camera with a textured, stationary background visible in the corners."
    guard CVPixelBufferGetPlaneCount(pixel) > 0, CVPixelBufferLockBaseAddress(pixel, .readOnly) == kCVReturnSuccess else {
      throw DetectionFailure.unsuitable(message)
    }
    defer { CVPixelBufferUnlockBaseAddress(pixel, .readOnly) }
    guard let plane = CVPixelBufferGetBaseAddressOfPlane(pixel, 0) else { throw DetectionFailure.unsuitable(message) }
    let width = CVPixelBufferGetWidthOfPlane(pixel, 0), height = CVPixelBufferGetHeightOfPlane(pixel, 0)
    let stride = CVPixelBufferGetBytesPerRowOfPlane(pixel, 0)
    guard min(width, height) >= 96, min(width, height) <= 2160, max(width, height) <= 3840,
      stride >= width, dimensions.map({ $0 == (width, height) }) ?? true else { throw DetectionFailure.unsuitable(message) }
    dimensions = (width, height)
    let bytes = plane.assumingMemoryBound(to: UInt8.self)
    let stepX = max(1, width / 400), stepY = max(1, height / 400)
    func patch(_ x: Int, _ y: Int) -> [Double] {
      var values: [Double] = []
      for row in -3...3 {
        for col in -3...3 { values.append(Double(bytes[(y + row * 3 * stepY) * stride + x + col * 3 * stepX])) }
      }
      let mean = values.reduce(0, +) / Double(values.count)
      return values.map { $0 - mean }
    }
    if anchors.isEmpty {
      for y in [height / 8, 7 * height / 8] {
        for x in [width / 8, 7 * width / 8] {
          let values = patch(x, y)
          let energy = values.reduce(0) { $0 + $1 * $1 }
          if energy >= 49 * 144 { anchors.append((x, y, values, energy)) }
        }
      }
      guard anchors.count >= 2 else { throw DetectionFailure.unsuitable(message) }
      return
    }
    for anchor in anchors {
      func difference(_ x: Int, _ y: Int) -> Double {
        zip(anchor.samples, patch(x, y)).reduce(0) { $0 + pow($1.0 - $1.1, 2) } / anchor.energy
      }
      let fixed = difference(anchor.x, anchor.y)
      guard fixed < 0.25 else { throw DetectionFailure.unsuitable(message) }
      if fixed <= 0.04 { continue }
      for dy in -2...2 {
        for dx in -2...2 where max(abs(dx), abs(dy)) == 2 {
          let shifted = difference(anchor.x + dx * stepX, anchor.y + dy * stepY)
          if shifted + 0.025 < fixed * 0.65 { throw DetectionFailure.unsuitable(message) }
        }
      }
    }
  }
}

final class AnalysisCancellation: @unchecked Sendable {
  private let lock = NSLock()
  private var cancelled = false
  func cancel() { lock.lock(); cancelled = true; lock.unlock() }
  func check() throws {
    lock.lock(); let value = cancelled; lock.unlock()
    if value { throw DetectionFailure.unsuitable("Analysis cancelled or interrupted. Import again when ready.") }
  }
}

final class VideoAnalyzer: @unchecked Sendable {
  private let busyLock = NSLock()
  private var active: AnalysisCancellation?
  func cancel() { busyLock.withLock { active?.cancel() } }
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
    let retimed = segments.contains(where: \.isEmpty) || hasAmbiguousEdits(segments.map(\.timeMapping))
    return ["id": url.deletingPathExtension().lastPathComponent, "bytes": bytes, "duration": duration, "playbackFPS": fps, "hasRetiming": retimed, "encodedWidth": size.width, "encodedHeight": size.height]
  }
  func run(_ url: URL, fps: Double, type: String, deleteAfter: Bool, cancellation: AnalysisCancellation = AnalysisCancellation()) async throws -> [String: Any] {
    defer { if deleteAfter { try? FileManager.default.removeItem(at: url) } }
    guard busyLock.withLock({ () -> Bool in
      guard active == nil else { return false }
      active = cancellation
      return true
    }) else { throw DetectionFailure.unsuitable("Finish or cancel the current analysis first.") }
    defer { busyLock.withLock { active = nil } }
    try cancellation.check()
    let info = try await inspect(url)
    guard ["standing", "running", "repeated"].contains(type), fps.isFinite, fps >= 24, fps <= 240,
      let playback = info["playbackFPS"] as? Double, abs(fps / playback - 1) <= 0.03, info["hasRetiming"] as? Bool == false else {
      throw DetectionFailure.unsuitable("Unresolved capture timing. Use the original unretimed clip with matching recording FPS. Slow-motion exports are not supported yet.")
    }
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw DetectionFailure.unsuitable("Missing video track.") }
    let transform = try await track.load(.preferredTransform)
    return try await Task.detached(priority: .userInitiated) {
      try cancellation.check()
      let span = OSSignpostID(log: measurementLog)
      os_signpost(.begin, log: measurementLog, name: "Analyze video", signpostID: span)
      defer { os_signpost(.end, log: measurementLog, name: "Analyze video", signpostID: span) }
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
      var detector = ContactDetector(type: type), timestamps: [Double] = [], camera = CameraEvidence()
      while reader.status == .reading {
        try cancellation.check()
        let more: Bool = try autoreleasepool {
          guard let sample = output.copyNextSampleBuffer() else { return false }
          defer { CMSampleBufferInvalidate(sample) }
          let pts = CMSampleBufferGetPresentationTimeStamp(sample).seconds
          guard pts.isFinite, timestamps.count < 7201 else { throw DetectionFailure.unsuitable("Invalid timestamps or too many frames.") }
          if let last = timestamps.last {
            guard (pts - last) * fps >= 0.25 - 1e-8, (pts - last) * fps <= 3 + 1e-8 else { throw DetectionFailure.unsuitable("Irregular timing or missing frames. Use the original recording.") }
          }
          timestamps.append(pts)
          guard let pixel = CMSampleBufferGetImageBuffer(sample) else { throw DetectionFailure.unsuitable("Video frame could not be decoded.") }
          try camera.check(pixel)
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
          return true
        }
        if !more { break }
      }
      guard reader.status == .completed else { throw DetectionFailure.unsuitable("Decode interrupted or failed. Import again.") }
      try cancellation.check()
      let intervals = zip(timestamps.dropFirst(), timestamps).map { $0 - $1 }.sorted()
      guard intervals.count >= 3 else { throw DetectionFailure.unsuitable("Not enough decoded frames.") }
      let median = (intervals[intervals.count / 2] + intervals[(intervals.count - 1) / 2]) / 2
      guard abs(median * fps - 1) <= 0.15 else {
        throw DetectionFailure.unsuitable("Capture FPS conflicts with decoded timestamps. Import an original recording.")
      }
      var usage = rusage(); getrusage(RUSAGE_SELF, &usage)
      return ["timestamps": timestamps, "events": try detector.finish().map(\.dictionary), "trailingPartial": detector.trailingPartial, "detectorVersion": 3,
        "elapsedSeconds": ProcessInfo.processInfo.systemUptime - start, "decodedFrames": timestamps.count, "peakResidentBytes": usage.ru_maxrss,
        "memoryMetric": "process lifetime peak RSS, bytes; not incremental analysis allocation",
        "clipBytes": info["bytes"]!, "clipDurationSeconds": info["duration"]!, "playbackFPS": info["playbackFPS"]!,
        "encodedWidth": info["encodedWidth"]!, "encodedHeight": info["encodedHeight"]!,
        "os": ProcessInfo.processInfo.operatingSystemVersionString] as [String: Any]
    }.value
  }
}
