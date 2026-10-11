import ARKit
import AVFoundation
import UIKit
import QuartzCore

// UIKit owns this object; delegate queue is main. No task per frame, no retained
// RGB/depth history, and no second camera capture owner. Depth sampling is bounded.
final class DepthSession: NSObject, ARSessionDelegate {
    var onUpdate: ((ProbeFrame?, ProbeResult, String) -> Void)?
    var onObjects: ((ObjectPresentation?) -> Void)?
    var onSuspend: (() -> Void)?
    private(set) var running=false
    private(set) var starting=false
    private(set) var preview: ARSCNView?
    private var permissionEpoch=0, sequence=0
    private var clock=FrameClock(), lastProcessed: Double = -1
    private var selected: Point?, surfaceConfirmed=false
    private var packet: ProbeFrame?, trackingNormal=false
    private var expiryTimer: Timer?
    private var startedAt: Double = 0, previousIdleTimer: Bool?
    private let objects=ObjectPipeline()
    private var objectEpoch=0, objectOutput:ObjectPresentation?, rotationKey:Int?
    private var startupNoticeSent=false
    var recordingRequested=false
    var automatic=true {
        didSet { if oldValue != automatic { invalidateObjects(); select(nil) } }
    }
    var viewport: CGSize = .zero {
        didSet { if oldValue != viewport { invalidateObjects(); select(nil) } }
    }
    var liveNowMs: Double? { clock.origin.map {(CACurrentMediaTime()-$0)*1000} }
    static var supported: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return ARWorldTrackingConfiguration.isSupported && ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        #endif
    }
    func attach(to parent: UIView) {
        guard Self.supported, preview == nil else { return }
        let view=ARSCNView(frame:parent.bounds)
        view.autoresizingMask=[.flexibleWidth,.flexibleHeight]; view.preferredFramesPerSecond=30
        view.automaticallyUpdatesLighting=false; view.autoenablesDefaultLighting=false
        view.session.delegate=self; view.session.delegateQueue=DispatchQueue.main
        preview=view; parent.insertSubview(view,at:0)
        objects.onOutput={ [weak self] epoch,output in
            guard let self,self.running,self.automatic,epoch==self.objectEpoch,
                  UIApplication.shared.applicationState == .active else { return }
            var presentation=output
            // Consent can be withdrawn while Vision is working on a frame.
            if !self.recordingRequested {presentation.frame=nil}
            self.objectOutput=presentation
            self.onObjects?(presentation)
        }
    }
    func start() {
        guard !running,!starting else { return }
        guard Self.supported, let preview else { invalidate("Thiết bị này không hỗ trợ ARKit sceneDepth/LiDAR."); return }
        starting=true; invalidate("Đang xin quyền / khởi động camera. Có thể bấm Huỷ mở camera.")
        permissionEpoch+=1; let ticket=permissionEpoch
        func begin(_ allowed: Bool) {
            DispatchQueue.main.async { [weak self] in
                guard let self,ticket==self.permissionEpoch else { return }
                self.starting=false
                guard allowed,UIApplication.shared.applicationState == .active else { self.invalidate(allowed ? "Bấm Mở camera khi app đang ở phía trước." : "Camera bị từ chối. Mở Cài đặt để cấp quyền cho app."); return }
                self.clock=FrameClock(); self.lastProcessed = -1; self.sequence=0; self.packet=nil
                self.invalidateObjects()
                self.objects.restart();self.startupNoticeSent=false
                let config=ARWorldTrackingConfiguration(); config.frameSemantics=[.sceneDepth]
                config.worldAlignment = .gravity; config.isLightEstimationEnabled=false
                // No AR plane/mesh/geo tracking, no smoothedSceneDepth.
                let formats=ARWorldTrackingConfiguration.supportedVideoFormats.filter {$0.framesPerSecond==30 && $0.imageResolution.width>=1280}
                if let small=formats.min(by:{$0.imageResolution.width*$0.imageResolution.height < $1.imageResolution.width*$1.imageResolution.height}) { config.videoFormat=small }
                self.running=true; self.startedAt=CACurrentMediaTime()
                self.previousIdleTimer=UIApplication.shared.isIdleTimerDisabled
                UIApplication.shared.isIdleTimerDisabled=true
                self.select(nil)
                preview.session.run(config,options:[.resetTracking,.removeExistingAnchors])
                self.expiryTimer?.invalidate()
                let timer=Timer(timeInterval:0.1,repeats:true) { [weak self] _ in self?.expire() }
                self.expiryTimer=timer; RunLoop.main.add(timer,forMode:.common)
            }
        }
        switch AVCaptureDevice.authorizationStatus(for:.video) {
        case .authorized: begin(true)
        case .notDetermined: AVCaptureDevice.requestAccess(for:.video,completionHandler:begin)
        default: begin(false)
        }
    }
    func stop() {
        permissionEpoch+=1; running=false; starting=false; recordingRequested=false; preview?.session.pause()
        if let previousIdleTimer { UIApplication.shared.isIdleTimerDisabled=previousIdleTimer; self.previousIdleTimer=nil }
        expiryTimer?.invalidate(); expiryTimer=nil; packet=nil; selected=nil; surfaceConfirmed=false; trackingNormal=false
        invalidateObjects()
        invalidate("Camera đã dừng. Không dùng số đo cũ.")
    }
    func select(_ point: Point?) { selected=point; surfaceConfirmed=false; packet=nil; invalidate(point == nil ? "Chạm một điểm trên bề mặt vật để chọn vùng đo." : "Giữ tâm ngắm trên vật rồi bấm Đo vùng này.") }
    func confirmSurface() { if selected != nil { surfaceConfirmed=true } }
    private func invalidate(_ message: String) {
        // A hard camera/geometry failure must not be hidden behind the previous
        // successful object presentation. Cancel its epoch before surfacing it.
        if automatic,objectOutput != nil {invalidateObjects()}
        onUpdate?(nil,ProbeResult(reason:"unavailable"),message)
    }
    private func invalidateObjects() {
        objectEpoch+=1; objects.invalidate(); objectOutput=nil; rotationKey=nil; onObjects?(nil)
    }
    func releaseModelForMemoryPressure() { objects.invalidate(releaseModel:true) }
    private func expire() {
        guard running else { return }
        guard UIApplication.shared.applicationState == .active else { stop(); onSuspend?(); invalidate("App không ở phía trước. Mở lại camera để tiếp tục."); return }
        if ProcessInfo.processInfo.thermalState == .critical { stop(); onSuspend?(); invalidate("Máy quá nóng. Camera đã dừng; để máy nguội rồi mở lại."); return }
        let thermal=ProcessInfo.processInfo.thermalState
        preview?.preferredFramesPerSecond = thermal == .serious ? 15:30
        if automatic {
            // VC owns the sole lifecycle-bound graphics/metric-expiry heartbeat.
            // This camera watchdog never republishes an old object presentation.
            if objectOutput == nil,!startupNoticeSent,CACurrentMediaTime()-startedAt>3 {
                startupNoticeSent=true
                invalidate("Đang khởi động mô hình nhận diện trên máy. Nếu chờ lâu, mở Chẩn đoán.")
            }
            return
        }
        guard let packet,let now=liveNowMs else {
            if CACurrentMediaTime()-startedAt>3 { invalidate("Chưa nhận frame hợp lệ. Kiểm tra quyền camera, ánh sáng hoặc dừng rồi mở lại.") }
            return
        }
        let result=RangeProbe.evaluate(packet,nowMs:now,trackingNormal:trackingNormal)
        if result.metres == nil { onUpdate?(nil,result,"Dữ liệu không còn mới; chưa đo.") }
    }
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        dispatchPrecondition(condition:.onQueue(.main))
        let hz:Double = ProcessInfo.processInfo.thermalState == .serious ? 8:15
        guard running,UIApplication.shared.applicationState == .active,frame.timestamp-lastProcessed>=1.0/hz,viewport.width>0,viewport.height>0 else { return }
        lastProcessed=frame.timestamp
        // Drop an old queued callback before reading buffers or doing geometry.
        guard FrameClock.fresh(captureSeconds:frame.timestamp,nowSeconds:CACurrentMediaTime()) else {
            packet=nil;if automatic {invalidateObjects()};onUpdate?(nil,ProbeResult(reason:"stale"),"Frame không còn mới; bỏ trước khi lấy mẫu.");return
        }
        switch frame.camera.trackingState { case .normal: trackingNormal=true; default: trackingNormal=false }
        let rgb=frame.capturedImage, w=CVPixelBufferGetWidth(rgb), h=CVPixelBufferGetHeight(rgb)
        let reference=frame.camera.imageResolution
        guard w>1,h>1,w<=8192,h<=8192,Int(reference.width)==w,Int(reference.height)==h else { packet=nil; invalidate("Kích thước RGB không khớp hiệu chuẩn; chưa đo."); return }
        do {
            let transform: CGAffineTransform
            if #available(iOS 27.0,*),let angle=session.viewRotationAngle { transform=frame.displayTransform(viewRotationAngle:angle,viewportSize:viewport) }
            else {
                guard let orientation=preview?.window?.windowScene?.interfaceOrientation,orientation != .unknown else { packet=nil; invalidate("Đợi hướng màn hình ổn định để căn depth."); return }
                transform=frame.displayTransform(for:orientation,viewportSize:viewport)
            }
            let display=try ProbeGeometry.presentation(transform:Affine(a:transform.a,b:transform.b,c:transform.c,d:transform.d,tx:transform.tx,ty:transform.ty),width:w,height:h)
            let k=frame.camera.intrinsics
            let calibration=Calibration(fx:Double(k[0][0]),fy:Double(k[1][1]),cx:Double(k[2][0]),cy:Double(k[2][1]))
            let arPose=(0..<4).flatMap { c in (0..<4).map { r in Double(frame.camera.transform[c][r]) } }
            let pose=trackingNormal ? try ProbeGeometry.cameraPose(arkitColumnMajor:arPose) : nil
            if automatic {
                if let prior=rotationKey,prior != display.rotation { invalidateObjects() }
                rotationKey=display.rotation
                guard let times=clock.accept(captureSeconds:frame.timestamp,readySeconds:CACurrentMediaTime()),let origin=clock.origin else {
                    invalidateObjects(); invalidate("Clock camera không tương thích; chưa đo."); return
                }
                sequence+=1
                let affine=Affine(a:transform.a,b:transform.b,c:transform.c,d:transform.d,tx:transform.tx,ty:transform.ty)
                _=objects.submit(ObjectFrameContext(frame:frame,epoch:objectEpoch,id:sequence,originSeconds:origin,
                    capturedAtMs:times.capture,width:w,height:h,display:display,displayTransform:affine,
                    calibration:calibration,pose:pose,trackingNormal:trackingNormal,
                    thermalLimited:ProcessInfo.processInfo.thermalState == .serious,
                    recordingRequested:recordingRequested))
                return
            }
            let sampling=sample(frame.sceneDepth,point:selected.map {ProbeGeometry.fromDisplay($0,display)},width:w,height:h)
            // Complete sampling before ready time; both clocks must be compatible.
            guard let times=clock.accept(captureSeconds:frame.timestamp,readySeconds:CACurrentMediaTime()) else { packet=nil; invalidate("Timestamp camera không tương thích; chưa đo."); return }
            sequence+=1
            let depth=frame.sceneDepth == nil ? nil : Depth(captureId:"arkit-\(Int64(frame.timestamp*1_000_000_000))",capturedAtMs:times.capture,samples:sampling.samples)
            let targets=sampling.box.map {[SurfaceTarget(box:$0,associated:surfaceConfirmed && trackingNormal,sampleIndices:Array(sampling.samples.indices))]} ?? []
            let next=ProbeFrame(id:sequence,rgb:RGB(capturedAtMs:times.capture,readyAtMs:times.ready,width:w,height:h),display:display,intrinsics:calibration,cameraToWorld:pose,depth:depth,targets:targets)
            packet=next
            let result=RangeProbe.evaluate(next,nowMs:times.ready,trackingNormal:trackingNormal)
            onUpdate?(next,result,ProcessInfo.processInfo.thermalState == .serious ? "Máy nóng · giảm tải; để máy nguội nếu giật hình." : "ARKit/LiDAR · độ chính xác vật lý chưa kiểm chứng")
        } catch { packet=nil; invalidate("Không ánh xạ được vùng camera/depth; chưa đo.") }
    }
    private func sample(_ data: ARDepthData?, point: Point?, width: Int, height: Int) -> (samples:[SupportSample],box:Rect?) {
        guard let point,point.x>=0,point.x<Double(width),point.y>=0,point.y<Double(height) else { return ([],nil) }
        let fallback=Rect(x:min(Double(width)-1,max(0,point.x)),y:min(Double(height)-1,max(0,point.y)),width:1,height:1)
        guard let data,let confidence=data.confidenceMap else { return ([],fallback) }
        let depth=data.depthMap, dw=CVPixelBufferGetWidth(depth), dh=CVPixelBufferGetHeight(depth)
        guard dw>0,dh>0,!CVPixelBufferIsPlanar(depth),!CVPixelBufferIsPlanar(confidence),CVPixelBufferGetPixelFormatType(depth)==kCVPixelFormatType_DepthFloat32,
              CVPixelBufferGetPixelFormatType(confidence)==kCVPixelFormatType_OneComponent8,CVPixelBufferGetWidth(confidence)==dw,CVPixelBufferGetHeight(confidence)==dh,
              CVPixelBufferGetBytesPerRow(depth)>=dw*4,CVPixelBufferGetBytesPerRow(confidence)>=dw else { return ([],fallback) }
        guard CVPixelBufferLockBaseAddress(depth,.readOnly)==kCVReturnSuccess else { return ([],fallback) }
        defer { CVPixelBufferUnlockBaseAddress(depth,.readOnly) }
        guard CVPixelBufferLockBaseAddress(confidence,.readOnly)==kCVReturnSuccess else { return ([],fallback) }
        defer { CVPixelBufferUnlockBaseAddress(confidence,.readOnly) }
        guard let base=CVPixelBufferGetBaseAddress(depth),let conf=CVPixelBufferGetBaseAddress(confidence) else { return ([],fallback) }
        let x=min(dw-1,Int(point.x*Double(dw)/Double(width))), y=min(dh-1,Int(point.y*Double(dh)/Double(height)))
        var samples:[SupportSample]=[]
        for yy in max(0,y-2)...min(dh-1,y+2) { for xx in max(0,x-2)...min(dw-1,x+2) {
            let z=Double(base.advanced(by:yy*CVPixelBufferGetBytesPerRow(depth)).assumingMemoryBound(to:Float.self)[xx])
            let raw=conf.advanced(by:yy*CVPixelBufferGetBytesPerRow(confidence)).assumingMemoryBound(to:UInt8.self)[xx]
            let p=ProbeGeometry.rgbPixel(depthX:xx,depthY:yy,depthWidth:dw,depthHeight:dh,rgbWidth:width,rgbHeight:height)
            if z.isFinite,z>=1e-6,z<=100,p.x>=0,p.y>=0,p.x<=Double(width-1),p.y<=Double(height-1) { samples.append(SupportSample(u:p.x,v:p.y,value:z,confidence:ProbeGeometry.confidence(raw))) }
        } }
        guard !samples.isEmpty else { return ([],fallback) }
        let minX=samples.map(\.u).min()!,minY=samples.map(\.v).min()!,maxX=samples.map(\.u).max()!,maxY=samples.map(\.v).max()!
        return (samples,Rect(x:minX,y:minY,width:max(0.001,maxX-minX),height:max(0.001,maxY-minY)))
    }
    func sessionWasInterrupted(_ session: ARSession) { stop(); onSuspend?(); invalidate("Camera bị gián đoạn. Mở lại camera khi sẵn sàng.") }
    func session(_ session: ARSession,didFailWithError error: Error) { stop(); onSuspend?(); invalidate("ARKit không chạy được. Đóng ứng dụng khác dùng camera và thử mở lại.") }
    deinit { expiryTimer?.invalidate(); preview?.session.pause() }
}
