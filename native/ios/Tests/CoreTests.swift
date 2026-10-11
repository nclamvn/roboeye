import XCTest
@testable import AssistiveCore

final class CoreTests:XCTestCase {
    func fixture(id:Int=1,time:Double=0,z:Double=2) -> ProbeFrame {
        let samples:[SupportSample]=(0..<25).map { i in
            let u=Double(408+i%5),v=Double(238+i/5)
            return SupportSample(u:u,v:v,value:z,confidence:1)
        }
        return ProbeFrame(id:id,rgb:RGB(capturedAtMs:time,readyAtMs:time+35,width:640,height:480),display:Presentation(crop:Rect(x:0,y:0,width:640,height:480),rotation:0),intrinsics:Calibration(fx:500,fy:500,cx:320,cy:240),cameraToWorld:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],depth:Depth(captureId:"d-\(id)",capturedAtMs:time,samples:samples),targets:[SurfaceTarget(box:Rect(x:408,y:238,width:4,height:4),associated:true,sampleIndices:Array(0..<25))])
    }
    func testCameraRangeNotOpticalZ() { let f=fixture(); let r=RangeProbe.evaluate(f,nowMs:35); XCTAssertGreaterThan(r.metres!,2); XCTAssertEqual(r.metres!,2.032145664,accuracy:1e-9) }
    func testRayRangeDoesNotDoubleConvert() { var f=fixture(); f.depth!.kind="metre-ray"; XCTAssertEqual(RangeProbe.evaluate(f,nowMs:35).metres!,2,accuracy:1e-9) }
    func testDisplayRoundTripAllRotationsMirrors() {
        for rotation in [0,90,180,270] { for mirror in [false,true] {
            let g=Presentation(crop:Rect(x:80,y:40,width:500,height:400),rotation:rotation,mirrored:mirror),p=Point(410,240)
            let out=ProbeGeometry.fromDisplay(ProbeGeometry.toDisplay(p,g),g); XCTAssertEqual(out.x,p.x,accuracy:1e-9); XCTAssertEqual(out.y,p.y,accuracy:1e-9)
            let p0=ProbeGeometry.toDisplay(Point(0,0),g),px=ProbeGeometry.toDisplay(Point(640,0),g),py=ProbeGeometry.toDisplay(Point(0,480),g)
            let affine=Affine(a:px.x-p0.x,b:px.y-p0.y,c:py.x-p0.x,d:py.y-p0.y,tx:p0.x,ty:p0.y)
            let derived=try! ProbeGeometry.presentation(transform:affine,width:640,height:480)
            let back=ProbeGeometry.toDisplay(p,derived),expected=ProbeGeometry.toDisplay(p,g); XCTAssertEqual(back.x,expected.x,accuracy:1e-9); XCTAssertEqual(back.y,expected.y,accuracy:1e-9)
        } }
    }
    func testRejectShearOffImageAndSingularTransform() {
        XCTAssertThrowsError(try ProbeGeometry.presentation(transform:Affine(a:1,b:0.1,c:0,d:1,tx:0,ty:0),width:640,height:480))
        XCTAssertThrowsError(try ProbeGeometry.presentation(transform:Affine(a:0.5,b:0,c:0,d:0.5,tx:0,ty:0),width:640,height:480))
        XCTAssertThrowsError(try Affine(a:0,b:0,c:0,d:0,tx:0,ty:0).inverse())
    }
    func testRGBDepthPixelCentres() {
        let p=ProbeGeometry.rgbPixel(depthX:0,depthY:0,depthWidth:256,depthHeight:192,rgbWidth:1920,rgbHeight:1440)
        XCTAssertEqual(p.x,3.25); XCTAssertEqual(p.y,3.25)
        let end=ProbeGeometry.rgbPixel(depthX:255,depthY:191,depthWidth:256,depthHeight:192,rgbWidth:1920,rgbHeight:1440)
        XCTAssertEqual(end.x,1915.75); XCTAssertEqual(end.y,1435.75)
    }
    func testConfidenceIsOrdinalNotProbability() { XCTAssertEqual((0...3).map {ProbeGeometry.confidence(UInt8($0))},[0,0.5,1,0]) }
    func testPoseChiralityAndTranslation() throws {
        let p=try ProbeGeometry.cameraPose(arkitColumnMajor:[1,0,0,0,0,1,0,0,0,0,1,0,2,3,4,1])
        XCTAssertEqual(p,[1,0,0,2,0,-1,0,3,0,0,-1,4,0,0,0,1]); XCTAssertTrue(ProbeGeometry.validPose(p))
        XCTAssertFalse(ProbeGeometry.validPose([1,0,0,0,0,1,0,0,0,0,-1,0,0,0,0,1]))
        XCTAssertThrowsError(try ProbeGeometry.cameraPose(arkitColumnMajor:Array(repeating:0,count:16)))
    }
    func testMissingRelativeAndAssociationCannotBecomeMetres() {
        var f=fixture(); f.depth=nil; XCTAssertEqual(RangeProbe.evaluate(f,nowMs:35).reason,"no-depth")
        f=fixture(); f.depth!.kind="relative"; XCTAssertEqual(RangeProbe.evaluate(f,nowMs:35).reason,"relative-only")
        f=fixture(); f.targets[0].support="bbox-only"; XCTAssertEqual(RangeProbe.evaluate(f,nowMs:35).reason,"no-foreground")
        f=fixture(); f.intrinsics=nil; XCTAssertEqual(RangeProbe.evaluate(f,nowMs:35).reason,"no-intrinsics")
    }
    func testClockStaleSkewReusedAndTracking() {
        let f=fixture(); XCTAssertEqual(RangeProbe.evaluate(f,nowMs:34).reason,"clock-future")
        XCTAssertEqual(RangeProbe.evaluate(f,nowMs:301).reason,"stale")
        XCTAssertEqual(RangeProbe.evaluate(f,nowMs:35,reused:true).reason,"depth-reused")
        XCTAssertEqual(RangeProbe.evaluate(f,nowMs:35,trackingNormal:false).reason,"tracking-limited")
        var skew=fixture(time:100); skew.depth!.capturedAtMs=49; XCTAssertEqual(RangeProbe.evaluate(skew,nowMs:135).reason,"rgb-depth-skew")
    }
    func testLowDuplicateAndMixedSupport() {
        var f=fixture(); f.depth!.samples=f.depth!.samples.map {var s=$0;s.confidence=0.5;return s}; XCTAssertEqual(RangeProbe.evaluate(f,nowMs:35).reason,"low-support")
        f=fixture(); f.depth!.samples=Array(repeating:f.depth!.samples[0],count:25); XCTAssertEqual(RangeProbe.evaluate(f,nowMs:35).reason,"low-support")
        f=fixture(); for i in 0..<5 {f.depth!.samples[i].value=4}; XCTAssertEqual(RangeProbe.evaluate(f,nowMs:35).reason,"ambiguous-support")
    }
    func testDomainAndNoHoldLastValue() { XCTAssertNil(RangeProbe.evaluate(fixture(z:0.1),nowMs:35).metres); XCTAssertNil(RangeProbe.evaluate(fixture(z:6),nowMs:35).metres); XCTAssertNotNil(RangeProbe.evaluate(fixture(),nowMs:35).metres); XCTAssertNil(RangeProbe.evaluate(fixture(),nowMs:301).metres) }
    func testFrameClockRejectsDuplicateBackwardAndIncompatibleClocks() {
        var c=FrameClock(); XCTAssertNil(c.accept(captureSeconds:100,readySeconds:99)); XCTAssertNil(c.accept(captureSeconds:100,readySeconds:170))
        let first=c.accept(captureSeconds:100,readySeconds:100.035)!; XCTAssertEqual(first.capture,0); XCTAssertEqual(first.ready,35,accuracy:1e-8)
        XCTAssertNil(c.accept(captureSeconds:100,readySeconds:100.2)); XCTAssertNil(c.accept(captureSeconds:99,readySeconds:100))
        XCTAssertEqual(c.accept(captureSeconds:100.1,readySeconds:100.12)!.capture,100,accuracy:1e-8)
    }
    func testConsentRebaseAndRevoke() throws {
        let r=ProbeRecorder(); XCTAssertThrowsError(try r.start(consent:false)); try r.start(consent:true,liveOriginMs:1000)
        XCTAssertTrue(r.append(fixture(time:1000))); r.stop(); let saved=try r.snapshot(); XCTAssertEqual(saved.frames[0].rgb.capturedAtMs,0); XCTAssertEqual(saved.frames[0].depth!.capturedAtMs,0)
        XCTAssertThrowsError(try r.start(consent:true)); r.clear(); XCTAssertTrue(r.frames.isEmpty); XCTAssertThrowsError(try r.snapshot())
    }
    func testFrameTimeByteCapsAndEmptyTimeCap() throws {
        let f=ProbeRecorder(maxFrames:2); try f.start(consent:true); XCTAssertTrue(f.append(fixture())); XCTAssertTrue(f.append(fixture(id:2,time:200))); XCTAssertFalse(f.active); XCTAssertEqual(f.stopReason,"frame-cap"); XCTAssertFalse(f.append(fixture(id:3,time:400)))
        let t=ProbeRecorder(maxDuration:100); try t.start(consent:true); t.tick(liveNowMs:101); XCTAssertFalse(t.active); XCTAssertEqual(t.stopReason,"time-cap")
        let b=ProbeRecorder(maxBytes:2048); try b.start(consent:true); XCTAssertFalse(b.append(fixture())); XCTAssertEqual(b.stopReason,"byte-cap")
    }
    func testSourceOrderAndDepthIdentityCannotBeRewritten() throws {
        let r=ProbeRecorder(); try r.start(consent:true); XCTAssertTrue(r.append(fixture())); XCTAssertFalse(r.append(fixture()))
        var f=fixture(id:2,time:200); f.provider="fixture"; XCTAssertFalse(r.append(f))
        f=fixture(id:2,time:200); f.depth!.captureId="d-1"; XCTAssertFalse(r.append(f)); XCTAssertEqual(r.rejected,3)
    }
    func testTruthOnlyStoppedMeasuredExactLastFrame() throws {
        let r=ProbeRecorder(); try r.start(consent:true); r.append(fixture()); let binding=r.truthBinding!; XCTAssertThrowsError(try r.addTruth(metres:2,method:"tape",split:"holdout",binding:binding)); r.stop()
        XCTAssertThrowsError(try r.addTruth(metres:2,method:"synthetic",split:"holdout",binding:binding)); XCTAssertThrowsError(try r.addTruth(metres:.nan,method:"tape",split:"holdout",binding:binding))
        try r.addTruth(metres:2,method:"tape",split:"holdout",binding:binding); XCTAssertEqual(r.truth[0].frameId,1); XCTAssertEqual(r.truth[0].targetId,"probe-1"); XCTAssertEqual(r.truth[0].split,"holdout")
        try r.addTruth(metres:2.1,method:"tape",split:"development",binding:binding); XCTAssertEqual(r.truth.count,1)
    }
    func testExportClosedExplicitNullPrivacyAndChecksum() throws {
        let r=ProbeRecorder(); try r.start(consent:true); var f=fixture(); f.depth=nil;f.cameraToWorld=nil;f.intrinsics=nil;f.targets=[];r.append(f);r.stop()
        let data=try EnvelopeWriter.export(r.snapshot()),object=try JSONSerialization.jsonObject(with:data) as! [String:Any]
        XCTAssertEqual(object["schema"] as? String,"assistive-envelope-v1"); XCTAssertEqual((object["sha256"] as! String).count,64)
        let recording=object["recording"] as! [String:Any],frame=(recording["frames"] as! [[String:Any]])[0]
        XCTAssertTrue(frame["depth"] is NSNull); XCTAssertTrue(frame["intrinsics"] is NSNull); XCTAssertTrue(frame["cameraToWorld"] is NSNull)
        XCTAssertEqual(Set(frame.keys),Set(["schema","id","clock","provider","rgb","display","intrinsics","cameraToWorld","depth","targets"]))
        XCTAssertFalse(String(data:data,encoding:.utf8)!.contains("capturedImage")); XCTAssertEqual(recording["origin"] as? String,"native-import")
    }
    func testTruthBindingRejectsRevokedOrReplacedRecordingEvenWithSameFrameID() throws {
        let r=ProbeRecorder(); try r.start(consent:true); r.append(fixture()); r.stop(); let old=r.truthBinding!
        r.clear(); XCTAssertThrowsError(try r.addTruth(metres:2,method:"tape",split:"holdout",binding:old))
        try r.start(consent:true); r.append(fixture()); r.stop()
        XCTAssertNotEqual(r.truthBinding,old)
        XCTAssertThrowsError(try r.addTruth(metres:2,method:"tape",split:"holdout",binding:old)); XCTAssertTrue(r.truth.isEmpty)
    }
    func testClockFailuresAndNaNCapStopInsteadOfHanging() throws {
        for invalid in [Double.nan,Double.infinity,-1] {
            let r=ProbeRecorder(); try r.start(consent:true); r.tick(liveNowMs:invalid); XCTAssertFalse(r.active)
        }
        let r=ProbeRecorder(maxDuration:.nan); try r.start(consent:true); r.tick(liveNowMs:120_000); XCTAssertFalse(r.active); XCTAssertEqual(r.stopReason,"time-cap")
    }
    func testQueuedStaleOrInvalidCameraFrameIsDroppedBeforeSampling() {
        XCTAssertTrue(FrameClock.fresh(captureSeconds:100,nowSeconds:100.299))
        XCTAssertFalse(FrameClock.fresh(captureSeconds:100,nowSeconds:100.301))
        XCTAssertFalse(FrameClock.fresh(captureSeconds:100,nowSeconds:99.9))
        XCTAssertFalse(FrameClock.fresh(captureSeconds:.nan,nowSeconds:100))
        XCTAssertFalse(FrameClock.fresh(captureSeconds:100,nowSeconds:.infinity))
    }
    func testUnknownDepthKindAndCorruptSupportDoNotCreateMetres() {
        var f=fixture(); f.depth!.kind="arbitrary-unit"; XCTAssertNil(RangeProbe.evaluate(f,nowMs:35).metres)
        for bad in [Double.nan,Double.infinity,-1,641] {
            f=fixture(); for i in f.depth!.samples.indices { f.depth!.samples[i].u=bad }; XCTAssertNil(RangeProbe.evaluate(f,nowMs:35).metres)
        }
        f=fixture(); for i in f.depth!.samples.indices { f.depth!.samples[i].confidence=1.1 }; XCTAssertNil(RangeProbe.evaluate(f,nowMs:35).metres)
    }
    func testCropRemainsInsideOriginalImageAtFloatingPointEdges() throws {
        for width in [640,1280,1920] { for scale in [1.0,1.000001,1.23,2.78] {
            let g=try ProbeGeometry.presentation(transform:Affine(a:scale,b:0,c:0,d:scale,tx:(1-scale)/2,ty:(1-scale)/2),width:width,height:1080)
            XCTAssertLessThanOrEqual(g.crop.x+g.crop.width,Double(width)); XCTAssertLessThanOrEqual(g.crop.y+g.crop.height,1080)
        } }
    }
    func testExportIsOffMainSingleFlightAndRevokedCompletionCannotPublish() throws {
        let r=ProbeRecorder(); try r.start(consent:true); r.append(fixture()); r.stop(); let snapshot=try r.snapshot()
        let worker=SnapshotExporter(), entered=DispatchSemaphore(value:0), release=DispatchSemaphore(value:0), done=expectation(description:"cancelled completion")
        XCTAssertTrue(worker.submit(snapshot,writer:{ _ in
            XCTAssertFalse(Thread.isMainThread); entered.signal()
            guard release.wait(timeout:.now()+3) == .success else { throw ProbeError.invalid }
            return Data("never publish".utf8)
        },completion:{ result in XCTAssertTrue(Thread.isMainThread); XCTAssertNil(result); XCTAssertFalse(worker.isBusy); done.fulfill() }))
        XCTAssertEqual(entered.wait(timeout:.now()+3),.success)
        XCTAssertFalse(worker.submit(snapshot,completion:{ _ in XCTFail("duplicate export queued") }))
        worker.cancel(); r.clear(); release.signal(); wait(for:[done],timeout:4)
    }
    func testExportErrorPropagatesAndNextExportCanRecover() throws {
        let r=ProbeRecorder(); try r.start(consent:true); r.append(fixture()); r.stop(); let snapshot=try r.snapshot(), worker=SnapshotExporter()
        let failed=expectation(description:"error")
        XCTAssertTrue(worker.submit(snapshot,writer:{_ in throw ProbeError.serialization},completion:{ result in
            guard case .failure?=result else { XCTFail("missing failure"); failed.fulfill(); return }
            failed.fulfill()
        })); wait(for:[failed],timeout:3)
        let recovered=expectation(description:"success")
        XCTAssertTrue(worker.submit(snapshot,completion:{ result in XCTAssertNotNil(try? result?.get()); recovered.fulfill() })); wait(for:[recovered],timeout:3)
    }
    func testRepeatedRecordRevokeCyclesAndLargestRecordingStayBounded() throws {
        let r=ProbeRecorder()
        for _ in 0..<100 { try r.start(consent:true); r.append(fixture()); r.clear(); XCTAssertTrue(r.frames.isEmpty); XCTAssertNil(r.truthBinding) }
        try r.start(consent:true)
        for i in 0..<600 { if !r.active { break }; r.append(fixture(id:i+1,time:Double(i)*200)) }
        XCTAssertFalse(r.active); XCTAssertLessThanOrEqual(r.frames.count,600)
        let data=try EnvelopeWriter.export(r.snapshot()); XCTAssertLessThanOrEqual(data.count,EnvelopeWriter.byteLimit)
    }
}
