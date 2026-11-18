import Foundation
@main struct DetectorTests {
  static func frame(_ i: Int, lift: Double = 0, people: Int = 1, x: Double = 0.5, confidence: Double = 0.9) -> PoseFrame {
    PoseFrame(time: Double(i) / 60, leftY: 0.1 + lift, rightY: 0.1 + lift, hipY: 0.4 + lift, centerX: x, scale: 0.7, confidence: confidence, people: people)
  }
  static func expectReject(_ label: String, _ body: () throws -> Void) {
    do { try body(); fatalError("Expected rejection: \(label)") } catch { print("PASS rejection: \(label)") }
  }
  static func main() throws {
    for type in ["standing", "running", "repeated"] {
      var d = ContactDetector()
      for i in 0..<100 { try d.feed(frame(i, lift: (40..<65).contains(i) ? 0.12 : 0)) }
      let e = try d.finish(type: type); precondition(e.count == 1)
      precondition(e[0].takeoff == [39.0 / 60, 40.0 / 60]); precondition(e[0].landing == [64.0 / 60, 65.0 / 60])
      print("PASS complete \(type)")
    }
    var running = ContactDetector(type: "running")
    for i in 0..<100 {
      let jump = (40..<65).contains(i)
      let alternate = (27..<36).contains(i)
      let raised = jump || (65..<71).contains(i)
      try running.feed(PoseFrame(time: Double(i) / 60,
        leftY: jump || (alternate && i % 2 == 0) ? 0.22 : 0.1,
        rightY: raised || (alternate && i % 2 == 1) ? 0.22 : 0.1,
        hipY: jump ? 0.52 : 0.4, centerX: 0.4 + Double(i) / 800, scale: 0.7, confidence: 0.9, people: 1))
    }
    let approach = try running.finish(type: "running")
    precondition(approach.count == 1)
    precondition(approach[0].landing == [64.0 / 60, 65.0 / 60], "Landing brackets the first contacting foot")
    var repeated = ContactDetector()
    for i in 0..<160 { try repeated.feed(frame(i, lift: (40..<65).contains(i) || (95..<120).contains(i) ? 0.12 : 0)) }
    let twoEvents = try repeated.finish(type: "repeated")
    precondition(twoEvents.count == 2)
    expectReject("multiple events in single mode") { _ = try repeated.finish(type: "standing") }
    expectReject("partial landing") { var d = ContactDetector(); for i in 0..<55 { try d.feed(frame(i, lift: i >= 40 ? 0.12 : 0)) }; _ = try d.finish(type: "repeated") }
    expectReject("approach steps / short noise") { var d = ContactDetector(); for i in 0..<100 { try d.feed(frame(i, lift: (40..<43).contains(i) ? 0.12 : 0)) }; _ = try d.finish(type: "running") }
    expectReject("ambiguous athletes") { var d = ContactDetector(); try d.feed(frame(0, people: 2)) }
    expectReject("hidden feet") { var d = ContactDetector(); try d.feed(frame(0, confidence: 0.2)) }
    expectReject("identity change") { var d = ContactDetector(); try d.feed(frame(0)); try d.feed(frame(1, x: 0.9)) }
    expectReject("track loss") { var d = ContactDetector(); try d.feed(frame(0)); try d.feed(frame(20)) }
    expectReject("unstable landing cannot duplicate a jump") {
      var d = ContactDetector()
      for i in 0..<70 { try d.feed(frame(i, lift: (40..<65).contains(i) || i == 66 ? 0.12 : 0)) }
      _ = try d.finish(type: "repeated")
    }
    var noise = ContactDetector()
    for i in 0..<120 { try noise.feed(frame(i, lift: i == 35 || i == 39 || i == 90 || (45..<70).contains(i) ? 0.12 : 0)) }
    let noiseEvents = try noise.finish(type: "repeated")
    precondition(noiseEvents.count == 1, "Isolated noisy samples cannot add events")
    print("Synthetic native transition tests only. Real-video accuracy UNVERIFIED.")
  }
}
