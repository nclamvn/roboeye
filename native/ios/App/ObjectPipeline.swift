import ARKit
import CoreML
import Vision
import QuartzCore
import ImageIO

// The sole camera owner is DepthSession/ARKit. Only one RGB+depth frame may be
// retained by this worker; submit drops frames while it is busy, never queues them.
struct ObjectFrameContext {
    let frame: ARFrame
    let epoch: Int
    let id: Int
    let originSeconds: Double
    let capturedAtMs: Double
    let width: Int
    let height: Int
    let display: Presentation
    let displayTransform: Affine
    let calibration: Calibration
    let pose: [Double]?
    let trackingNormal: Bool
    let thermalLimited: Bool
    var recordingRequested=false
}

struct ObjectPresentation {
    let tracks: [ObjectTrack]
    let transform: Affine
    var frame: ProbeFrame?
    let nowMs: Double
    let workMs: Double
    let captureToReadyMs: Double
    let message: String
    var diag:ObjectRuntimeDiagnostics?=nil
}

final class ObjectPipeline {
    private let queue=DispatchQueue(label:"com.roboeye.assist.objects",qos:.userInitiated)
    private let lock=NSLock()
    private var generation=0, busy=false
    private var busyDrops=0,retrySkips=0,blocked=false,retryAtMs:Double?,restartRequested=false
    // Everything below belongs exclusively to the serial worker.
    private var stateGeneration = -1
    private var tracker=ObjectTracker(maxTracks:12,coastMs:600,maxDetectionGapMs:3000)
    private var model: VNCoreMLModel?
    private var detectionRequest:VNCoreMLRequest?
    private let descriptor=ObjectModelDescriptor.shipping
    private var retry=ObjectRetryPolicy(),statistics=ObjectRuntimeStatistics()
    private var sequence=VNSequenceRequestHandler()
    private var trackingRequests:[Int:VNTrackObjectRequest]=[:]
    private var lastDetectionSeconds: Double = -1
    private var lastImageSize=CGSize.zero
    private var detectorCalls=0,trackerCalls=0,maxInferenceMs:Double=0,summaryPrinted=false
    var onOutput: ((Int,ObjectPresentation) -> Void)?

