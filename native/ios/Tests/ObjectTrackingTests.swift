import XCTest
@testable import AssistiveCore

final class ObjectTrackingTests: XCTestCase {
    let box=Rect(x:0.2,y:0.2,width:0.6,height:0.6)
    let calibration=Calibration(fx:1000,fy:1000,cx:320,cy:240)
    func supports(n: Int=5,z: Double=2,confidence: Double=1) -> [SupportSample] {
        let r=ObjectBoxGeometry.pixelBox(box,imageWidth:640,imageHeight:480)!,m=ObjectRangeEstimator.interiorMargin
        return (0..<n*n).map { i in
            let fx=0.1+0.8*Double(i%n)/Double(max(1,n-1)),fy=0.1+0.8*Double(i/n)/Double(max(1,n-1))
            return SupportSample(u:r.x+r.width*(m+(1-2*m)*fx),v:r.y+r.height*(m+(1-2*m)*fy),value:z,confidence:confidence)
        }
    }
    func measure(_ samples: [SupportSample]?=nil,now: Double=20,depth: Double?=0,label: String="person",sameFrame: Bool=true) -> ProbeResult {
        ObjectRangeEstimator.evaluate(box:box,samples:samples ?? supports(),calibration:calibration,rgbWidth:640,rgbHeight:480,rgbCapturedAtMs:0,depthCapturedAtMs:depth,nowMs:now,sameFrame:sameFrame,label:label)
    }
    func detection(_ x: Double=0.2,label: String="person",score: Double=0.9) -> ObjectDetection {
        ObjectDetection(label:label,score:score,box:Rect(x:x,y:0.2,width:0.15,height:0.3))
    }
    func assertRect(_ r: Rect?,_ expected: Rect,file: StaticString=#filePath,line: UInt=#line) {
        guard let r=r else { XCTFail("missing rect",file:file,line:line);return }
        XCTAssertEqual(r.x,expected.x,accuracy:1e-9,file:file,line:line)
        XCTAssertEqual(r.y,expected.y,accuracy:1e-9,file:file,line:line)
        XCTAssertEqual(r.width,expected.width,accuracy:1e-9,file:file,line:line)
        XCTAssertEqual(r.height,expected.height,accuracy:1e-9,file:file,line:line)
    }
    func testVisionBottomLeftConvertsToRawTopLeft() {
        assertRect(ObjectBoxGeometry.rawNormalizedBox(fromVision:Rect(x:0.1,y:0.2,width:0.3,height:0.4)),Rect(x:0.1,y:0.4,width:0.3,height:0.4))
    }
    func testVisionRawRoundtripAllCardinalRotations() {
        let raw=Rect(x:0.12,y:0.22,width:0.31,height:0.17)
        for rotation in [0,90,180,270] {
            let vision=ObjectBoxGeometry.visionBox(fromRaw:raw,rotation:rotation)!
            assertRect(ObjectBoxGeometry.rawNormalizedBox(fromVision:vision,rotation:rotation),raw)
        }
    }
    func testVisionKnownCardinalBoxesNoPortraitSidewaysMixup() {
        let raw=Rect(x:0.1,y:0.2,width:0.3,height:0.4)
        let expected=[Rect(x:0.1,y:0.4,width:0.3,height:0.4),Rect(x:0.4,y:0.6,width:0.4,height:0.3),Rect(x:0.6,y:0.2,width:0.3,height:0.4),Rect(x:0.2,y:0.1,width:0.4,height:0.3)]
        for (rotation,e) in zip([0,90,180,270],expected) { assertRect(ObjectBoxGeometry.visionBox(fromRaw:raw,rotation:rotation),e) }
        XCTAssertNil(ObjectBoxGeometry.visionBox(fromRaw:raw,rotation:45))
        XCTAssertNil(ObjectBoxGeometry.rawNormalizedBox(fromVision:raw,rotation:45))
    }
    func testRawBoxClipsWithoutInvertingOrInventingOffImage() {
        assertRect(ObjectBoxGeometry.clipped(Rect(x:-0.1,y:0.9,width:0.4,height:0.4)),Rect(x:0,y:0.9,width:0.3,height:0.1))
        XCTAssertNil(ObjectBoxGeometry.clipped(Rect(x:2,y:0,width:0.2,height:0.3)))
        XCTAssertNil(ObjectBoxGeometry.clipped(Rect(x:0,y:0,width:-1,height:0.3)))
        XCTAssertNil(ObjectBoxGeometry.clipped(Rect(x:.nan,y:0,width:0.2,height:0.3)))
    }
    func testNormalizedBoxUsesRGBPixelDimensionsNotDepthMapDimensions() {
        assertRect(ObjectBoxGeometry.pixelBox(box,imageWidth:640,imageHeight:480),Rect(x:128,y:96,width:384,height:288))
        XCTAssertNil(ObjectBoxGeometry.pixelBox(box,imageWidth:0,imageHeight:480))
    }
    func testDisplayAffineRotatesAllFourCorners() {
        let r=Rect(x:0.1,y:0.2,width:0.3,height:0.4),rotation=Affine(a:0,b:1,c:-1,d:0,tx:1,ty:0)
        assertRect(ObjectBoxGeometry.displayBox(r,transform:rotation),Rect(x:0.4,y:0.1,width:0.4,height:0.3))
    }
    func testDisplayCropClipsViewportAndRejectsInvalidTransforms() {
        let zoom=Affine(a:2,b:0,c:0,d:2,tx:-0.5,ty:-0.5)
        assertRect(ObjectBoxGeometry.displayBox(Rect(x:0,y:0,width:0.5,height:0.5),transform:zoom),Rect(x:0,y:0,width:0.5,height:0.5))
        XCTAssertNil(ObjectBoxGeometry.displayBox(box,transform:Affine(a:0,b:0,c:0,d:0,tx:0,ty:0)))
        XCTAssertNil(ObjectBoxGeometry.displayBox(Rect(x:0,y:0,width:0.1,height:0.1),transform:zoom))
    }
    func testAllCOCO80VietnameseLabelsAndAliases() {
        XCTAssertEqual(ObjectLabels.translations.count,80)
        XCTAssertTrue(ObjectLabels.translations.values.allSatisfy {!$0.isEmpty})
        XCTAssertEqual(ObjectLabels.vietnamese("person"),"Người")
        XCTAssertEqual(ObjectLabels.vietnamese("cell_phone"),"Điện thoại")
        XCTAssertEqual(ObjectLabels.vietnamese(" motorbike "),"Xe máy")
        XCTAssertEqual(ObjectLabels.vietnamese("unknown"),"unknown")
    }
    func testStableSameClassIDAndRawBoxNotSmoothed() {
        var tracker=ObjectTracker()
        let first=tracker.update([detection()],atMs:0)[0]
        let second=tracker.update([detection(0.23)],atMs:100)[0]
        XCTAssertEqual(first.id,second.id);XCTAssertEqual(second.box.x,0.23)
        XCTAssertEqual(second.lastDetectedAtMs,100)
    }
    func testMultiplePeopleMatchOneToOneEvenIfObservationOrderChanges() {
        var tracker=ObjectTracker()
        let first=tracker.update([detection(0.1),detection(0.7)],atMs:0)
        let second=tracker.update([detection(0.68),detection(0.12)],atMs:100)
        XCTAssertEqual(second[0].id,first[1].id);XCTAssertEqual(second[1].id,first[0].id)
        XCTAssertEqual(Set(second.map(\.id)).count,2)
    }
    func testClassChangeCreatesNewIdentityInsteadOfRangeTransfer() {
        var tracker=ObjectTracker()
        let first=tracker.update([detection()],atMs:0)[0]
        _=tracker.setRanges([first.id:measure()],capturedAtMs:0,nowMs:20)
        let second=tracker.update([detection(label:"chair")],atMs:100)
        XCTAssertNotEqual(second[0].id,first.id);XCTAssertNil(second[0].range.metres)
        XCTAssertNil(second.first(where:{$0.id==first.id})?.range.metres)
    }
    func testPhoneToRemoteFlipRetiresContradictoryCoastWithoutBorrowingMetres() {
        var tracker=ObjectTracker()
        let phone=tracker.update([detection(label:"cellphone")],atMs:0)[0]
        _=tracker.setRanges([phone.id:measure()],capturedAtMs:0,nowMs:20)
        let remote=tracker.update([detection(label:"remote")],atMs:100)
        XCTAssertEqual(remote.count,1);XCTAssertEqual(remote[0].label,"remote")
        XCTAssertNotEqual(remote[0].id,phone.id);XCTAssertNil(remote[0].range.metres);XCTAssertNil(remote[0].rangeCapturedAtMs)
        XCTAssertFalse(remote[0].isCoasting)
    }
    func testRemoteToPhoneFlipRetiresContradictoryCoastWithoutBorrowingMetres() {
        var tracker=ObjectTracker()
        let remote=tracker.update([detection(label:"remote")],atMs:0)[0]
        _=tracker.setRanges([remote.id:measure()],capturedAtMs:0,nowMs:20)
        let phone=tracker.update([detection(label:"cell phone")],atMs:100)
        XCTAssertEqual(phone.count,1);XCTAssertEqual(phone[0].label,"cell phone")
        XCTAssertNotEqual(phone[0].id,remote.id);XCTAssertNil(phone[0].range.metres);XCTAssertNil(phone[0].rangeCapturedAtMs)
        XCTAssertFalse(phone[0].isCoasting)
    }
    func testConcurrentPhoneRemoteHypothesesChooseStrongerRawScoreInEitherOrder() {
        for stronger in ["cell phone","remote"] {
            let weaker=stronger=="remote" ? "cell phone":"remote"
            let candidates=[detection(label:stronger,score:0.94),detection(0.205,label:weaker,score:0.83)]
            for rows in [candidates,Array(candidates.reversed())] {
                var tracker=ObjectTracker()
                let result=tracker.update(rows,atMs:0)
                XCTAssertEqual(result.count,1);XCTAssertEqual(result[0].label,stronger);XCTAssertEqual(result[0].score,0.94)
                XCTAssertNil(result[0].range.metres)
            }
        }
    }
    func testConcurrentPhoneRemoteExactTieIsDeterministicNotInputOrderDependent() {
        let candidates=[detection(label:"remote"),detection(label:"cell phone")]
        var first=ObjectTracker(),second=ObjectTracker()
        let a=first.update(candidates,atMs:0),b=second.update(Array(candidates.reversed()),atMs:0)
        XCTAssertEqual(a.count,1);XCTAssertEqual(b.count,1);XCTAssertEqual(a[0].label,b[0].label)
        XCTAssertEqual(a[0].box,b[0].box);XCTAssertEqual(a[0].score,b[0].score)
        XCTAssertTrue(["cell phone","remote"].contains(a[0].label));XCTAssertNil(a[0].range.metres)
    }
    func testSeparatedAndSubSuppressionPhoneRemoteBoxesRemainSeparate() {
        for x in [0.225,0.6] {
            var concurrent=ObjectTracker()
            let result=concurrent.update([detection(label:"cell phone"),detection(x,label:"remote")],atMs:0)
            XCTAssertEqual(result.count,2)
            var flip=ObjectTracker()
            let old=flip.update([detection(label:"cell phone")],atMs:0)[0]
            let next=flip.update([detection(x,label:"remote")],atMs:100)
            XCTAssertEqual(next.count,2);XCTAssertTrue(next.first(where:{$0.id==old.id})!.isCoasting)
            XCTAssertNil(next.first(where:{$0.id==old.id})!.range.metres)
        }
    }
    func testPhoneRemoteRepairDoesNotSuppressNestedPersonBookOrOtherClasses() {
        var tracker=ObjectTracker()
        let first=tracker.update([detection(label:"person"),detection(label:"book"),detection(label:"cell phone")],atMs:0)
        XCTAssertEqual(first.count,3)
        let next=tracker.update([detection(label:"person"),detection(label:"book"),detection(label:"remote")],atMs:100)
        XCTAssertEqual(next.count,3);XCTAssertEqual(Set(next.map(\.label)),Set(["person","book","remote"]))
        for label in ["person","book"] {XCTAssertEqual(next.first(where:{$0.label==label})!.id,first.first(where:{$0.label==label})!.id)}
        var unrelated=ObjectTracker()
        XCTAssertEqual(unrelated.update([detection(label:"chair"),detection(label:"bottle"),detection(label:"remote")],atMs:0).count,3)
    }
    func testAmbiguousSameClassAssociationDoesNotReusePriorRange() {
        var tracker=ObjectTracker()
        let first=tracker.update([detection(0.2),detection(0.4)],atMs:0)
        _=tracker.setRanges([first[0].id:measure(),first[1].id:measure()],capturedAtMs:0,nowMs:20)
        let next=tracker.update([detection(0.3)],atMs:100)
        XCTAssertFalse(first.map(\.id).contains(next[0].id));XCTAssertNil(next[0].range.metres)
        XCTAssertEqual(next.count,1,"Ambiguous prior candidates must retire, not appear as two ghost coast boxes")
    }
    func testDuplicateDetectorRowsDoNotCreateDuplicateObjects() {
        var tracker=ObjectTracker()
        let result=tracker.update([detection(),detection(0.205)],atMs:0)
        XCTAssertEqual(result.count,1)
    }
    func testTrackBudgetAndMalformedDetectionsStayBounded() {
        var tracker=ObjectTracker(maxTracks:100)
        let many=(0..<50).map {ObjectDetection(label:"class\($0)",score:0.9,box:Rect(x:0.1,y:0.1,width:0.1,height:0.1))}
        XCTAssertEqual(tracker.update(many,atMs:0).count,12)
        tracker.reset()
        let malformed=[detection(score:.nan),detection(score:1.1),detection(score:0.1),detection(label:"")]
        XCTAssertTrue(tracker.update(malformed,atMs:0).isEmpty)
    }
    func testMissingObservationCoastsBoxButImmediatelyClearsMetric() {
        var tracker=ObjectTracker()
        let first=tracker.update([detection()],atMs:0)[0]
        XCTAssertNotNil(tracker.setRanges([first.id:measure()],capturedAtMs:0,nowMs:20)[0].range.metres)
        let lost=tracker.update([],atMs:100)[0]
        XCTAssertTrue(lost.isCoasting);XCTAssertNil(lost.range.metres)
        XCTAssertTrue(tracker.snapshot(nowMs:601).isEmpty)
    }
    func testMetricExpiresExactlyAfter300MillisecondsWithoutHoldingLast() {
        var tracker=ObjectTracker()
        let first=tracker.update([detection()],atMs:0)[0]
        _=tracker.setRanges([first.id:measure()],capturedAtMs:0,nowMs:20)
        XCTAssertNotNil(tracker.snapshot(nowMs:300)[0].range.metres)
        XCTAssertNil(tracker.snapshot(nowMs:300.001)[0].range.metres)
        XCTAssertEqual(tracker.snapshot(nowMs:301)[0].range.reason,"stale")
    }
    func testNewPositionClearsMetricUntilCurrentFrameDepthArrives() {
        var tracker=ObjectTracker()
        let id=tracker.update([detection()],atMs:0)[0].id
        _=tracker.setRanges([id:measure()],capturedAtMs:0,nowMs:20)
        XCTAssertNil(tracker.updateTrackedBoxes([id:Rect(x:0.22,y:0.2,width:0.15,height:0.3)],atMs:50)[0].range.metres)
        XCTAssertNil(tracker.setRanges([id:measure()],capturedAtMs:0,nowMs:60)[0].range.metres)
        XCTAssertNotNil(tracker.setRanges([id:measure()],capturedAtMs:50,nowMs:60)[0].range.metres)
    }
    func testFailedCurrentDepthClearsPreviousMetric() {
        var tracker=ObjectTracker()
        let id=tracker.update([detection()],atMs:0)[0].id
        _=tracker.setRanges([id:measure()],capturedAtMs:0,nowMs:20)
        let failed=tracker.setRanges([id:ProbeResult(reason:"no-depth")],capturedAtMs:0,nowMs:30)[0]
        XCTAssertNil(failed.range.metres);XCTAssertNil(failed.rangeCapturedAtMs)
    }
    func testMissingIDRangeDoesNotTransferFromAnotherPerson() {
        var tracker=ObjectTracker()
        let people=tracker.update([detection(0.1),detection(0.7)],atMs:0)
        let result=tracker.setRanges([people[0].id:measure()],capturedAtMs:0,nowMs:20)
        XCTAssertNotNil(result[0].range.metres);XCTAssertNil(result[1].range.metres)
    }
    func testVisionTrackingDoesNotRenewDetectorTTL() {
        var tracker=ObjectTracker(maxDetectionGapMs:700)
        let id=tracker.update([detection()],atMs:0)[0].id
        _=tracker.updateTrackedBoxes([id:detection().box],atMs:300)
        XCTAssertEqual(tracker.updateTrackedBoxes([id:detection().box],atMs:600)[0].lastDetectedAtMs,0)
        XCTAssertTrue(tracker.updateTrackedBoxes([id:detection().box],atMs:701).isEmpty)
    }
    func testInvalidOrReversedTimeCannotAdvanceTracks() {
        var tracker=ObjectTracker()
        _=tracker.update([detection()],atMs:100)
        XCTAssertTrue(tracker.update([detection(0.5)],atMs:99).isEmpty)
        XCTAssertTrue(tracker.updateTrackedBoxes([:],atMs:.nan).isEmpty)
        XCTAssertEqual(tracker.snapshot(nowMs:100)[0].box.x,0.2)
        tracker.reset();XCTAssertTrue(tracker.snapshot(nowMs:100).isEmpty)
    }
    func testInteriorSupportConvertsMetricZToEuclideanMetres() {
        let samples=supports(),actual=measure(samples),rays=samples.map {ProbeGeometry.range($0,calibration)}.sorted()
        XCTAssertEqual(actual.reason,"approximate-interior-supported")
        XCTAssertEqual(actual.supportCount,25)
        XCTAssertEqual(actual.metres!,rays[rays.count/2],accuracy:1e-9)
        XCTAssertGreaterThan(actual.metres!,2)
    }
    func testDepthSameFrameFreshnessAndIntrinsicsMandatory() {
        XCTAssertEqual(measure(depth:nil).reason,"no-depth")
        XCTAssertEqual(measure(now:301).reason,"stale")
        XCTAssertEqual(measure(depth:2).reason,"rgb-depth-skew")
        XCTAssertEqual(measure(sameFrame:false).reason,"rgb-depth-skew")
        XCTAssertEqual(measure(now:-1).reason,"clock-future")
        let missing=ObjectRangeEstimator.evaluate(box:box,samples:supports(),calibration:nil,rgbWidth:640,rgbHeight:480,rgbCapturedAtMs:0,depthCapturedAtMs:0,nowMs:20)
        XCTAssertEqual(missing.reason,"no-intrinsics")
    }
    func testTrackingLimitedRejectsEvenPerfectDepth() {
        let r=ObjectRangeEstimator.evaluate(box:box,samples:supports(),calibration:calibration,rgbWidth:640,rgbHeight:480,rgbCapturedAtMs:0,depthCapturedAtMs:0,nowMs:20,trackingNormal:false)
        XCTAssertEqual(r.reason,"tracking-limited");XCTAssertNil(r.metres)
    }
    func testDuplicateNonFiniteAndLowConfidenceSupportCannotCreateMetres() {
        XCTAssertNil(measure(Array(repeating:supports()[0],count:25)).metres)
        XCTAssertNil(measure(supports(confidence:0)).metres)
        XCTAssertNil(measure(supports().map { var s=$0;s.value = .nan;return s }).metres)
        XCTAssertNil(measure(supports().map { var s=$0;s.confidence=1.1;return s }).metres)
    }
    func testOffBoxAndRGBOutOfBoundsSupportCannotCreateMetres() {
        XCTAssertNil(measure(supports().map { var s=$0;s.u=0;return s }).metres)
        XCTAssertNil(measure(supports().map { var s=$0;s.v=481;return s }).metres)
        XCTAssertNil(measure(supports().map { var s=$0;s.u = .infinity;return s }).metres)
    }
    func testNearTieBimodalForegroundBackgroundMustRemainUnknown() {
        var s=supports();for i in 0..<12 {s[i].value=4}
        XCTAssertNil(measure(s).metres)
        XCTAssertEqual(measure(s).reason,"ambiguous-support")
    }
    func testBackgroundMajorityCannotOverrideCredibleNearForeground() {
        var s=supports();for i in 0..<20 {s[i].value=4}
        XCTAssertNil(measure(s).metres)
    }
    func testMediumConfidenceNeedsMoreAndDistributedSupport() {
        XCTAssertNotNil(measure(supports(confidence:0.5)).metres)
        XCTAssertNil(measure(supports(n:3,confidence:0.5)).metres)
        var s=supports(confidence:0.5);for i in 0..<8 {s[i].value=4}
        XCTAssertNil(measure(s).metres)
    }
    func testCoherentDepthWithoutSpatialSpreadRemainsUnknown() {
        let s=(0..<25).map {SupportSample(u:300+Double($0)*0.01,v:240,value:2,confidence:1)}
        XCTAssertEqual(measure(s).reason,"low-spatial-support")
    }
    func testWineGlassConservativeButOpaqueBottleAndCupAllowed() {
        XCTAssertEqual(measure(label:"wine glass").reason,"transparent-surface")
        XCTAssertNotNil(measure(label:"bottle").metres)
        XCTAssertNotNil(measure(label:"cup").metres)
    }
    func testMetricDomainAndBoundedSupportBudget() {
        XCTAssertEqual(measure(supports(z:0.1)).reason,"outside-domain")
        XCTAssertEqual(measure(supports(z:6)).reason,"outside-domain")
        let repeated=supports()+Array(repeating:supports()[0],count:2000)
        XCTAssertEqual(measure(repeated).supportCount,25)
        XCTAssertEqual(ObjectRangeEstimator.sampleLimit,256)
        XCTAssertNil(measure(Array(repeating:SupportSample(u:0,v:0,value:2,confidence:0),count:256)+supports()).metres)
    }
    func testExportProjectionTwelveObjectsUsesClosedV1LabelsAnd128TotalSupports() {
        let labels=["person","chair","bottle","cellphone","book","car","refrigerator","cup","pottedplant","truck","tvmonitor","motorbike"]
        let live=supports(n:8),inputs=labels.enumerated().map {ObjectRecordingInput(id:$0.offset+1,label:$0.element,score:0.9,box:box,samples:live)}
        let projected=ObjectExportProjection.project(inputs,imageWidth:640,imageHeight:480)
        XCTAssertEqual(projected.targets.count,12);XCTAssertEqual(projected.samples.count,120);XCTAssertLessThanOrEqual(projected.samples.count,128)
        XCTAssertEqual(projected.targets.map(\.label),["person","chair","bottle","phone","book","vehicle","unknown","unknown","unknown","vehicle","unknown","vehicle"])
        XCTAssertTrue(projected.targets.allSatisfy {$0.support=="bbox-only" && $0.sampleIndices.count==10})
        XCTAssertEqual(projected.targets.flatMap(\.sampleIndices),Array(projected.samples.indices))
        // The projection neither mutates nor shrinks the full live estimate input.
        XCTAssertEqual(inputs.map {$0.samples.count},Array(repeating:64,count:12))
        XCTAssertNotNil(measure(live).metres)
        XCTAssertEqual(projected.samples.first!.u,live.first!.u);XCTAssertEqual(projected.samples[9].v,live.last!.v)
    }
    func testExportProjectionKeepsMissingDepthTargetsWithoutInventingSupports() {
        let inputs=(1...12).map {ObjectRecordingInput(id:$0,label:"refrigerator",score:0.9,box:box,samples:[])}
        let projected=ObjectExportProjection.project(inputs,imageWidth:640,imageHeight:480)
        XCTAssertEqual(projected.targets.count,12);XCTAssertTrue(projected.samples.isEmpty)
        XCTAssertTrue(projected.targets.allSatisfy {$0.sampleIndices.isEmpty && $0.support=="bbox-only" && $0.label=="unknown"})
    }
    func testExportProjectionRejectsOffBoxCorruptionAndDuplicateIdentities() {
        let bad=[SupportSample(u:0,v:0,value:2,confidence:1),SupportSample(u:.nan,v:240,value:2,confidence:1),SupportSample(u:320,v:240,value:2,confidence:1.1)]
        let inputs=[ObjectRecordingInput(id:1,label:"person",score:0.9,box:box,samples:bad+supports()),ObjectRecordingInput(id:1,label:"chair",score:0.9,box:box,samples:supports()),ObjectRecordingInput(id:2,label:"person",score:.nan,box:box,samples:supports())]
        let projected=ObjectExportProjection.project(inputs,imageWidth:640,imageHeight:480)
        XCTAssertEqual(projected.targets.count,1);XCTAssertEqual(projected.samples.count,25)
        XCTAssertTrue(projected.samples.allSatisfy {$0.u.isFinite && $0.u>=128 && $0.confidence<=1})
        XCTAssertTrue(ObjectExportProjection.project(inputs,imageWidth:0,imageHeight:480).targets.isEmpty)
    }
    func testEveryCOCOLabelProjectsIntoClosedV1VocabularyOnly() {
        let closed=Set(["person","chair","bottle","phone","book","wall","vehicle","unknown"])
        for label in ObjectLabels.translations.keys {XCTAssertTrue(closed.contains(ObjectExportProjection.recordingLabel(label)))}
        XCTAssertEqual(ObjectExportProjection.recordingLabel("wall"),"wall")
        XCTAssertEqual(ObjectExportProjection.recordingLabel("cell_phone"),"phone")
        XCTAssertEqual(ObjectExportProjection.recordingLabel("motorbike"),"vehicle")
        XCTAssertEqual(ObjectExportProjection.recordingLabel("fan"),"unknown")
    }
    func testExportProjectionRejectsSubMillipixelBoxesAndClampsFloatingEdges() {
        let sliver=ObjectRecordingInput(id:1,label:"person",score:0.9,box:Rect(x:0.2,y:0.2,width:0.0000011,height:0.3),samples:[])
        XCTAssertTrue(ObjectExportProjection.project([sliver],imageWidth:640,imageHeight:480).targets.isEmpty)
        // The same normalized rectangle is above the minimum at higher RGB
        // resolution, proving the guard is in pixels rather than model units.
        XCTAssertEqual(ObjectExportProjection.project([sliver],imageWidth:1920,imageHeight:1080).targets.count,1)
        for x in [0.123456789,0.356783713,0.999999] {
            let input=ObjectRecordingInput(id:1,label:"book",score:0.9,box:Rect(x:x,y:0.45678123,width:1,height:1),samples:[])
            if let target=ObjectExportProjection.project([input],imageWidth:1920,imageHeight:1080).targets.first {
                XCTAssertGreaterThanOrEqual(target.box.width,0.001)
                XCTAssertLessThanOrEqual(target.box.x+target.box.width,1920)
                XCTAssertLessThanOrEqual(target.box.y+target.box.height,1080)
            }
        }
    }
    func testGlobalAssociationDoesNotConsumeAnotherDetectionsOnlyValidMatch() {
        var tracker=ObjectTracker()
        let initial=tracker.update([detection(0.2,score:0.95),detection(0.34,score:0.9)],atMs:0)
        let a=initial.first {$0.box.x==0.2}!.id,b=initial.first {$0.box.x==0.34}!.id
        let result=tracker.update([detection(0.255,score:0.95),detection(0.17,score:0.9)],atMs:100)
        XCTAssertEqual(result.count,2);XCTAssertFalse(result.contains {$0.isCoasting})
        XCTAssertEqual(result.first {$0.box.x==0.255}!.id,b)
        XCTAssertEqual(result.first {$0.box.x==0.17}!.id,a)
        XCTAssertTrue(result.allSatisfy {$0.range.metres == nil})
    }
    func testGlobalAssociationIsIndependentOfDetectionConfidenceOrder() {
        for swap in [false,true] {
            var tracker=ObjectTracker()
            let initial=tracker.update([detection(0.2,score:0.95),detection(0.34,score:0.9)],atMs:0)
            let a=initial.first {$0.box.x==0.2}!.id,b=initial.first {$0.box.x==0.34}!.id
            let p=detection(0.255,score:swap ? 0.85:0.95),q=detection(0.17,score:swap ? 0.95:0.85)
            let result=tracker.update(swap ? [q,p]:[p,q],atMs:100)
            XCTAssertEqual(result.count,2);XCTAssertEqual(result.first {$0.box.x==0.255}!.id,b)
            XCTAssertEqual(result.first {$0.box.x==0.17}!.id,a)
        }
    }
    func testThreeAmbiguousCandidatesRetireWithoutGhostsOrRangeBorrowing() {
        var tracker=ObjectTracker()
        let initial=tracker.update([detection(0.2),detection(0.35),detection(0.5)],atMs:0)
        let oldIDs=Set(initial.map(\.id))
        let result=tracker.update([detection(0.275)],atMs:100)
        XCTAssertEqual(result.filter {!$0.isCoasting}.count,1)
        XCTAssertFalse(oldIDs.contains(result.first {$0.box.x==0.275}!.id))
        XCTAssertFalse(result.contains {$0.isCoasting && ($0.box.x==0.2 || $0.box.x==0.35)})
    }
    func testMaximumGlobalAssociationBudgetKeepsTwelveUnambiguousIDs() {
        var tracker=ObjectTracker()
        let observations=(0..<12).map {i in ObjectDetection(label:"person",score:0.95-Double(i)*0.01,box:Rect(x:Double(i%4)*0.24+0.02,y:Double(i/4)*0.3+0.02,width:0.16,height:0.2))}
        let initial=tracker.update(observations,atMs:0),ids=Set(initial.map(\.id))
        let shuffled=observations.reversed().map {d -> ObjectDetection in var d=d;d.box.x+=0.005;return d}
        let result=tracker.update(shuffled,atMs:100)
        XCTAssertEqual(result.count,12);XCTAssertEqual(Set(result.map(\.id)),ids)
        XCTAssertFalse(result.contains {$0.isCoasting})
    }
}
