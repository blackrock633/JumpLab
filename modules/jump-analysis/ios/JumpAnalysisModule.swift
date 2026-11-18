import ExpoModulesCore
import AVFoundation
import Vision
import PhotosUI
import UniformTypeIdentifiers
import UIKit
import Darwin

@MainActor
private final class VideoPicker: NSObject, PHPickerViewControllerDelegate {
  var continuation: CheckedContinuation<URL?, Error>?
  let directory: URL
  init(directory: URL) { self.directory = directory }
  func pick() async throws -> URL? {
    guard continuation == nil else { throw DetectionFailure.unsuitable("A video picker is already open.") }
    return try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
      var config = PHPickerConfiguration(); config.filter = .videos; config.selectionLimit = 1
      config.preferredAssetRepresentationMode = .current
      let picker = PHPickerViewController(configuration: config); picker.delegate = self
      guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
        var host = scene.windows.first(where: \.isKeyWindow)?.rootViewController else {
        self.continuation = nil; continuation.resume(throwing: DetectionFailure.unsuitable("Cannot open picker. Try again.")); return
      }
      while let presented = host.presentedViewController { host = presented }
      host.present(picker, animated: true)
    }
  }
  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let provider = results.first?.itemProvider else { continuation?.resume(returning: nil); continuation = nil; return }
    guard provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) else {
      continuation?.resume(throwing: DetectionFailure.unsuitable("Choose a video.")); continuation = nil; return
    }
    let directory = directory
    provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { [weak self] url, _ in
      var result: Result<URL?, Error>
      do {
        guard let url else { throw DetectionFailure.unsuitable("Video unavailable. Download it to Photos locally and import again.") }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
        guard size > 0 && size <= 250_000_000 else { throw DetectionFailure.unsuitable("Choose a video smaller than 250 MB.") }
        let target = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension("mov")
        try FileManager.default.copyItem(at: url, to: target)
        result = .success(target)
      } catch { result = .failure(error) }
      Task { @MainActor in self?.continuation?.resume(with: result); self?.continuation = nil }
    }
  }
}

public final class JumpAnalysisModule: Module {
  private let engine = VideoAnalyzer()
  private var picker: VideoPicker?
  private var backgroundObserver: NSObjectProtocol?
  private let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("JumpLabImports", isDirectory: true)

  private let receiptLock = NSLock()
  private var receiptOwner: String?
  private var receiptEpoch = 0
  private var analysisCancellation: AnalysisCancellation?
  private var activeImportID: String?
  private let receipts = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("JumpLabReceipts", isDirectory: true)

  private func cancelAnalysis() {
    receiptLock.withLock { analysisCancellation?.cancel(); engine.cancel() }
  }

  private func prepareReceipts(owner: String?) throws {
    let fm = FileManager.default
    try fm.createDirectory(at: receipts, withIntermediateDirectories: true)
    var folder = receipts
    var resources = URLResourceValues(); resources.isExcludedFromBackup = true
    try folder.setResourceValues(resources)
    for file in try fm.contentsOfDirectory(at: receipts, includingPropertiesForKeys: nil) {
      if owner == nil || file.lastPathComponent != owner! { try fm.removeItem(at: file) }
    }
  }

