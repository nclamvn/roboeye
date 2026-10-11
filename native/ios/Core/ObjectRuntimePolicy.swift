import Foundation

public struct ObjectModelDescriptor:Equatable {
    public var id="apple-yolov3-fp16",resourceName="YOLOv3FP16",imageInput="image"
    public var confidenceInput="confidenceThreshold",iouInput="iouThreshold"
    public var confidenceOutput="confidence",coordinateOutput="coordinates"
    public var imageWidth=416,imageHeight=416,classCount=80
    public var confidenceThreshold:Double=0.38,iouThreshold:Double=0.45
    public init() {}
    public static let shipping=ObjectModelDescriptor()
    public var valid:Bool {
        let names=[id,resourceName,imageInput,confidenceInput,iouInput,confidenceOutput,coordinateOutput]
        return names.allSatisfy {$0.range(of:"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$",options:.regularExpression) != nil}
            && imageWidth>0 && imageWidth<=2048 && imageHeight>0 && imageHeight<=2048 && classCount==80
            && confidenceThreshold.isFinite && confidenceThreshold>0 && confidenceThreshold<=1
            && iouThreshold.isFinite && iouThreshold>0 && iouThreshold<=1
    }
}

public enum ObjectRuntimeFailure:String,Error {
    case missingModel="missing-model",invalidModel="invalid-model",unsupportedOutput="unsupported-model-output",vision="vision-failure"
    public var terminal:Bool {self != .vision}
}
public struct ObjectRetryPolicy {
    public private(set) var blocked=false,nextAttemptAtMs:Double?,consecutiveFailures=0
    public init() {}
    public mutating func reset() {self=ObjectRetryPolicy()}
    public mutating func succeeded() {consecutiveFailures=0;nextAttemptAtMs=nil}
    public mutating func failed(_ failure:ObjectRuntimeFailure,atMs:Double) {
        consecutiveFailures=min(100,consecutiveFailures+1)
        if failure.terminal || !atMs.isFinite || atMs<0 {blocked=true;nextAttemptAtMs=nil;return}
        nextAttemptAtMs=atMs+min(2000,250*pow(2,Double(min(3,consecutiveFailures-1))))
    }
    public func permits(_ nowMs:Double) -> Bool {nowMs.isFinite && nowMs>=0 && !blocked && (nextAttemptAtMs.map {nowMs >= $0} ?? true)}
}

public struct ObjectLatencySummary:Equatable {
    public var sampleCount:Int=0,p50Ms:Double?,p95Ms:Double?
    public init(sampleCount:Int=0,p50Ms:Double?=nil,p95Ms:Double?=nil) {self.sampleCount=sampleCount;self.p50Ms=p50Ms;self.p95Ms=p95Ms}
}
public struct ObjectLatencyWindow {
    private var values:[Double]=[]
    public let capacity:Int
    public init(capacity:Int=64) {self.capacity=min(64,max(1,capacity))}
    public mutating func observe(_ ms:Double) {
        guard ms.isFinite,ms>=0,ms<=60_000 else {return}
        if values.count==capacity {values.removeFirst()};values.append(ms)
    }
    public var summary:ObjectLatencySummary {
        let sorted=values.sorted()
        func quantile(_ p:Double) -> Double? {
            guard !sorted.isEmpty else {return nil}
            // Nearest-rank, matching the repository's runtime QA receipts.
            return sorted[max(0,min(sorted.count-1,Int(ceil(p*Double(sorted.count)))-1))]
        }
        return ObjectLatencySummary(sampleCount:sorted.count,p50Ms:quantile(0.5),p95Ms:quantile(0.95))
    }
}
public struct ObjectRuntimeDiagnostics {
    public var modelId:String,phase:String,lastFailure:String?
    public var detectorCalls=0,trackerCalls=0,busyDrops=0,retrySkips=0,failureCount=0,depthLockPairs=0,metadataProjections=0
    public var work=ObjectLatencySummary(),captureReady=ObjectLatencySummary(),inference=ObjectLatencySummary(),tracking=ObjectLatencySummary(),depth=ObjectLatencySummary()
    public init(modelId:String=ObjectModelDescriptor.shipping.id,phase:String="idle") {self.modelId=modelId;self.phase=phase}
}
public struct ObjectRuntimeStatistics {
    private var work=ObjectLatencyWindow(),captureReady=ObjectLatencyWindow(),inference=ObjectLatencyWindow(),tracking=ObjectLatencyWindow(),depth=ObjectLatencyWindow()
    public private(set) var diagnostic=ObjectRuntimeDiagnostics()
    public init() {}
    public mutating func observe(workMs:Double,captureReadyMs:Double,inferenceMs:Double?,trackingMs:Double?,depthMs:Double?,depthLockPairs:Int,projected:Bool) {
        work.observe(workMs);captureReady.observe(captureReadyMs)
        if let value=depthMs {depth.observe(value)}
        if let value=inferenceMs {inference.observe(value);diagnostic.detectorCalls+=1}
        if let value=trackingMs {tracking.observe(value);diagnostic.trackerCalls+=1}
        diagnostic.depthLockPairs+=max(0,min(1,depthLockPairs));if projected {diagnostic.metadataProjections+=1}
        diagnostic.phase="ready"
    }
    public mutating func failure(_ kind:ObjectRuntimeFailure) {diagnostic.failureCount+=1;diagnostic.lastFailure=kind.rawValue;diagnostic.phase=kind.terminal ? "blocked":"retrying"}
    public func snapshot(busyDrops:Int,retrySkips:Int) -> ObjectRuntimeDiagnostics {
        var d=diagnostic;d.busyDrops=max(0,busyDrops);d.retrySkips=max(0,retrySkips)
        d.work=work.summary;d.captureReady=captureReady.summary;d.inference=inference.summary;d.tracking=tracking.summary;d.depth=depth.summary
        return d
    }
    public static func detectionInterval(thermalLimited:Bool,p95WorkMs:Double?) -> Double {
        let base=thermalLimited ? 0.4:0.2
        guard let work=p95WorkMs,work.isFinite,work>=0 else {return base}
        return min(1,max(base,work/1000*2))
    }
}
