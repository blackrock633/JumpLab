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

  public func definition() -> ModuleDefinition {
    Name("JumpAnalysis")
    OnCreate {
      // The folder contains disposable imports only, never saved measurements.
      try? FileManager.default.removeItem(at: self.directory)
      try? FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
      self.backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in self?.engine.cancel() }
    }
    OnDestroy { if let observer = self.backgroundObserver { NotificationCenter.default.removeObserver(observer) }; self.engine.cancel() }
    AsyncFunction("pick") { () async throws -> [String: Any]? in
      let url: URL? = try await MainActor.run { () -> VideoPicker in
        if self.picker == nil { self.picker = VideoPicker(directory: self.directory) }
        return self.picker!
      }.pick()
      guard let url else { return nil }
      do { return try await self.engine.inspect(url) }
      catch { try? FileManager.default.removeItem(at: url); throw error }
    }
    AsyncFunction("analyze") { (id: String, fps: Double, type: String, confirmed: Bool) async throws -> [String: Any] in
      guard await MainActor.run(body: { UIApplication.shared.applicationState == .active }) else {
        throw DetectionFailure.unsuitable("Keep JumpLab open during analysis. Import again when ready.")
      }
      guard confirmed else { throw DetectionFailure.unsuitable("Confirm an original, unaltered recording. Retimed exports are unsupported.") }
      let url = try self.file(id)
      return try await self.engine.run(url, fps: fps, type: type, deleteAfter: true)
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
    Function("cancel") { self.engine.cancel() }
    AsyncFunction("discard") { (id: String) in
      let url = try self.file(id)
      if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
  }
  private func file(_ id: String) throws -> URL {
    guard UUID(uuidString: id) != nil else { throw DetectionFailure.unsuitable("Invalid local video reference.") }
    return directory.appendingPathComponent(id).appendingPathExtension("mov")
  }
}
