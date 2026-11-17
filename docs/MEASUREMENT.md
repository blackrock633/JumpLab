# Measurement feasibility and limits

The feasibility slice is system-picker import → app-owned temporary copy → native metadata inspection → incremental AVAssetReader decode → Vision body poses → temporal detector → timestamp brackets → flight-time estimate → atomic local save. There is no canned measurement, JS frame-transfer loop, remote inference, or cloud video processing. Native inference is real platform inference. **Real-world feasibility and accuracy remain unverified: zero annotated athlete clips have been run.** The UI must not be treated as evidence that the detector is accurate.

## Supported recording conditions

Use one fully visible athlete, both ankles/feet and torso visible throughout, bright lighting, a fixed side-view camera, level ground, no cuts or zoom, and an initial quiet two-foot stance of at least 0.4 seconds. Include the entire takeoff and landing plus a short still finish. Limits: 1–30 seconds, 250,000,000 bytes, up to 3840×2160 pixels, 24–240 original FPS, no more than 7,201 decoded frames. Import a local original, unretimed recording. Running approaches must begin with the quiet stance and stay in the same image ground plane. General moving-camera, occluded, multi-athlete and arbitrary running footage is not supported.

The native method is an experimental geometry heuristic, `vision-feet-flight/0.1-unvalidated`, over Vision ankle/hip/neck estimates. It requires one body, joint confidence at least 0.5, plausible torso scale, visible ankles and bounded inter-frame position/scale changes. A quiet stance estimates a ground reference; both ankles and hip must rise consistently. At least three airborne samples, two landing samples and 0.18–1.2 seconds of candidate flight are required. Single-frame noise cannot create an accepted event. Temporal/scale discontinuities, unstable contact, incomplete jumps, excessive transition gaps and multiple events in single-jump modes reject the clip. Repeated mode emits ordered, nonoverlapping complete events. A pose confidence threshold is **not** a measurement accuracy percentage. Identity checks are geometric continuity checks, not biometric identity guarantees.

These thresholds are product heuristics, not a validated contact classifier. Ankle estimates are not direct foot-ground contact measurements. Both-foot landing confirmation can bias asymmetric running landings. Crouching, plantar flexion, perspective drift and occlusion can cause late/false boundaries. All estimates remain experimental and `trainingEligible: false`. Rejected events are never saved as measurements. Accuracy must be evaluated with real clips before any detector can be claimed validated.

## Timing model

Original capture FPS is a **user-confirmed recording value**. Playback FPS is the track's nominal frame rate and is labeled as such in the UI. Actual presentation timestamps are decoded for every frame, with variable intervals retained. Elapsed capture time is the difference of presentation times only for confirmed original unretimed media. Nonzero origins are removed; frame count divided by nominal FPS is never substituted for elapsed time.

AVFoundation track segments are inspected for unequal source/target durations and empty edits. Detected retiming rejects automatic analysis. Original FPS must agree with playback rate within 3% and median decoded spacing within 15%; nonmonotonic or missing timestamps, gaps above three capture intervals, and boundary brackets wider than 100 ms reject. Irregular but resolved original VFR intervals are preserved. The pure timing library can interpolate verified piecewise capture mappings, including slow-motion segments; **the native importer does not yet establish those mappings and rejects retimed media**. Synthetic mapping tests are not proof of native slow-motion support.

Baked exports can remove their timing history. Metadata alone cannot prove the original capture timeline. The original-recording confirmation is provenance supplied by the user, not forensic authentication; an unknown/edited export must be reimported from the original, never assigned a guessed FPS. Current support deliberately excludes exported/retimed footage rather than estimating a slow-motion ratio.

Each accepted experimental event stores its capture/playback FPS, PTS sequence, timing kind, confirmation, bracket endpoints, jump type, method version, date, and timing uncertainty. Airtime midpoint is `(lastAir + firstContact - lastGround - firstAir)/2`; its lower bound is `lastAir - firstAir` and upper bound is `firstContact - lastGround`. Both bracket endpoints must be actual decoded timestamps. Timing ranges do not include detector or posture error. Heights display whole centimeters and outward-rounded ranges; no invented confidence percentage, contact time or reactive-strength index is shown.

Height uses `h = 9.80665 * t² / 8`, seconds and meters. Standard gravity is 9.80665 m/s². This assumes comparable center-of-mass height at takeoff and landing; a tucked or deep landing violates that assumption. Running and repeated jumps are particularly sensitive to contact and posture. The result is **estimated jump height**, not reach height or a force-plate-equivalent measurement. Comparisons filter by jump type, method/version and a labeled 90-day date range. Repeated jumps display individually, with mean and best height.

