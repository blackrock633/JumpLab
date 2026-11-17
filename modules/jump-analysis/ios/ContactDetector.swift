import Foundation

enum DetectionFailure: Error, CustomStringConvertible, LocalizedError {
  case unsuitable(String)
  var description: String { switch self { case .unsuitable(let reason): return reason } }
  var errorDescription: String? { description }
}
struct PoseFrame {
  let time: Double
  let leftY: Double
  let rightY: Double
  let hipY: Double
  let centerX: Double
  let scale: Double
  let confidence: Double
  let people: Int
}
struct TransitionEvidence {
  let takeoff: [Double]
  let landing: [Double]
  var dictionary: [String: [Double]] { ["takeoff": takeoff, "landing": landing] }
}

// Experimental geometry heuristic over native Vision poses, not a validated contact classifier.
// Initial quiet stance establishes a ground reference. Never infer through hidden feet or track loss.
struct ContactDetector {
  private var calibration: [PoseFrame] = []
  private var ground: Double?
  private var hip: Double = 0
  private var previous: PoseFrame?
  private var lastGround: Double?
  private var firstAir: Double?
  private var lastAir: Double?
  private var firstLanding: Double?
  private var airCount = 0
  private var contactCount = 0
  private(set) var events: [TransitionEvidence] = []

  mutating func feed(_ f: PoseFrame) throws {
    guard [f.time, f.leftY, f.rightY, f.hipY, f.centerX, f.scale, f.confidence].allSatisfy({ $0.isFinite }),
      f.people == 1, f.confidence >= 0.5, f.scale > 0.15,
      min(f.leftY, f.rightY) > 0.02, max(f.leftY, f.rightY) < 0.95 else {
      throw DetectionFailure.unsuitable("Use one fully visible athlete with both feet visible and good lighting.")
    }
    if let p = previous {
      guard f.time > p.time, f.time - p.time <= 0.13,
        abs(f.centerX - p.centerX) < 0.12, abs(f.scale / p.scale - 1) < 0.2 else {
        throw DetectionFailure.unsuitable("Track lost or athlete identity changed. Use a fixed camera and a clear full-body view.")
      }
    }
    previous = f
    if ground == nil {
      calibration.append(f)
      guard calibration.count <= 240 else { throw DetectionFailure.unsuitable("Begin with a quiet stance for half a second.") }
      if f.time - calibration[0].time >= 0.4 {
        let feet = calibration.flatMap { [$0.leftY, $0.rightY] }
        guard (feet.max()! - feet.min()!) / f.scale < 0.04 else {
          throw DetectionFailure.unsuitable("Begin with both feet still on the ground for half a second.")
        }
        ground = feet.reduce(0, +) / Double(feet.count)
        hip = calibration.map(\.hipY).reduce(0, +) / Double(calibration.count)
        lastGround = f.time
        calibration.removeAll()
      }
      return
    }
    let footLift = (min(f.leftY, f.rightY) - ground!) / f.scale
    let hipLift = (f.hipY - hip) / f.scale
    let airborne = footLift > 0.055 && hipLift > 0.05
    let contact = (max(f.leftY, f.rightY) - ground!) / f.scale < 0.03
    if airborne {
      guard firstLanding == nil else { throw DetectionFailure.unsuitable("Contact evidence is unstable. Use clearer footage.") }
      if firstAir == nil { firstAir = f.time }
      airCount += 1
      lastAir = f.time
      contactCount = 0
    } else if contact {
      if let start = firstAir, let end = lastAir, let takeoff = lastGround {
        if firstLanding == nil { firstLanding = f.time }
        contactCount += 1
        if contactCount >= 2 {
          let duration = (end + firstLanding!) / 2 - (takeoff + start) / 2
          if airCount >= 3 && duration >= 0.18 && duration <= 1.2 {
            events.append(TransitionEvidence(takeoff: [takeoff, start], landing: [end, firstLanding!]))
          }
          firstAir = nil; lastAir = nil; firstLanding = nil; airCount = 0; contactCount = 0
          lastGround = f.time
        }
      } else { lastGround = f.time }
    } else if firstAir != nil {
      // Ankle ambiguity around the transition is retained in the timing interval;
      // gaps wider than 100 ms are rejected by finish().
      if f.time - (lastAir ?? f.time) > 0.10 { throw DetectionFailure.unsuitable("Feet/contact obscured near a transition. Record a clearer view.") }
    }
  }
  func finish(type: String) throws -> [TransitionEvidence] {
    guard ground != nil, !events.isEmpty else { throw DetectionFailure.unsuitable("No complete supported jump. Include quiet stance, takeoff, landing and a short finish.") }
    guard firstAir == nil else { throw DetectionFailure.unsuitable("Clip ends before a complete landing. Include the full movement.") }
    guard type == "repeated" || events.count == 1 else { throw DetectionFailure.unsuitable("Multiple jumps found. Select repeated jumps or import one jump.") }
    guard events.allSatisfy({ $0.takeoff[1] - $0.takeoff[0] <= 0.10 && $0.landing[1] - $0.landing[0] <= 0.10 }) else {
      throw DetectionFailure.unsuitable("Transition timing is too uncertain. Use a higher-frame-rate original clip.")
    }
    return events
  }
}