    var isBusy: Bool { lock.lock(); defer {lock.unlock()}; return busy }
    func restart() {
        lock.lock();generation+=1;restartRequested=true;blocked=false;retryAtMs=nil;busyDrops=0;retrySkips=0;lock.unlock()
    }
    func invalidate(releaseModel: Bool = false) {
        lock.lock(); generation+=1; lock.unlock()
        if releaseModel {
            queue.async { [weak self] in
                self?.model=nil;self?.detectionRequest=nil; self?.trackingRequests=[:]; self?.sequence=VNSequenceRequestHandler()
            }
        }
    }
    private func isCurrent(_ ticket:Int) -> Bool {
        lock.lock(); defer {lock.unlock()}; return generation==ticket
    }
    @discardableResult func submit(_ context:ObjectFrameContext) -> Bool {
        lock.lock()
        guard !blocked,retryAtMs.map({context.capturedAtMs >= $0}) ?? true else {retrySkips+=1;lock.unlock();return false}
        guard !busy else {busyDrops+=1; lock.unlock(); return false }
        busy=true; let ticket=generation; lock.unlock()
        queue.async { [weak self] in
            guard let self else { return }
            let output: ObjectPresentation? = autoreleasepool {
                guard self.isCurrent(ticket) else { return nil }
                if self.stateGeneration != ticket {
                    self.stateGeneration=ticket; self.tracker.reset(); self.trackingRequests=[:]
                    self.sequence=VNSequenceRequestHandler(); self.lastDetectionSeconds = -1
                    self.detectorCalls=0;self.trackerCalls=0;self.maxInferenceMs=0;self.summaryPrinted=false
                    self.lock.lock();let restart=self.restartRequested;self.restartRequested=false;self.lock.unlock()
                    if restart {self.retry.reset();self.statistics=ObjectRuntimeStatistics()}
                }
                return self.process(context,ticket:ticket)
            }
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.lock.lock(); self.busy=false; let current=self.generation==ticket; self.lock.unlock()
                if current,let output { self.onOutput?(context.epoch,output) }
            }
        }
        return true
    }
    private func loadModel() throws -> VNCoreMLModel {
        if let model { return model }
        guard descriptor.valid else {throw ObjectRuntimeFailure.invalidModel}
        guard let url=Bundle.main.url(forResource:descriptor.resourceName,withExtension:"mlmodelc") else {throw ObjectRuntimeFailure.missingModel}
        let configuration=MLModelConfiguration(); configuration.computeUnits = .all
        let loaded:MLModel
        do {loaded=try MLModel(contentsOf:url,configuration:configuration)} catch {throw ObjectRuntimeFailure.invalidModel}
        let description=loaded.modelDescription
        guard let image=description.inputDescriptionsByName[descriptor.imageInput],image.type == .image,
              image.imageConstraint?.pixelsWide==descriptor.imageWidth,image.imageConstraint?.pixelsHigh==descriptor.imageHeight,
              description.inputDescriptionsByName[descriptor.confidenceInput]?.type == .double,
              description.inputDescriptionsByName[descriptor.iouInput]?.type == .double,
              description.outputDescriptionsByName[descriptor.confidenceOutput]?.multiArrayConstraint?.shape.last?.intValue==descriptor.classCount,
              description.outputDescriptionsByName[descriptor.coordinateOutput]?.multiArrayConstraint?.shape.last?.intValue==4 else {throw ObjectRuntimeFailure.invalidModel}
        do {
            let next=try VNCoreMLModel(for:loaded)
            next.featureProvider=try MLDictionaryFeatureProvider(dictionary:[descriptor.confidenceInput:descriptor.confidenceThreshold,descriptor.iouInput:descriptor.iouThreshold])
            model=next; return next
        } catch {throw ObjectRuntimeFailure.invalidModel}
    }
    private func cachedDetectionRequest() throws -> VNCoreMLRequest {
        if let detectionRequest {return detectionRequest}
        let request=VNCoreMLRequest(model:try loadModel());request.imageCropAndScaleOption = .scaleFill
        detectionRequest=request;return request
    }
    private func diagnosticSnapshot() -> ObjectRuntimeDiagnostics {
        lock.lock();let drops=busyDrops,skips=retrySkips;lock.unlock()
        return statistics.snapshot(busyDrops:drops,retrySkips:skips)
    }
    private func process(_ c:ObjectFrameContext,ticket:Int) -> ObjectPresentation? {
        let begun=CACurrentMediaTime(), captureSeconds=c.frame.timestamp
        let interval=ObjectRuntimeStatistics.detectionInterval(thermalLimited:c.thermalLimited,p95WorkMs:diagnosticSnapshot().work.p95Ms)
        var inferenceMs:Double?,trackingMs:Double?
        var message="Nhận diện trên máy · khoảng cách tới bề mặt, 0,5–5 m"
        do {
            let rgb=c.frame.capturedImage
            guard !c.display.mirrored else { throw ProbeError.invalid }
            let orientation:CGImagePropertyOrientation
            switch c.display.rotation {
            case 0: orientation = .up
            case 90: orientation = .right
            case 180: orientation = .down
            case 270: orientation = .left
            default: throw ProbeError.invalid
            }
            if lastImageSize != CGSize(width:c.width,height:c.height) {
                tracker.reset(); trackingRequests=[:]; sequence=VNSequenceRequestHandler()
                lastImageSize=CGSize(width:c.width,height:c.height); lastDetectionSeconds = -1
            }
            var tracks:[ObjectTrack]
            if lastDetectionSeconds<0 || captureSeconds-lastDetectionSeconds>=interval {
                let request=try cachedDetectionRequest()
                let handler=VNImageRequestHandler(cvPixelBuffer:rgb,orientation:orientation,options:[:])
                let inferenceStart=CACurrentMediaTime()
                do {try handler.perform([request])} catch {
                    inferenceMs=(CACurrentMediaTime()-inferenceStart)*1000
                    throw error
                }
                inferenceMs=(CACurrentMediaTime()-inferenceStart)*1000
                detectorCalls+=1;maxInferenceMs=max(maxInferenceMs,inferenceMs!)
                guard isCurrent(ticket) else { return nil }
                guard let raw=request.results else {throw ObjectRuntimeFailure.unsupportedOutput}
                guard raw.allSatisfy({$0 is VNRecognizedObjectObservation}) else {throw ObjectRuntimeFailure.unsupportedOutput}
                let observations=raw.compactMap {$0 as? VNRecognizedObjectObservation}.compactMap { result -> ObjectDetection? in
                    guard let label=result.labels.first else {return nil}
                    // Vision exposes object presence separately from class
                    // confidence. Their product is the actual recognition gate.
                    let confidence=Double(label.confidence)*Double(result.confidence)
                    guard confidence.isFinite,confidence>=descriptor.confidenceThreshold,confidence<=1,
                          let box=ObjectBoxGeometry.rawNormalizedBox(fromVision:Rect(x:result.boundingBox.minX,y:result.boundingBox.minY,width:result.boundingBox.width,height:result.boundingBox.height),rotation:c.display.rotation) else { return nil }
                    return ObjectDetection(label:label.identifier,score:confidence,box:box)
                }
                tracks=tracker.update(observations,atMs:c.capturedAtMs)
                lastDetectionSeconds=captureSeconds; sequence=VNSequenceRequestHandler()
                trackingRequests=Dictionary(uniqueKeysWithValues:tracks.filter {!$0.isCoasting}.compactMap { track -> (Int,VNTrackObjectRequest)? in
                    guard let r=ObjectBoxGeometry.visionBox(fromRaw:track.box,rotation:c.display.rotation) else { return nil }
                    let vision=CGRect(x:r.x,y:r.y,width:r.width,height:r.height)
                    let request=VNTrackObjectRequest(detectedObjectObservation:VNDetectedObjectObservation(boundingBox:vision))
                    request.trackingLevel = .fast
                    return (track.id,request)
                })
            } else {
                let ids=trackingRequests.keys.sorted()
                let requests=ids.compactMap {trackingRequests[$0]}
                if !requests.isEmpty {
                    let start=CACurrentMediaTime()
                    do {try sequence.perform(requests,on:rgb,orientation:orientation)} catch {
                        trackingMs=(CACurrentMediaTime()-start)*1000;throw error
                    }
                    trackingMs=(CACurrentMediaTime()-start)*1000;trackerCalls+=1
                }
                guard isCurrent(ticket) else { return nil }
                var boxes:[Int:Rect]=[:]
                for id in ids {
                    guard let request=trackingRequests[id],let result=request.results?.first as? VNDetectedObjectObservation,
                          result.confidence>=0.45,
                          let box=ObjectBoxGeometry.rawNormalizedBox(fromVision:Rect(x:result.boundingBox.minX,y:result.boundingBox.minY,width:result.boundingBox.width,height:result.boundingBox.height),rotation:c.display.rotation) else {
                        trackingRequests.removeValue(forKey:id); continue
                    }
                    boxes[id]=box; request.inputObservation=result
                }
                tracks=tracker.updateTrackedBoxes(boxes,atMs:c.capturedAtMs)
            }
            guard isCurrent(ticket) else { return nil }
            var recordingInputs:[ObjectRecordingInput]=[],ranges:[Int:ProbeResult]=[:]
            let depthStart=CACurrentMediaTime()
            let batch=ObjectDepthSampling.batch(c.frame.sceneDepth,tracks:tracks.filter {!$0.isCoasting},rgbWidth:c.width,rgbHeight:c.height)
            for track in tracks where !track.isCoasting {
                let samples=batch.samples[track.id] ?? []
                let now=(CACurrentMediaTime()-c.originSeconds)*1000
                ranges[track.id]=ObjectRangeEstimator.evaluate(box:track.box,samples:samples,calibration:c.calibration,
                    rgbWidth:c.width,rgbHeight:c.height,rgbCapturedAtMs:c.capturedAtMs,
                    depthCapturedAtMs:c.frame.sceneDepth == nil ? nil:c.capturedAtMs,nowMs:now,
                    trackingNormal:c.trackingNormal,sameFrame:true,label:track.label)
                if c.recordingRequested {recordingInputs.append(ObjectRecordingInput(id:track.id,label:track.label,score:track.score,box:track.box,samples:samples))}
            }
            let depthMs=(CACurrentMediaTime()-depthStart)*1000
            // This tested projection preserves128 TOTAL supports, closed8-label
            // vocabulary and bbox-only provenance. Live range above uses ALL64
            // supports/object, independently of the smaller interchange budget.
            let recording=c.recordingRequested ? ObjectExportProjection.project(recordingInputs,imageWidth:c.width,imageHeight:c.height):nil
            let ready=(CACurrentMediaTime()-c.originSeconds)*1000
            tracks=tracker.setRanges(ranges,capturedAtMs:c.capturedAtMs,nowMs:ready)
            logSummaryIfRequested(c,tracks:tracks)
            let packet=recording.map {projection -> ProbeFrame in
                let depth=c.frame.sceneDepth == nil ? nil : Depth(captureId:"arkit-\(Int64(captureSeconds*1_000_000_000))",capturedAtMs:c.capturedAtMs,samples:projection.samples)
                return ProbeFrame(id:c.id,rgb:RGB(capturedAtMs:c.capturedAtMs,readyAtMs:ready,width:c.width,height:c.height),display:c.display,intrinsics:c.calibration,cameraToWorld:c.pose,depth:depth,targets:projection.targets)
            }
            // Cancellation may happen during depth sampling. An old worker may
            // neither publish nor overwrite the next camera epoch's retry gate.
            lock.lock();guard generation==ticket else {lock.unlock();return nil};retryAtMs=nil;lock.unlock()
            retry.succeeded()
            statistics.observe(workMs:(CACurrentMediaTime()-begun)*1000,captureReadyMs:ready-c.capturedAtMs,inferenceMs:inferenceMs,trackingMs:trackingMs,depthMs:depthMs,depthLockPairs:batch.lockPairs,projected:c.recordingRequested)
            if !c.trackingNormal { message="Camera chưa định vị ổn định · chỉ nhận diện, chưa đo" }
            else if c.thermalLimited { message="Máy nóng · giảm nhịp AI; không giữ số đo cũ" }
            else if tracks.isEmpty { message="Đang tìm người và đồ vật thuộc 80 nhóm hỗ trợ" }
            return ObjectPresentation(tracks:tracks,transform:c.displayTransform,frame:packet,nowMs:ready,
                workMs:(CACurrentMediaTime()-begun)*1000,captureToReadyMs:ready-c.capturedAtMs,message:message,diag:diagnosticSnapshot())
        } catch {
            guard isCurrent(ticket) else {return nil}
            tracker.reset(); trackingRequests=[:]
            logSummaryIfRequested(c,tracks:[])
            let now=(CACurrentMediaTime()-c.originSeconds)*1000
            let kind=(error as? ObjectRuntimeFailure) ?? .vision
            statistics.observe(workMs:(CACurrentMediaTime()-begun)*1000,captureReadyMs:now-c.capturedAtMs,inferenceMs:inferenceMs,trackingMs:trackingMs,depthMs:nil,depthLockPairs:0,projected:false)
            retry.failed(kind,atMs:now);statistics.failure(kind)
            lock.lock();guard generation==ticket else {lock.unlock();return nil};blocked=retry.blocked;retryAtMs=retry.nextAttemptAtMs;lock.unlock()
            let message:String
            switch kind {
            case .missingModel:message="Thiếu mô hình trong bản cài. Cần build lại app; không tự tải model."
            case .invalidModel,.unsupportedOutput:message="Mô hình không tương thích với cấu hình nhận diện. Cần kiểm tra bản cài."
            case .vision:message="AI tạm lỗi; đang thử lại có giãn nhịp. Xem Chẩn đoán nếu lỗi kéo dài."
            }
            return ObjectPresentation(tracks:[],transform:c.displayTransform,frame:nil,nowMs:now,
                workMs:(CACurrentMediaTime()-begun)*1000,captureToReadyMs:now-c.capturedAtMs,
                message:message,diag:diagnosticSnapshot())
        }
    }
    private func logSummaryIfRequested(_ c:ObjectFrameContext,tracks:[ObjectTrack]) {
        guard !summaryPrinted,c.capturedAtMs>=15_000,ProcessInfo.processInfo.arguments.contains("--qa-live-camera") else {return}
        summaryPrinted=true
        // One aggregate receipt only: no images, labels, scene details, raw depth
        // or automatic consent/recording. This is physical, not fixture evidence.
        NSLog("RoboEyeAssist physicalQA modelLoaded=%d detectorCalls=%d trackerCalls=%d objectCount=%d metricCount=%d maxInferenceMs=%.1f thermal=%ld",
            model == nil ? 0:1,detectorCalls,trackerCalls,tracks.count,tracks.filter {$0.range.metres != nil}.count,maxInferenceMs,ProcessInfo.processInfo.thermalState.rawValue)
    }
}