## Local execution and media lifecycle

PHPicker requests videos only, copies its temporary provider URL while it is valid, and retains only an opaque UUID locally. No Photos library-wide permission is requested. Cloud-only/moved/deleted provider assets produce an actionable reimport message. The import directory is disposable Caches/JumpLabImports. Picker size is checked before copying; AVFoundation validates size, duration, resolution, timing and decode success. Analysis uses a single native detached worker and a lock against concurrent runs. A per-frame autorelease pool releases sample and pixel buffers. Only scalar timestamps/events cross the JS bridge after analysis. No full-resolution frame crosses JS.

Cancel and application-background interruption set a thread-safe cancellation flag, checked between frames. The asset reader is cancelled in `defer`; successful, rejected, interrupted and cancelled analyses attempt import deletion in `defer`. Navigation unmount cancels/discards. Starting the module removes stale disposable imports from previous processes. Saved estimates contain evidence/metadata, not paths to retained clips, and remain reopenable after import deletion. OS cleanup failures are possible; cleanup is retried on next module start. Source Photos media is never deleted. Device lifecycle, disk-failure and interruption timing still need device tests.

## Annotated real-video evaluation

`fixtures/manifest.json` intentionally has no clips. Copy consented local media under `fixtures/media` (gitignored), record SHA-256, and add entries conforming to `fixtures/fixture.schema.json`. Example shape (placeholders are not an actual fixture):

```json
{
  "version": 1,
  "clips": [{
    "id": "standing-original-01", "file": "media/standing-original-01.mov",
    "sha256": "REPLACE_WITH_ACTUAL_64_CHARACTER_SHA256", "jumpType": "standing",
    "category": "original-cfr", "originalFPS": 120,
    "reference": { "method": "independent frame-by-frame contact annotation on capture timeline", "annotator": "ANNOTATOR_ID", "uncertaintySeconds": 0.0083333333 },
    "expected": { "outcome": "accept", "events": [{ "takeoffSeconds": 1.0, "landingSeconds": 1.4 }] }
  }]
}
```

Replace all illustrative times with annotations. Times are capture seconds relative to the first frame, not playback seconds of a slow-motion export. Include all three jump types, repeated/partial jumps, CFR/VFR, slow-motion and exported rejections, multiple athletes, occluded feet, low light, camera motion and poor timing. Rejection fixtures require an explanation and no accepted reference events. Record annotation uncertainty and reference method; flight-time-derived height error is not force-plate validation.

Run `npm run evaluate:video -- fixtures/manifest.json .cache/video-evaluation.json`. It validates fixtures/hashes, compiles the **production** Swift analyzer and invokes it on each clip. On macOS this exercises AVFoundation/Vision on macOS, not iOS hardware. Debug native `evaluate(path,fps,type)` permits the same pipeline to run on a test iPhone; Release does not expose that path-based test entry. Never upload footage for evaluation.

The report includes ordered one-to-one event matches (maximum match count, then minimum boundary error; 250 ms boundary tolerance), misses, false detections, rejection rate, unexpected rejection counts, takeoff/landing/airtime/height signed errors per event, aggregate mean/max absolute errors, sample counts, per-type/category results, annotation uncertainty and missing coverage. Matching tolerance is not an accuracy acceptance threshold. Zero clips exits 2 without a passing accuracy report. Missing coverage or unexpected outcomes exits 1. Even exit 0 describes only the observed sample.

## Performance protocol

Native output records elapsed decode/inference seconds, decoded-frame count, clip bytes/duration/playback FPS, OS, and `getrusage` process lifetime peak RSS in bytes. This RSS is a high-water mark for the process, not analysis-only incremental memory, and cannot attribute old peaks to later runs. Use fresh launches for individual clips, Instruments Allocations/VM Tracker for analysis-specific memory, and Time Profiler/signposts around actual analysis for UI/main-thread responsiveness. Record actual iPhone hardware identifier, iOS, app version/build/configuration, clip hash/duration/resolution/capture and playback timing, run count, cold/warm state and thermal state. Run at least five repeated analyses, cancellation mid-decode, background interruption and retries. Keep macOS, simulator and physical-device records separate. **No latency, memory, thermal or accuracy measurements are available yet.**
