import XCTest
import UIKit

final class ProbeUITests:XCTestCase {
    override func setUp() { continueAfterFailure=false }
    override func tearDown() {
        // A failed assertion must not skip orientation cleanup and leak a
        // landscape device into the next otherwise independent test case.
        XCUIDevice.shared.orientation = .portrait
        super.tearDown()
    }
    func testUnsupportedSimulatorDoesNotInventMetresOrEnableRecording() {
        let app=XCUIApplication(); app.launch()
        XCTAssertEqual(app.staticTexts["range"].label,"Chưa đo")
        app.buttons["diagnostics"].tap()
        XCTAssertFalse(app.buttons["record"].isEnabled); XCTAssertFalse(app.buttons["export"].isEnabled)
        app.buttons["start"].tap(); XCTAssertTrue(app.staticTexts["status"].label.contains("Simulator")); screenshot("unsupported")
    }
    func testSelectedSurfaceConfirmationAndStaleReset() {
        let app=XCUIApplication(); app.launchArguments=["--qa-fixture","--qa-manual","--qa-stale"]; app.launch()
        app.buttons["diagnostics"].tap()
        XCTAssertTrue(app.staticTexts["source"].label.contains("Mô phỏng")); XCTAssertFalse(app.buttons["surface"].isEnabled)
        app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.32)).tap(); XCTAssertTrue(app.buttons["surface"].isEnabled)
        XCTAssertEqual(app.staticTexts["range"].label,"Chưa đo"); app.buttons["surface"].tap()
        let measured=NSPredicate(format:"label CONTAINS '2.0'"); expectation(for:measured,evaluatedWith:app.staticTexts["range"]); waitForExpectations(timeout:2)
        XCTAssertFalse(app.buttons["record"].isEnabled); XCTAssertFalse(app.buttons["export"].isEnabled); screenshot("fixture-selected")
        let unknown=NSPredicate(format:"label == 'Chưa đo'"); expectation(for:unknown,evaluatedWith:app.staticTexts["range"]); waitForExpectations(timeout:6)
        XCTAssertTrue(app.staticTexts["status"].label.contains("300 ms")); screenshot("fixture-stale")
    }
    func testBackgroundClearsAndNeverAutoRestarts() {
        let app=XCUIApplication(); app.launchArguments=["--qa-fixture","--qa-manual"]; app.launch()
        app.buttons["diagnostics"].tap()
        app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.32)).tap(); app.buttons["surface"].tap()
        XCUIDevice.shared.press(.home); app.activate()
        XCTAssertEqual(app.staticTexts["range"].label,"Chưa đo"); XCTAssertTrue(app.staticTexts["count"].label.contains("0/600")); XCTAssertFalse(app.buttons["export"].isEnabled)
        screenshot("background-cleared")
    }
    func testRetargetAndRotationRequireFreshSurfaceConfirmation() {
        let app=XCUIApplication(); app.launchArguments=["--qa-fixture","--qa-manual"]; app.launch()
        app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.32)).tap(); app.buttons["surface"].tap()
        expectation(for:NSPredicate(format:"label CONTAINS '2.0'"),evaluatedWith:app.staticTexts["range"]); waitForExpectations(timeout:3)
        app.coordinate(withNormalizedOffset:CGVector(dx:0.35,dy:0.30)).tap()
        XCTAssertEqual(app.staticTexts["range"].label,"Chưa đo"); XCTAssertTrue(app.buttons["surface"].isEnabled)
        app.buttons["surface"].tap()
        expectation(for:NSPredicate(format:"label CONTAINS '2.0'"),evaluatedWith:app.staticTexts["range"]); waitForExpectations(timeout:3)
        XCUIDevice.shared.orientation = .landscapeLeft
        expectation(for:NSPredicate {_,_ in app.frame.width>app.frame.height && !app.buttons["surface"].isEnabled},evaluatedWith:app); waitForExpectations(timeout:5)
        XCTAssertEqual(app.staticTexts["range"].label,"Chưa đo")
        let viewport=app.scrollViews["controls"].frame
        XCTAssertTrue(viewport.contains(app.staticTexts["range"].frame),"Collapsed landscape must keep the full fresh range readout visible, without scrolling")
        for id in ["start","surface","diagnostics"] {
            let button=app.buttons[id]
            XCTAssertTrue(viewport.contains(button.frame),"Collapsed landscape hides the \(id) camera action")
            XCTAssertGreaterThanOrEqual(button.frame.height,44)
            XCTAssertGreaterThanOrEqual(button.frame.width,44)
        }
        screenshot("rotation-invalidated")
        XCUIDevice.shared.orientation = .portrait
    }
    func testLandscapeAndLargeTypeControlsReachable() {
        let app=XCUIApplication(); app.launchArguments=["-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryAccessibilityM"]; app.launch()
        app.segmentedControls["mode"].buttons["Đo điểm"].tap()
        app.buttons["diagnostics"].tap()
        XCUIDevice.shared.orientation = .landscapeLeft
        expectation(for:NSPredicate {_,_ in app.frame.width>app.frame.height},evaluatedWith:app); waitForExpectations(timeout:5)
        let scroll=app.scrollViews["controls"]; XCTAssertTrue(scroll.exists)
        for id in ["start","surface","record","export","truth","erase"] {
            let b=app.buttons[id]; XCTAssertTrue(b.exists)
            func centreVisible() -> Bool { scroll.frame.contains(CGPoint(x:b.frame.midX,y:b.frame.midY)) }
            for step in 0..<16 {
                if centreVisible() { break }
                print("Reach \(id) step \(step) button=\(b.frame) viewport=\(scroll.frame)")
                // Fast swipe may overshoot a row. Read its actual position and
                // drag a short distance in either direction, like a user.
                let above=b.frame.midY<scroll.frame.minY
                let from=scroll.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:above ? 0.35:0.65))
                let to=scroll.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:above ? 0.65:0.35))
                from.press(forDuration:0.1,thenDragTo:to)
            }
            if !centreVisible() { screenshot("large-type-unreachable-\(id)"); print(app.debugDescription) }
            XCTAssertTrue(centreVisible(),"\(id) cannot be reached in large-type landscape scroll")
            XCTAssertGreaterThanOrEqual(b.frame.width,44); XCTAssertGreaterThanOrEqual(b.frame.height,44)
        }
        screenshot("landscape-large-type")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.staticTexts["source"].exists)
    }
    func testAutomaticRecognitionShowsTwoVietnameseBoxesWithoutManualSelection() {
        let app=objectFixture()
        XCTAssertTrue(app.segmentedControls["mode"].buttons["Tự động"].isSelected)
        XCTAssertFalse(app.buttons["record"].exists,"Recording controls should not cover the default camera view")
        XCTAssertTrue(app.staticTexts["source"].label.contains("Mô phỏng"))
        app.buttons["start"].tap()
        waitForObjects(app)
        let labels=objectElements(app).allElementsBoundByIndex.map(\.label)
        XCTAssertTrue(labels.contains { $0.contains("Người") && $0.contains("2.0") })
        XCTAssertTrue(labels.contains { $0.contains("Điện thoại") })
        XCTAssertFalse(app.buttons["surface"].exists,"Automatic recognition must not require manual confirmation")
        screenshot("objects-auto-two-vietnamese")
    }
    func testAutomaticStopRemovesBoxesAndFreshRange() {
        let app=objectFixture();app.buttons["start"].tap();waitForObjects(app)
        app.buttons["start"].tap()
        expectation(for:NSPredicate {_,_ in self.objectElements(app).count==0},evaluatedWith:app);waitForExpectations(timeout:3)
        XCTAssertEqual(app.staticTexts["range"].label,"Chưa đo")
        XCTAssertEqual(app.buttons["start"].label,"Mở camera")
        screenshot("objects-stopped-clear")
    }
    func testAutomaticBackgroundClearsWithoutRestart() {
        let app=objectFixture();app.buttons["start"].tap();waitForObjects(app)
        XCUIDevice.shared.press(.home);app.activate()
        XCTAssertEqual(objectElements(app).count,0)
        XCTAssertEqual(app.staticTexts["range"].label,"Chưa đo")
        XCTAssertEqual(app.buttons["start"].label,"Mở camera")
        screenshot("objects-background-clear")
    }
    func testAutomaticStaleBoxesCannotKeepOldMetres() {
        let app=objectFixture(["--qa-object-stale"]);app.buttons["start"].tap();waitForObjects(app)
        expectation(for:NSPredicate {_,_ in
            app.staticTexts["range"].label=="Chưa đo" && !self.objectElements(app).allElementsBoundByIndex.contains { $0.label.contains("2.0") }
        },evaluatedWith:app);waitForExpectations(timeout:7)
        screenshot("objects-stale-no-metric")
    }
    func testAutomaticAmbiguousDepthNeverInventsMetric() {
        let app=objectFixture(["--qa-object-ambiguous"]);app.buttons["start"].tap();waitForObjects(app)
        XCTAssertEqual(app.staticTexts["range"].label,"Chưa đo")
        XCTAssertFalse(objectElements(app).allElementsBoundByIndex.contains { $0.label.contains("≈") })
        screenshot("objects-ambiguous-no-metric")
    }
    func testAutomaticManualModeAndDiagnosticsRemainAvailable() {
        let app=objectFixture();app.buttons["start"].tap();waitForObjects(app)
        app.segmentedControls["mode"].buttons["Đo điểm"].tap()
        XCTAssertTrue(app.buttons["surface"].exists)
        XCTAssertEqual(objectElements(app).count,0)
        app.buttons["diagnostics"].tap()
        for id in ["record","export","truth","erase"] { XCTAssertTrue(app.buttons[id].exists) }
        XCTAssertFalse(app.buttons["record"].isEnabled,"Synthetic fixtures may not create authentic recordings")
        app.segmentedControls["mode"].buttons["Tự động"].tap()
        XCTAssertFalse(app.buttons["surface"].exists)
        screenshot("objects-modes-diagnostics")
    }
    func testDenseSceneRetainsTwelveUniqueIdentitiesWithoutBadgeOrHUDCollisions() {
        let app=objectFixture(["--qa-object-dense"]);app.buttons["start"].tap()
        expectation(for:NSPredicate {_,_ in self.objectElements(app).count==12},evaluatedWith:app);waitForExpectations(timeout:4)
        let elements=objectElements(app).allElementsBoundByIndex
        XCTAssertEqual(Set(elements.map(\.identifier)).count,12)
        XCTAssertTrue(elements.allSatisfy {$0.label.hasPrefix("#")})
        assertBadgeGeometry(app,minimumVisible:3)
        screenshot("scientific-dense-twelve-ids")
    }
    func testJitterAndReducedMotionKeepIdentityAndNeverExtendStaleMetres() {
        let app=objectFixture(["--qa-object-jitter","--qa-reduced-motion","--qa-object-stale"])
        app.buttons["start"].tap();waitForObjects(app)
        let before=Set(objectElements(app).allElementsBoundByIndex.map(\.identifier)),began=Date()
        XCTAssertTrue(objectElements(app).allElementsBoundByIndex.contains {$0.label.contains("≈2.0 m")})
        XCTAssertFalse(objectElements(app).allElementsBoundByIndex.contains {$0.label.contains("2.01")},"Display tenths are not a claim of centimetre accuracy")
        expectation(for:NSPredicate {_,_ in Date().timeIntervalSince(began)>0.45},evaluatedWith:app);waitForExpectations(timeout:2)
        XCTAssertEqual(Set(objectElements(app).allElementsBoundByIndex.map(\.identifier)),before)
        screenshot("scientific-jitter-reduced-motion")
        expectation(for:NSPredicate {_,_ in app.staticTexts["range"].label=="Chưa đo" && !self.objectElements(app).allElementsBoundByIndex.contains {$0.label.contains("≈")}},evaluatedWith:app);waitForExpectations(timeout:7)
        screenshot("scientific-jitter-expired")
    }
    func testEdgeObjectsCannotPlaceBadgesOverCameraInstrumentsAfterRotation() {
        let app=objectFixture(["--qa-object-edge","--qa-bright-background"]);app.buttons["start"].tap();waitForObjects(app)
        assertBadgeGeometry(app,minimumVisible:0)
        screenshot("scientific-edge-bright-portrait")
        XCUIDevice.shared.orientation = .landscapeLeft
        expectation(for:NSPredicate {_,_ in app.frame.width>app.frame.height && self.objectElements(app).count==2},evaluatedWith:app);waitForExpectations(timeout:5)
        assertBadgeGeometry(app,minimumVisible:0)
        XCTAssertTrue(app.scrollViews["controls"].frame.contains(app.staticTexts["range"].frame))
        XCTAssertGreaterThanOrEqual(app.buttons["start"].frame.height,44)
        screenshot("scientific-edge-bright-landscape")
    }
    func testScientificPortraitInstrumentIsCompactAndRecordingIsExplicit() {
        let app=objectFixture(["--qa-bright-background"]);app.buttons["start"].tap();waitForObjects(app)
        let controls=app.scrollViews["controls"]
        XCTAssertLessThan(controls.frame.height,app.frame.height*0.30,"Default instrument must preserve camera area")
        XCTAssertTrue(controls.frame.contains(app.staticTexts["range"].frame))
        for id in ["start","diagnostics"] {
            XCTAssertTrue(controls.frame.contains(app.buttons[id].frame));XCTAssertGreaterThanOrEqual(app.buttons[id].frame.height,44)
        }
        XCTAssertFalse(app.buttons["record"].exists);assertBadgeGeometry(app,minimumVisible:2)
        screenshot("scientific-compact-bright-portrait")
        app.buttons["diagnostics"].tap()
        XCTAssertTrue(app.buttons["record"].exists);XCTAssertFalse(app.buttons["record"].isEnabled)
        XCTAssertTrue(app.staticTexts["source"].label.contains("Mô phỏng"))
    }
    func testDenseLargeTypePreservesAccessibleObjectsAndReadableInstruments() {
        let app=objectFixture(["--qa-object-dense","-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryAccessibilityM"])
        app.buttons["start"].tap()
        expectation(for:NSPredicate {_,_ in self.objectElements(app).count==12},evaluatedWith:app);waitForExpectations(timeout:4)
        XCTAssertTrue(objectElements(app).allElementsBoundByIndex.allSatisfy {!$0.label.isEmpty})
        assertBadgeGeometry(app,minimumVisible:1)
        XCTAssertTrue(app.buttons["start"].isHittable);XCTAssertGreaterThanOrEqual(app.buttons["diagnostics"].frame.height,44)
        screenshot("scientific-dense-accessible-portrait")
        XCUIDevice.shared.orientation = .landscapeLeft
        expectation(for:NSPredicate {_,_ in app.frame.width>app.frame.height && self.objectElements(app).count==12},evaluatedWith:app);waitForExpectations(timeout:5)
        assertBadgeGeometry(app,minimumVisible:0)
        XCTAssertTrue(app.staticTexts["range"].exists);XCTAssertTrue(app.staticTexts["source"].exists)
        screenshot("scientific-dense-accessible-landscape")
    }
    func testSevenClassesHaveActualDistinctChromaticFillsOnBrightCamera() {
        let app=objectFixture(["--qa-class-palette","--qa-bright-background"]);app.buttons["start"].tap()
        expectation(for:NSPredicate {_,_ in self.objectElements(app).count==7},evaluatedWith:app);waitForExpectations(timeout:4)
        assertBadgeGeometry(app,minimumVisible:7);assertClassFillPixels(app)
        XCTAssertFalse(objectElements(app).allElementsBoundByIndex.contains {$0.label.contains("Quạt")})
        screenshot("class-fills-seven-bright-measured")
    }
    func testUnknownMetresAndReduceTransparencyKeepTheSameOpaqueClassFills() {
        let app=objectFixture(["--qa-class-palette","--qa-bright-background","--qa-object-ambiguous","--qa-reduce-transparency"]);app.buttons["start"].tap()
        expectation(for:NSPredicate {_,_ in self.objectElements(app).count==7},evaluatedWith:app);waitForExpectations(timeout:4)
        XCTAssertEqual(app.staticTexts["range"].label,"Chưa đo")
        XCTAssertTrue(objectElements(app).allElementsBoundByIndex.allSatisfy {$0.label.contains("chưa đo") && !$0.label.contains("≈")})
        assertBadgeGeometry(app,minimumVisible:7);assertClassFillPixels(app)
        screenshot("class-fills-seven-unknown-reduce-transparency")
    }
    private func assertClassFillPixels(_ app:XCUIApplication) {
        // Read REAL rendered simulator pixels, not a mock enum or an AX color
        // string. Sampling padded interior avoids text/border antialiasing.
        let expected:[String:[UInt8]]=["Người":[0x08,0x5A,0x9C],"Điện thoại":[0x72,0x38,0xAC],"Điều khiển":[0x8E,0x5D,0x09],"Ghế":[0x0A,0x71,0x62],"Sách":[0x3F,0x4D,0xAD],"Chai":[0x96,0x3E,0x79],"Tủ lạnh":[0x33,0x67,0x7C]]
        guard let image=XCUIScreen.main.screenshot().image.cgImage else {XCTFail("Cannot inspect screenshot pixels");return}
        for (name,rgb) in expected {
            guard let element=objectElements(app).allElementsBoundByIndex.first(where:{$0.label.contains("· \(name) ·")}) else {XCTFail("Missing class \(name)");continue}
            XCTAssertFalse(String(describing:element.value ?? "").contains("Nhãn ẩn"))
            let x=(element.frame.minX+4-app.frame.minX)*Double(image.width)/app.frame.width
            let y=(element.frame.midY-app.frame.minY)*Double(image.height)/app.frame.height
            guard let crop=image.cropping(to:CGRect(x:floor(x),y:floor(y),width:1,height:1)),let space=CGColorSpace(name:CGColorSpace.sRGB) else {XCTFail("Invalid badge pixel bounds");continue}
            var pixel=[UInt8](repeating:0,count:4)
            let drawn=pixel.withUnsafeMutableBytes {bytes -> Bool in
                guard let context=CGContext(data:bytes.baseAddress,width:1,height:1,bitsPerComponent:8,bytesPerRow:4,space:space,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue) else {return false}
                context.draw(crop,in:CGRect(x:0,y:0,width:1,height:1));return true
            }
            XCTAssertTrue(drawn)
            for component in 0..<3 {XCTAssertLessThanOrEqual(abs(Int(pixel[component])-Int(rgb[component])),8,"Actual \(name) fill is wrong or obscured; pixel=\(pixel) expected=\(rgb)")}
            XCTAssertEqual(pixel[3],255,"Class fill must be opaque")
        }
    }
    private func assertBadgeGeometry(_ app:XCUIApplication,minimumVisible:Int) {
        let visible=objectElements(app).allElementsBoundByIndex.filter {!String(describing:$0.value ?? "").contains("Nhãn ẩn")}
        XCTAssertGreaterThanOrEqual(visible.count,minimumVisible)
        for (index,element) in visible.enumerated() {
            XCTAssertTrue(app.frame.contains(element.frame),"Visible label must be fully within camera viewport")
            XCTAssertFalse(element.frame.intersects(app.scrollViews["controls"].frame),"Badge covers controls")
            XCTAssertFalse(element.frame.intersects(app.staticTexts["source"].frame),"Badge covers permanent source warning")
            for other in visible.dropFirst(index+1) {XCTAssertFalse(element.frame.intersects(other.frame),"Object badges overlap")}
        }
    }
    private func objectFixture(_ extra:[String]=[]) -> XCUIApplication {
        let app=XCUIApplication();app.launchArguments=["--qa-objects"]+extra;app.launch();return app
    }
    private func objectElements(_ app:XCUIApplication) -> XCUIElementQuery {
        app.descendants(matching:.any).matching(NSPredicate(format:"identifier BEGINSWITH 'object-'"))
    }
    private func waitForObjects(_ app:XCUIApplication) {
        expectation(for:NSPredicate {_,_ in self.objectElements(app).count==2},evaluatedWith:app);waitForExpectations(timeout:3)
    }
    private func screenshot(_ name:String) { let attachment=XCTAttachment(screenshot:XCUIScreen.main.screenshot());attachment.name=name;attachment.lifetime = .keepAlways; add(attachment) }
}