enum ObjectDepthSampling {
    // A bounded 8x8 grid strictly inside the box. Unique co-registered depth
    // pixels only; the estimator may reject incoherent mixtures. A coherent box
    // interior is still approximate surface evidence, not instance segmentation.
    // Lock the two immutable same-frame buffers just once, irrespective of the
    // number of objects. There is no retained pointer or depth history.
    static func batch(_ data:ARDepthData?,tracks:[ObjectTrack],rgbWidth:Int,rgbHeight:Int) -> (samples:[Int:[SupportSample]],lockPairs:Int) {
        guard !tracks.isEmpty,let data,let confidence=data.confidenceMap,rgbWidth>1,rgbHeight>1 else { return ([:],0) }
        let depth=data.depthMap, dw=CVPixelBufferGetWidth(depth), dh=CVPixelBufferGetHeight(depth)
        guard dw>1,dh>1,!CVPixelBufferIsPlanar(depth),!CVPixelBufferIsPlanar(confidence),
              CVPixelBufferGetPixelFormatType(depth)==kCVPixelFormatType_DepthFloat32,
              CVPixelBufferGetPixelFormatType(confidence)==kCVPixelFormatType_OneComponent8,
              CVPixelBufferGetWidth(confidence)==dw,CVPixelBufferGetHeight(confidence)==dh,
              CVPixelBufferGetBytesPerRow(depth)>=dw*4,CVPixelBufferGetBytesPerRow(confidence)>=dw else { return ([:],0) }
        guard CVPixelBufferLockBaseAddress(depth,.readOnly)==kCVReturnSuccess else { return ([:],0) }
        defer {CVPixelBufferUnlockBaseAddress(depth,.readOnly)}
        guard CVPixelBufferLockBaseAddress(confidence,.readOnly)==kCVReturnSuccess else { return ([:],0) }
        defer {CVPixelBufferUnlockBaseAddress(confidence,.readOnly)}
        guard let base=CVPixelBufferGetBaseAddress(depth),let conf=CVPixelBufferGetBaseAddress(confidence) else { return ([:],1) }
        let depthStride=CVPixelBufferGetBytesPerRow(depth),confidenceStride=CVPixelBufferGetBytesPerRow(confidence)
        var output:[Int:[SupportSample]]=[:]
        for track in tracks.prefix(12) {
            output[track.id]=samples(box:track.box,base:base,confidence:conf,depthWidth:dw,depthHeight:dh,depthStride:depthStride,confidenceStride:confidenceStride,rgbWidth:rgbWidth,rgbHeight:rgbHeight)
        }
        return (output,1)
    }
    private static func samples(box:Rect,base:UnsafeMutableRawPointer,confidence:UnsafeMutableRawPointer,depthWidth dw:Int,depthHeight dh:Int,depthStride:Int,confidenceStride:Int,rgbWidth:Int,rgbHeight:Int) -> [SupportSample] {
        let margin=0.20
        let x0=box.x+box.width*margin, y0=box.y+box.height*margin
        let width=box.width*(1-2*margin), height=box.height*(1-2*margin)
        guard x0>=0,y0>=0,width>0,height>0,x0+width<=1,y0+height<=1 else { return [] }
        var output:[SupportSample]=[], visited=Set<Int>()
        for row in 0..<8 { for column in 0..<8 {
            let x=min(dw-1,max(0,Int((x0+(Double(column)+0.5)*width/8)*Double(dw))))
            let y=min(dh-1,max(0,Int((y0+(Double(row)+0.5)*height/8)*Double(dh))))
            guard visited.insert(y*dw+x).inserted else { continue }
            let z=Double(base.advanced(by:y*depthStride).assumingMemoryBound(to:Float.self)[x])
            let raw=confidence.advanced(by:y*confidenceStride).assumingMemoryBound(to:UInt8.self)[x]
            let p=ProbeGeometry.rgbPixel(depthX:x,depthY:y,depthWidth:dw,depthHeight:dh,rgbWidth:rgbWidth,rgbHeight:rgbHeight)
            if z.isFinite,z>0,z<=100,p.x>=0,p.y>=0,p.x<=Double(rgbWidth-1),p.y<=Double(rgbHeight-1) {
                output.append(SupportSample(u:p.x,v:p.y,value:z,confidence:ProbeGeometry.confidence(raw)))
            }
        } }
        return output
    }
}