  public func definition() -> ModuleDefinition {
    Name("JumpAnalysis")
    OnCreate {
      // The folder contains disposable imports only, never saved measurements.
      try? FileManager.default.removeItem(at: self.directory)
      try? FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
      self.backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in self?.cancelAnalysis() }
    }
    OnDestroy { if let observer = self.backgroundObserver { NotificationCenter.default.removeObserver(observer) }; self.cancelAnalysis() }
    AsyncFunction("pick") { () async throws -> [String: Any]? in
      let url: URL? = try await MainActor.run { () -> VideoPicker in
        if self.picker == nil { self.picker = VideoPicker(directory: self.directory) }
        return self.picker!
      }.pick()
      guard let url else { return nil }
      do { return try await self.engine.inspect(url) }
      catch { try? FileManager.default.removeItem(at: url); throw error }
    }
    AsyncFunction("setAccount") { (owner: String?, preserve: String?) -> Bool in
      guard [owner, preserve].compactMap({ $0 }).allSatisfy({ UUID(uuidString: $0) != nil }) else {
        throw DetectionFailure.unsuitable("Invalid analysis account.")
      }
      return try self.receiptLock.withLock {
        if let preserve = preserve, FileManager.default.fileExists(atPath: self.receipts.appendingPathComponent(preserve).path) { return false }
        if self.receiptOwner != owner {
          self.receiptEpoch += 1
          self.receiptOwner = nil
          self.analysisCancellation?.cancel()
          self.engine.cancel()
        }
        try self.prepareReceipts(owner: owner)
        self.receiptOwner = owner
        return true
      }
    }
    AsyncFunction("recoverAnalysis") { (owner: String) -> [String: Any]? in
      try self.receiptLock.withLock {
        guard self.receiptOwner == owner else { throw DetectionFailure.unsuitable("Analysis account changed.") }
        let url = self.receipts.appendingPathComponent(owner)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        guard let value = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] else {
          throw DetectionFailure.unsuitable("Saved analysis recovery data is unreadable.")
        }
        return value
      }
    }
    AsyncFunction("finishAnalysis") { (owner: String, id: String) in
      try self.receiptLock.withLock {
        guard self.receiptOwner == owner else { return }
        let url = self.receipts.appendingPathComponent(owner)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        let value = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        if value?["id"] as? String == id { try FileManager.default.removeItem(at: url) }
      }
    }
    AsyncFunction("analyze") { (id: String, fps: Double, type: String, confirmed: Bool, owner: String) async throws -> [String: Any] in
      let url = try self.file(id)
      var ownsImport = true
      defer { if ownsImport { try? FileManager.default.removeItem(at: url) } }
      let receipt = self.receipts.appendingPathComponent(owner)
      let cancellation = AnalysisCancellation()
      let epoch = try self.receiptLock.withLock {
        if self.activeImportID == id { ownsImport = false }
        guard self.receiptOwner == owner, self.analysisCancellation == nil,
          !FileManager.default.fileExists(atPath: receipt.path) else {
          throw DetectionFailure.unsuitable("Finish or recover the previous analysis before starting another.")
        }
        self.analysisCancellation = cancellation
        self.activeImportID = id
        return self.receiptEpoch
      }
      defer {
        self.receiptLock.withLock {
          try? FileManager.default.removeItem(at: url)
          ownsImport = false
          self.analysisCancellation = nil
          self.activeImportID = nil
        }
      }
      guard await MainActor.run(body: { UIApplication.shared.applicationState == .active }) else {
        throw DetectionFailure.unsuitable("Keep JumpLab open during analysis. Import again when ready.")
      }
      guard confirmed else { throw DetectionFailure.unsuitable("Confirm an original, unaltered recording. Retimed exports are unsupported.") }
      let analysis = try await self.engine.run(url, fps: fps, type: type, deleteAfter: false, cancellation: cancellation)
      let events = analysis["events"] as? [[String: [Double]]] ?? []
      let value: [String: Any] = ["id": id, "analysis": analysis, "type": type, "fps": fps,
        "confirmed": confirmed, "ids": events.map { _ in UUID().uuidString.lowercased() },
        "createdAt": ISO8601DateFormatter().string(from: Date())]
      try self.receiptLock.withLock {
        guard self.receiptOwner == owner, self.receiptEpoch == epoch, !FileManager.default.fileExists(atPath: receipt.path) else {
          throw DetectionFailure.unsuitable("Analysis account changed or another analysis awaits saving.")
        }
        try cancellation.check()
        try JSONSerialization.data(withJSONObject: value).write(to: receipt, options: [.atomic, .completeFileProtection])
      }
      return value
    }
    // Debug-only evaluation invokes exactly the same production decode/inference path.
    #if DEBUG
    AsyncFunction("evaluate") { (path: String, fps: Double, type: String) async throws -> [String: Any] in
      var result = try await self.engine.run(URL(fileURLWithPath: path), fps: fps, type: type, deleteAfter: false)
      result["device"] = await MainActor.run { () -> [String: String] in
        var system = utsname(); uname(&system)
        let capacity = MemoryLayout.size(ofValue: system.machine)
        let hardware = withUnsafePointer(to: &system.machine) { pointer in
          pointer.withMemoryRebound(to: CChar.self, capacity: capacity) { String(cString: $0) }
        }
        return ["hardware": hardware, "model": UIDevice.current.model, "os": UIDevice.current.systemVersion,
          "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
          "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown", "configuration": "Debug"]
      }
      return result
    }
    #endif
    Function("cancel") { self.cancelAnalysis() }
    AsyncFunction("discard") { (id: String) in
      let url = try self.file(id)
      try self.receiptLock.withLock {
        if self.activeImportID == id { self.analysisCancellation?.cancel(); return }
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
      }
    }
  }
  private func file(_ id: String) throws -> URL {
    guard UUID(uuidString: id) != nil else { throw DetectionFailure.unsuitable("Invalid local video reference.") }
    return directory.appendingPathComponent(id).appendingPathExtension("mov")
  }
}
