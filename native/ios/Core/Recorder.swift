import Foundation

public struct TruthBinding: Equatable {
    public let recordingId: String
    public let frameId: Int
    public let targetId: String
}

public final class ProbeRecorder {
    public private(set) var active=false
    public private(set) var frames: [ProbeFrame]=[]
    public private(set) var truth: [MeasuredTruth]=[]
    public private(set) var rejected=0
    public private(set) var stopReason="user"
    public private(set) var origin: Double?
    private var recordingId="", utc="", bytes=2048
    private let maxFrames: Int, maxDuration: Double, maxBytes: Int
    public init(maxFrames: Int = 600, maxDuration: Double = 120_000, maxBytes: Int = EnvelopeWriter.byteLimit) {
        self.maxFrames=max(1,min(600,maxFrames)); self.maxDuration=maxDuration.isFinite ? max(1,min(120_000,maxDuration)) : 120_000; self.maxBytes=max(2048,min(EnvelopeWriter.byteLimit,maxBytes))
    }
    public func start(consent: Bool, liveOriginMs: Double = 0) throws {
        guard consent else { throw ProbeError.consent }; guard frames.isEmpty,!active else { throw ProbeError.alreadyHasData }
        guard liveOriginMs.isFinite,liveOriginMs>=0 else { throw ProbeError.invalid }
        recordingId="native-"+UUID().uuidString.lowercased()
        let formatter=ISO8601DateFormatter(); formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]; utc=formatter.string(from:Date())
        rejected=0; bytes=2048; origin=liveOriginMs; truth=[]; stopReason="user"; active=true
    }
    @discardableResult public func append(_ source: ProbeFrame) -> Bool {
        guard active else { return false }
        // No fixture/smoothed/model source can masquerade as native recording.
        guard source.provider == "arkit",source.rgb.timestampBasis == "sensor-capture",source.depth == nil || (source.depth!.provenance == "arkit" && source.depth!.kind == "metre-z"),source.rgb.readyAtMs>=source.rgb.capturedAtMs else { rejected+=1; return false }
        if origin == nil { origin=source.rgb.capturedAtMs }
        var f=source; f.rgb.capturedAtMs-=origin!; f.rgb.readyAtMs-=origin!
        if f.depth != nil { f.depth!.capturedAtMs-=origin! }
        guard f.rgb.capturedAtMs>=0, f.depth == nil || f.depth!.capturedAtMs>=0, frames.last.map({f.id>$0.id && f.rgb.capturedAtMs>$0.rgb.capturedAtMs}) ?? true else { rejected+=1; return false }
        if f.rgb.capturedAtMs>maxDuration { stop("time-cap"); return false }
        guard let data=try? JSONEncoder().encode(f) else { rejected+=1; return false }
        if bytes+data.count+1>maxBytes { stop("byte-cap"); return false }
        if let d=f.depth, let prior=frames.first(where:{$0.depth?.captureId==d.captureId})?.depth, prior.capturedAtMs != d.capturedAtMs { rejected+=1; return false }
        frames.append(f); bytes+=data.count+1
        if frames.count>=maxFrames { stop("frame-cap") }; return true
    }
    public func tick(liveNowMs: Double) {
        guard active,let origin else { return }
        // A broken clock must not leave an unbounded recording active.
        if !liveNowMs.isFinite || liveNowMs<origin { stop("user"); return }
        if liveNowMs-origin>=maxDuration { stop("time-cap") }
    }
    public func stop(_ reason: String = "user") { active=false; stopReason=reason }
    public func clear() { active=false; frames=[]; truth=[]; rejected=0; origin=nil; bytes=2048; recordingId=""; utc=""; stopReason="revoked" }
    public var truthBinding: TruthBinding? {
        guard let f=frames.last,let t=f.targets.first else { return nil }
        return TruthBinding(recordingId:recordingId,frameId:f.id,targetId:t.id)
    }
    public func addTruth(metres: Double, method: String, split: String, binding: TruthBinding) throws {
        guard !active,binding==truthBinding,metres.isFinite,metres>=0.01,metres<=100,["tape","laser"].contains(method),["development","holdout"].contains(split),let f=frames.last,let t=f.targets.first else { throw ProbeError.invalid }
        let label=MeasuredTruth(frameId:f.id,targetId:t.id,metres:metres,method:method,split:split)
        truth.removeAll {$0.frameId==f.id && $0.targetId==t.id}; truth.append(label)
    }
    public func snapshot() throws -> ProbeRecording {
        guard !active,!frames.isEmpty else { throw ProbeError.notStopped }
        return ProbeRecording(id:recordingId,createdUtc:utc,frames:frames,truth:truth,counters:RecordCounters(rejectedFrames:rejected,stopReason:stopReason))
    }
}
