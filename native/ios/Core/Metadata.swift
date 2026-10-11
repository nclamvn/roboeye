import Foundation
import CryptoKit
import JavaScriptCore

// Same closed field set as TIP-64A. Native JSON must also pass the web validator.
public struct Rect: Codable, Equatable {
    public var x, y, width, height: Double
    public init(x: Double, y: Double, width: Double, height: Double) { self.x = x; self.y = y; self.width = width; self.height = height }
}
public struct Calibration: Codable {
    public var fx, fy, cx, cy: Double
    public init(fx: Double, fy: Double, cx: Double, cy: Double) { self.fx = fx; self.fy = fy; self.cx = cx; self.cy = cy }
}
public struct Presentation: Codable {
    public var crop: Rect; public var rotation: Int; public var mirrored: Bool
    public init(crop: Rect, rotation: Int, mirrored: Bool = false) { self.crop = crop; self.rotation = rotation; self.mirrored = mirrored }
}
public struct RGB: Codable {
    public var capturedAtMs, readyAtMs: Double; public var width, height: Int; public var timestampBasis: String
    public init(capturedAtMs: Double, readyAtMs: Double, width: Int, height: Int, timestampBasis: String = "sensor-capture") {
        self.capturedAtMs = capturedAtMs; self.readyAtMs = readyAtMs; self.width = width; self.height = height; self.timestampBasis = timestampBasis
    }
}
public struct SupportSample: Codable {
    public var u, v, value, confidence: Double
    public init(u: Double, v: Double, value: Double, confidence: Double) { self.u = u; self.v = v; self.value = value; self.confidence = confidence }
}
public struct Depth: Codable {
    public var captureId: String; public var capturedAtMs: Double; public var kind, provenance: String; public var samples: [SupportSample]
    public init(captureId: String, capturedAtMs: Double, kind: String = "metre-z", provenance: String = "arkit", samples: [SupportSample]) {
        self.captureId = captureId; self.capturedAtMs = capturedAtMs; self.kind = kind; self.provenance = provenance; self.samples = samples
    }
}
public struct SurfaceTarget: Codable {
    public var id, label: String; public var box: Rect; public var score: Double; public var support: String; public var sampleIndices: [Int]
    public init(id: String = "probe-1", box: Rect, associated: Bool, sampleIndices: [Int]) {
        self.id = id; label = "unknown"; self.box = box; score = 0 // No semantic classifier in this phase.
        support = associated ? "foreground-associated" : "bbox-only"; self.sampleIndices = sampleIndices
    }
}
public struct ProbeFrame: Codable {
    public var schema = "assistive-frame-v1"; public var id: Int; public var clock = "session-monotonic-ms"; public var provider = "arkit"
    public var rgb: RGB; public var display: Presentation; public var intrinsics: Calibration?; public var cameraToWorld: [Double]?
    public var depth: Depth?; public var targets: [SurfaceTarget]
    public init(id: Int, rgb: RGB, display: Presentation, intrinsics: Calibration?, cameraToWorld: [Double]?, depth: Depth?, targets: [SurfaceTarget]) {
        self.id = id; self.rgb = rgb; self.display = display; self.intrinsics = intrinsics; self.cameraToWorld = cameraToWorld; self.depth = depth; self.targets = targets
    }
    // Codable's default omits nil; the closed web contract requires explicit nulls.
    enum CodingKeys: String, CodingKey { case schema, id, clock, provider, rgb, display, intrinsics, cameraToWorld, depth, targets }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schema, forKey: .schema); try c.encode(id, forKey: .id); try c.encode(clock, forKey: .clock); try c.encode(provider, forKey: .provider)
        try c.encode(rgb, forKey: .rgb); try c.encode(display, forKey: .display); try c.encode(intrinsics, forKey: .intrinsics)
        try c.encode(cameraToWorld, forKey: .cameraToWorld); try c.encode(depth, forKey: .depth); try c.encode(targets, forKey: .targets)
    }
}
public struct MeasuredTruth: Codable {
    public var frameId: Int; public var targetId: String; public var metres: Double; public var kind = "camera-to-supported-point"; public var method, split: String
    public init(frameId: Int, targetId: String, metres: Double, method: String, split: String) { self.frameId = frameId; self.targetId = targetId; self.metres = metres; self.method = method; self.split = split }
}
public struct RecordCounters: Codable {
    public var rejectedFrames: Int; public var stopReason: String
    public init(rejectedFrames: Int, stopReason: String) { self.rejectedFrames=rejectedFrames; self.stopReason=stopReason }
}
public struct ProbeRecording: Codable {
    public var schema = "assistive-recording-v1"; public var id, createdUtc: String; public var origin = "native-import"; public var consent = "metadata-only"
    public var frames: [ProbeFrame]; public var truth: [MeasuredTruth]; public var counters: RecordCounters
    public init(id: String, createdUtc: String, frames: [ProbeFrame], truth: [MeasuredTruth], counters: RecordCounters) {
        self.id = id; self.createdUtc = createdUtc; self.frames = frames; self.truth = truth; self.counters = counters
    }
}
public enum ProbeError: Error { case invalid, consent, alreadyHasData, notStopped, byteCap, serialization }

public enum EnvelopeWriter {
    public static let byteLimit = 2 * 1024 * 1024
    // Match JS number formatting and sorted-key canonicalization exactly, including
    // exponent notation/-0. Constant code only; never evaluate imported source.
    public static func export(_ recording: ProbeRecording) throws -> Data {
        let raw = try JSONEncoder().encode(recording)
        guard raw.count <= byteLimit, let context = JSContext() else { throw ProbeError.byteCap }
        context.evaluateScript("function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.entries(v).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(v);}")
        let value = try JSONSerialization.jsonObject(with: raw)
        guard let text = context.objectForKeyedSubscript("canonical")?.call(withArguments: [value])?.toString(), context.exception == nil else { throw ProbeError.serialization }
        let sha = SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
        let envelope = Data(("{\"schema\":\"assistive-envelope-v1\",\"recording\":" + text + ",\"sha256\":\"" + sha + "\"}").utf8)
        guard envelope.count <= byteLimit else { throw ProbeError.byteCap }; return envelope
    }
}

// One bounded snapshot, no queue of export jobs. Serialization/JS hashing never
// runs on UIKit's main thread. Cancellation prevents publication, not immediate
// erasure of a snapshot already being processed on the worker.
public final class SnapshotExporter {
    private let queue=DispatchQueue(label:"com.roboeye.depth-export",qos:.utility)
    private let lock=NSLock()
    private var generation=0, busy=false
    public init() {}
    public var isBusy: Bool { lock.lock(); defer {lock.unlock()}; return busy }
    public func cancel() { lock.lock(); generation+=1; lock.unlock() }
    @discardableResult public func submit(_ snapshot: ProbeRecording,
        writer: @escaping (ProbeRecording) throws -> Data = EnvelopeWriter.export,
        completion: @escaping (Result<Data,Error>?) -> Void) -> Bool {
        lock.lock()
        guard !busy else { lock.unlock(); return false }
        busy=true; generation+=1; let ticket=generation; lock.unlock()
        queue.async { [self] in
            let result: Result<Data,Error> = autoreleasepool { Result { try writer(snapshot) } }
            DispatchQueue.main.async { [self] in
                lock.lock(); let current=ticket==generation; busy=false; lock.unlock()
                completion(current ? result : nil)
            }
        }
        return true
    }
}
