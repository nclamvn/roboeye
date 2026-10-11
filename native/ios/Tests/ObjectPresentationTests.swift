import XCTest
@testable import AssistiveCore

final class ObjectPresentationTests: XCTestCase {
    let base=Rect(x:0.35,y:0.25,width:0.24,height:0.36)
    func input(_ box: Rect?=nil,id: Int=1,time: Double=0,coast: Bool=false) -> ObjectPresentationInput {
        ObjectPresentationInput(id:id,box:box ?? base,capturedAtMs:time,isCoasting:coast)
    }
    func assertRect(_ a: Rect,_ b: Rect,file: StaticString=#filePath,line: UInt=#line) {
        XCTAssertEqual(a.x,b.x,accuracy:1e-9,file:file,line:line);XCTAssertEqual(a.y,b.y,accuracy:1e-9,file:file,line:line)
        XCTAssertEqual(a.width,b.width,accuracy:1e-9,file:file,line:line);XCTAssertEqual(a.height,b.height,accuracy:1e-9,file:file,line:line)
    }
    func testStationaryJitterRMSFallsByAtLeastFiftyPercent() {
        var state=ObjectPresentationState(),rawErrors:[Double]=[],drawnErrors:[Double]=[]
        for i in 0..<240 {
            let noise=i%2==0 ? 0.006:-0.006,time=Double(i)*1000/30
            var box=base;box.x+=noise;box.y-=noise
            let drawn=state.update([input(box,time:time)],nowMs:time)[1]!
            if i>=30 {rawErrors.append(hypot(box.x-base.x,box.y-base.y));drawnErrors.append(hypot(drawn.x-base.x,drawn.y-base.y))}
        }
        let raw=sqrt(rawErrors.reduce(0){$0+$1*$1}/Double(rawErrors.count)),smooth=sqrt(drawnErrors.reduce(0){$0+$1*$1}/Double(drawnErrors.count)),reduction=1-smooth/raw
        print(String(format:"B3 presentation fixture: raw RMS=%.9f normalized; filtered RMS=%.9f; reduction=%.3f%%",raw,smooth,reduction*100))
        XCTAssertGreaterThanOrEqual(reduction,0.5)
    }
    func testPointTwoJumpSnapsInOneObservationNotTwo() {
        var state=ObjectPresentationState();_=state.update([input()],nowMs:0)
        var moved=base;moved.x+=0.2
        assertRect(state.update([input(moved,time:66)],nowMs:66)[1]!,moved)
    }
    func testRepeatedTimestampDoesNotAdvanceFilterEvenWithChangedCallerRect() {
        var state=ObjectPresentationState();_=state.update([input()],nowMs:0)
        var noisy=base;noisy.x+=0.006
        let filtered=state.update([input(noisy,time:66)],nowMs:66)[1]!
        var changed=noisy;changed.x+=0.2
        for now in [80.0,100,200] {assertRect(state.update([input(changed,time:66)],nowMs:now)[1]!,filtered)}
    }
    func testReducedMotionImmediatelyReturnsRawAndClearsSmoothedHistory() {
        var state=ObjectPresentationState();_=state.update([input()],nowMs:0)
        var noisy=base;noisy.x+=0.008
        _=state.update([input(noisy,time:66)],nowMs:66)
        assertRect(state.update([input(noisy,time:66)],nowMs:70,reducedMotion:true)[1]!,noisy)
        assertRect(state.update([input(noisy,time:100)],nowMs:100)[1]!,noisy)
    }
    func testGapAndExplicitResetSnapRatherThanBlendNewEvidence() {
        var state=ObjectPresentationState();_=state.update([input()],nowMs:0)
        var noisy=base;noisy.x+=0.02
        assertRect(state.update([input(noisy,time:301)],nowMs:301)[1]!,noisy)
        state.reset();assertRect(state.update([input(time:302)],nowMs:302)[1]!,base)
    }
    func testCoastingDoesNotSmearOrPreserveMetricState() {
        var state=ObjectPresentationState();_=state.update([input()],nowMs:0)
        var moved=base;moved.x+=0.02
        assertRect(state.update([input(moved,time:66,coast:true)],nowMs:100)[1]!,moved)
        XCTAssertTrue(state.update([input(moved,time:66,coast:true)],nowMs:667).isEmpty)
    }
    func testInvalidGeometryFutureTimeAndNonfiniteStateClearInsteadOfPropagating() {
        var state=ObjectPresentationState();_=state.update([input()],nowMs:0)
        XCTAssertTrue(state.update([input(Rect(x:.nan,y:0,width:1,height:1),time:66)],nowMs:66).isEmpty)
        assertRect(state.update([input(time:70)],nowMs:70)[1]!,base)
        XCTAssertTrue(state.update([input(time:100)],nowMs:99).isEmpty)
        XCTAssertTrue(state.update([input(time:100)],nowMs:.infinity).isEmpty)
        assertRect(state.update([input(time:0)],nowMs:0)[1]!,base)
    }
    func testPresentationStaysClippedAndBoundedToTwelveWithoutMutatingInput() {
        var state=ObjectPresentationState(maxTracks:100)
        let raw=Rect(x:-0.1,y:0.8,width:0.4,height:0.4)
        let inputs=(1...30).map {input(raw,id:$0,time:0)}
        let result=state.update(inputs,nowMs:0)
        XCTAssertEqual(result.count,12);XCTAssertEqual(inputs[0].box.x,-0.1)
        for r in result.values {XCTAssertGreaterThanOrEqual(r.x,0);XCTAssertGreaterThanOrEqual(r.y,0);XCTAssertLessThanOrEqual(r.x+r.width,1);XCTAssertLessThanOrEqual(r.y+r.height,1)}
    }
    func testRemovingAnIDReappearsWithoutOldFilterMemory() {
        var state=ObjectPresentationState();_=state.update([input()],nowMs:0)
        XCTAssertTrue(state.update([],nowMs:66).isEmpty)
        var moved=base;moved.x+=0.04
        assertRect(state.update([input(moved,time:100)],nowMs:100)[1]!,moved)
    }
    func testMetricFreshnessIsStatelessExactAndNeverBorrowedAfterUnknown() {
        var t=ObjectTrack(id:1,label:"person",score:0.9,box:base,lastSeenMs:0,lastDetectedAtMs:0,range:ProbeResult(metres:2.04,reason:"approximate-interior-supported",supportCount:25),rangeCapturedAtMs:0,isCoasting:false)
        XCTAssertEqual(ObjectDisplayMetric.currentMetres(t,nowMs:300),2.04)
        XCTAssertNil(ObjectDisplayMetric.currentMetres(t,nowMs:300.001))
        t.range=ProbeResult(reason:"no-depth");XCTAssertNil(ObjectDisplayMetric.currentMetres(t,nowMs:100))
        XCTAssertEqual(ObjectDisplayMetric.text(ObjectDisplayMetric.currentMetres(t,nowMs:100)),"— m")
    }
    func testMetricRejectsFutureCorruptOutOfDomainAndCoastingValues() {
        var t=ObjectTrack(id:1,label:"person",score:0.9,box:base,lastSeenMs:0,lastDetectedAtMs:0,range:ProbeResult(metres:2,reason:"supported",supportCount:25),rangeCapturedAtMs:0,isCoasting:false)
        XCTAssertNil(ObjectDisplayMetric.currentMetres(t,nowMs:-1));XCTAssertNil(ObjectDisplayMetric.currentMetres(t,nowMs:.nan))
        for value in [Double.nan,Double.infinity,0.49,5.01] {t.range.metres=value;XCTAssertNil(ObjectDisplayMetric.currentMetres(t,nowMs:10))}
        t.range.metres=2;t.isCoasting=true;XCTAssertNil(ObjectDisplayMetric.currentMetres(t,nowMs:10))
        t.isCoasting=false;t.rangeCapturedAtMs = .nan;XCTAssertNil(ObjectDisplayMetric.currentMetres(t,nowMs:10))
    }
    func testMetresAreCurrentDecimalTenthNotFakeCentimetrePrecision() {
        XCTAssertEqual(ObjectDisplayMetric.text(2.04),"≈2.0 m");XCTAssertEqual(ObjectDisplayMetric.text(2.16),"≈2.2 m")
        XCTAssertEqual(ObjectDisplayMetric.text(nil),"— m");XCTAssertEqual(ObjectDisplayMetric.text(.nan),"— m")
        XCTAssertEqual(ObjectDisplayMetric.text(5.1),"— m")
    }
    func testCommonClassesHaveSevenDistinctActuallyChromaticFills() {
        let labels=["person","cell phone","remote","chair","book","bottle","refrigerator"]
        let colours=labels.map {ObjectClassPalette.colour(for:$0)}
        XCTAssertEqual(Set(colours.map(\.rgb)).count,7)
        for colour in colours {
            let components=[colour.red,colour.green,colour.blue]
            XCTAssertGreaterThan(components.max()!,0.30,"Fill must not be merely near-black")
            XCTAssertGreaterThan(components.max()!-components.min()!,0.15,"Fill must actually be chromatic")
        }
    }
    func testEveryPaletteTokenAndShippingClassHasWhiteTextContrastAtLeastFourPointFive() {
        for token in ObjectClassPalette.all {
            XCTAssertGreaterThanOrEqual(token.whiteContrast,4.5,"Unreadable fill \(token.name) \(token.hex)")
            print(String(format:"B4 palette %@ %@ white contrast=%.3f:1",token.name,token.hex,token.whiteContrast))
        }
        for label in ObjectLabels.translations.keys {XCTAssertGreaterThanOrEqual(ObjectClassPalette.colour(for:label).whiteContrast,4.5)}
    }
    func testCanonicalClassAliasesUseIdenticalFillsWithoutRelabelingRemoteAsPhone() {
        for (alias,canonical) in [("cellphone","cell phone"),(" MOBILE PHONE ","cell phone"),("motorbike","motorcycle"),("sofa","couch"),("pottedplant","potted plant"),("tvmonitor","tv")] {
            XCTAssertEqual(ObjectClassPalette.colour(for:alias),ObjectClassPalette.colour(for:canonical))
        }
        XCTAssertNotEqual(ObjectClassPalette.colour(for:"remote"),ObjectClassPalette.colour(for:"cell phone"))
        XCTAssertEqual(ObjectLabels.canonical("remote"),"remote")
    }
    func testClassFillDoesNotDependOnIDRangeLossOrMetricFreshness() {
        var track=ObjectTrack(id:1,label:"cell phone",score:0.9,box:base,lastSeenMs:0,lastDetectedAtMs:0,range:ProbeResult(metres:2,reason:"supported",supportCount:25),rangeCapturedAtMs:0,isCoasting:false)
        let fill=ObjectClassPalette.colour(for:track.label)
        XCTAssertNotNil(ObjectDisplayMetric.currentMetres(track,nowMs:100))
        track.range=ProbeResult(reason:"no-depth");track.isCoasting=true
        XCTAssertNil(ObjectDisplayMetric.currentMetres(track,nowMs:301))
        XCTAssertEqual(ObjectClassPalette.colour(for:track.label),fill)
        let another=ObjectTrack(id:12,label:track.label,score:track.score,box:track.box,lastSeenMs:0,lastDetectedAtMs:0,range:track.range,rangeCapturedAtMs:nil,isCoasting:true)
        XCTAssertEqual(ObjectClassPalette.colour(for:another.label),fill)
    }
    func testUnsupportedVocabularyHasNoSyntheticFanRecognitionClaim() {
        XCTAssertNil(ObjectLabels.translations["fan"])
        XCTAssertEqual(ObjectClassPalette.colour(for:"fan"),ObjectClassPalette.other)
        XCTAssertEqual(ObjectClassPalette.colour(for:"unseen object"),ObjectClassPalette.other)
    }
    func testPaletteIsDeterministicForAllClassesAndDoesNotMutateGeometry() {
        let labels=ObjectLabels.translations.keys.sorted(),original=base
        let first=labels.map {ObjectClassPalette.colour(for:$0)}
        for _ in 0..<20 {XCTAssertEqual(labels.map {ObjectClassPalette.colour(for:$0)},first)}
        assertRect(base,original)
    }
    func testCollisionPlacementIsDeterministicUnderInputPermutation() {
        let a=ObjectBadgeInput(id:1,box:Rect(x:60,y:180,width:100,height:180),labelSize:Point(110,30)),b=ObjectBadgeInput(id:2,box:Rect(x:100,y:185,width:100,height:180),labelSize:Point(110,30))
        let viewport=Rect(x:0,y:0,width:400,height:700)
        let first=ObjectBadgeLayout.place([a,b],viewport:viewport),second=ObjectBadgeLayout.place([b,a],viewport:viewport)
        XCTAssertEqual(first,second);XCTAssertEqual(first.count,2)
        XCTAssertFalse(overlap(first[1]!,first[2]!))
    }
    func overlap(_ a: Rect,_ b: Rect) -> Bool {min(a.x+a.width,b.x+b.width)>max(a.x,b.x) && min(a.y+a.height,b.y+b.height)>max(a.y,b.y)}
    func testBadgeAvoidsHeaderFooterAndStaysAttachedToItsBox() {
        let viewport=Rect(x:0,y:0,width:400,height:700),header=Rect(x:0,y:0,width:400,height:130),footer=Rect(x:0,y:500,width:400,height:200)
        let input=ObjectBadgeInput(id:1,box:Rect(x:50,y:125,width:120,height:270),labelSize:Point(140,40))
        let r=ObjectBadgeLayout.place([input],viewport:viewport,exclusions:[header,footer])[1]!
        XCTAssertFalse(overlap(r,header));XCTAssertFalse(overlap(r,footer))
        XCTAssertGreaterThanOrEqual(r.x,6);XCTAssertLessThanOrEqual(r.x+r.width,394)
        let attachmentGap=min(abs(r.y+r.height-input.box.y),min(abs(r.y-input.box.y-input.box.height),abs(r.y-input.box.y)))
        XCTAssertLessThanOrEqual(attachmentGap,6)
    }
    func testPreviousValidBadgeSlotIsPreferredAcrossTinyBoxJitter() {
        let viewport=Rect(x:0,y:0,width:400,height:700),first=ObjectBadgeInput(id:1,box:Rect(x:80,y:180,width:100,height:180),labelSize:Point(110,30))
        let previous=ObjectBadgeLayout.place([first],viewport:viewport)
        let shifted=ObjectBadgeInput(id:1,box:Rect(x:81,y:182,width:100,height:180),labelSize:Point(110,30))
        XCTAssertEqual(ObjectBadgeLayout.place([shifted],viewport:viewport,previous:previous)[1],previous[1])
    }
    func testInvalidPreviousSlotCannotOverlapNewExclusionOrHigherPriorityBadge() {
        let viewport=Rect(x:0,y:0,width:400,height:700),box=Rect(x:80,y:180,width:100,height:180)
        let low=ObjectBadgeInput(id:1,box:box,labelSize:Point(110,30),priority:0),high=ObjectBadgeInput(id:2,box:box,labelSize:Point(110,30),priority:10)
        let previous=ObjectBadgeLayout.place([low],viewport:viewport),old=previous[1]!
        let updated=ObjectBadgeLayout.place([low,high],viewport:viewport,previous:previous)
        XCTAssertEqual(updated[2],old);XCTAssertNotEqual(updated[1],old)
        let blocked=ObjectBadgeLayout.place([low],viewport:viewport,exclusions:[old],previous:previous)
        XCTAssertNotEqual(blocked[1],old)
    }
    func testDenseOrOffscreenBadgesAreOmittedNotDetachedIntoArbitrarySpace() {
        let viewport=Rect(x:0,y:0,width:200,height:100),input=ObjectBadgeInput(id:1,box:Rect(x:70,y:20,width:20,height:20),labelSize:Point(140,80))
        XCTAssertTrue(ObjectBadgeLayout.place([input],viewport:viewport,exclusions:[viewport]).isEmpty)
        let offscreen=ObjectBadgeInput(id:2,box:Rect(x:500,y:500,width:100,height:100),labelSize:Point(100,30))
        XCTAssertTrue(ObjectBadgeLayout.place([offscreen],viewport:viewport).isEmpty)
    }
    func testBadgeInputsAndResultRemainBoundedFiniteAcrossLargeTypeAndMalformedSizes() {
        let viewport=Rect(x:0,y:0,width:400,height:700)
        let inputs=(1...30).map {ObjectBadgeInput(id:$0,box:Rect(x:20,y:Double($0)*20,width:200,height:100),labelSize:Point(350,60))}
        let result=ObjectBadgeLayout.place(inputs,viewport:viewport)
        XCTAssertLessThanOrEqual(result.count,12)
        for r in result.values {XCTAssertTrue([r.x,r.y,r.width,r.height].allSatisfy(\.isFinite));XCTAssertGreaterThanOrEqual(r.x,6);XCTAssertLessThanOrEqual(r.x+r.width,394)}
        let invalid=ObjectBadgeInput(id:1,box:base,labelSize:Point(.infinity,30))
        XCTAssertTrue(ObjectBadgeLayout.place([invalid],viewport:viewport).isEmpty)
    }
}
