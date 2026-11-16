import XCTest
@testable import AssistiveCore

final class SceneNarrationTests: XCTestCase {
    private let identity = Affine(a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0)

    private func track(_ id: Int = 1, _ label: String = "person", x: Double = 0.68,
                       width: Double = 0.16, time: Double, detected: Double? = nil,
                       metres: Double? = nil, rangeTime: Double? = nil,
                       coast: Bool = false, score: Double = 0.9) -> ObjectTrack {
        ObjectTrack(id: id, label: label, score: score,
                    box: Rect(x: x, y: 0.22, width: width, height: 0.30),
                    lastSeenMs: time, lastDetectedAtMs: detected ?? time,
                    range: ProbeResult(metres: metres, reason: metres == nil ? "no-depth" : "approximate-bbox-surface"),
                    rangeCapturedAtMs: rangeTime ?? (metres == nil ? nil : time), isCoasting: coast)
    }

    func testOverviewPrioritizesPeopleAndCapsDistinctGroups() {
        var scene = SceneNarration()
        scene.observe(tracks: [
            track(1, "book", time: 100, score: 0.99),
            track(2, "motorbike", time: 100, score: 0.96),
            track(3, "bottle", time: 100, metres: 0.6, score: 0.94),
            track(4, x: 0.10, time: 100), track(5, x: 0.68, time: 100)
        ], transform: identity, nowMs: 100)
        let summary = scene.answer(.overview, nowMs: 100)
        XCTAssertEqual(summary, "Trong khung hình nhận diện được ít nhất 2 người, sách, một chiếc xe máy.")
        XCTAssertFalse(summary.contains("chai"))
        XCTAssertFalse(summary.contains("mét"))
    }

    func testRightCountUsesDisplayNotRawCoordinates() {
        var scene = SceneNarration()
        let rotated = Affine(a: -1, b: 0, c: 0, d: -1, tx: 1, ty: 1)
        scene.observe(tracks: [track(x: 0.15, time: 100)], transform: rotated, nowMs: 100)
        XCTAssertEqual(scene.answer(.peopleRight, nowMs: 100),
                       "Nhận diện được ít nhất 1 người ở bên phải khung hình.")
        scene.observe(tracks: [track(x: 0.15, time: 200)], transform: identity, nowMs: 200)
        XCTAssertEqual(scene.answer(.peopleRight, nowMs: 200), "Chưa nhận diện được người ở bên phải khung hình.")
    }

    func testCenterAndEmptySceneNeverClaimZeroPeopleOrClearPath() {
        var scene = SceneNarration()
        scene.observe(tracks: [track(x: 0.42, time: 100)], transform: identity, nowMs: 100)
        XCTAssertTrue(scene.answer(.peopleRight, nowMs: 100).contains("chưa xác định"))
        scene.observe(tracks: [], transform: identity, nowMs: 200)
        XCTAssertEqual(scene.answer(.overview, nowMs: 200), "Chưa nhận diện được đối tượng rõ ràng trong khung hình.")
        XCTAssertFalse(scene.answer(.peopleRight, nowMs: 200).contains("0 người"))
    }

    func testCoastedOffscreenFutureAndUnknownLabelsDoNotCount() {
        var scene = SceneNarration()
        scene.observe(tracks: [
            track(1, time: 100, coast: true), track(2, time: 101),
            track(3, x: 1.1, time: 100), track(4, x: 0.8, time: 100, detected: 110),
            track(5, "unknown", time: 100), track(6, time: 100, score: .nan)
        ], transform: identity, nowMs: 100)
        XCTAssertTrue(scene.answer(.peopleRight, nowMs: 100).hasPrefix("Chưa nhận diện"))
        XCTAssertFalse(scene.answer(.overview, nowMs: 100).contains("unknown"))
        scene.observe(tracks: [track(time: 4_000, detected: 999)], transform: identity, nowMs: 4_000)
        XCTAssertTrue(scene.answer(.peopleRight, nowMs: 4_000).hasPrefix("Chưa nhận diện"))
    }

    func testDuplicateIdsAndNearIdenticalSameClassBoxesDoNotOvercount() {
        var scene = SceneNarration()
        scene.observe(tracks: [
            track(1, x: 0.59, time: 100), track(1, x: 0.80, time: 100),
            track(2, x: 0.78, time: 100), track(3, x: 0.79, time: 100, score: 0.85)
        ], transform: identity, nowMs: 100)
        XCTAssertTrue(scene.answer(.peopleRight, nowMs: 100).contains("ít nhất 1 người"))
    }

    func testDistanceDescribesSurfaceAndExpiresIndependentlyOfVisibleTrack() {
        var scene = SceneNarration()
        scene.observe(tracks: [track(time: 300, metres: 2.04, rangeTime: 0)], transform: identity, nowMs: 300)
        XCTAssertTrue(scene.answer(.overview, nowMs: 300).contains("Camera cách bề mặt của người khoảng 2,0 mét."))
        XCTAssertFalse(scene.answer(.overview, nowMs: 300.1).contains("mét"))
        XCTAssertTrue(scene.answer(.overview, nowMs: 300.1).contains("ít nhất 1 người"))
        XCTAssertEqual(scene.answer(.overview, nowMs: 601), SceneNarration.unavailable)
    }

    func testInvalidMetricCannotBecomeNarratedDistance() {
        var scene = SceneNarration()
        for (index, value) in [Double.nan, .infinity, 0.4, 5.1].enumerated() {
            let time = Double(index * 100)
            scene.observe(tracks: [track(time: time, metres: value)], transform: identity, nowMs: time)
            XCTAssertFalse(scene.answer(.overview, nowMs: time).contains("mét"))
        }
        scene.observe(tracks: [track(time: 400, metres: 2, rangeTime: 401)], transform: identity, nowMs: 400)
        XCTAssertFalse(scene.answer(.overview, nowMs: 400).contains("mét"))
    }

    func testNewTrackNeedsWarmupIndependentFramesAndCurrentVisibility() {
        var scene = SceneNarration()
        scene.observe(tracks: [track(time: 0)], transform: identity, nowMs: 0)
        XCTAssertTrue(scene.answer(.changes, nowMs: 0).hasPrefix("Chưa đủ khung hình"))
        scene.observe(tracks: [track(time: 450), track(2, "car", time: 450)], transform: identity, nowMs: 450)
        XCTAssertTrue(scene.answer(.changes, nowMs: 450).hasPrefix("Chưa xác nhận"))
        scene.observe(tracks: [track(time: 450), track(2, "car", time: 450)], transform: identity, nowMs: 550)
        XCTAssertTrue(scene.answer(.changes, nowMs: 550).hasPrefix("Chưa xác nhận"))
        scene.observe(tracks: [track(time: 580), track(2, "car", time: 580, detected: 450)], transform: identity, nowMs: 580)
        XCTAssertEqual(scene.answer(.changes, nowMs: 580), "Trong khung hình vừa nhận diện thêm một chiếc ô tô.")
        scene.observe(tracks: [track(time: 680)], transform: identity, nowMs: 680)
        XCTAssertTrue(scene.answer(.changes, nowMs: 680).hasPrefix("Chưa xác nhận"))
        scene.observe(tracks: [track(time: 780), track(2, "car", time: 780)], transform: identity, nowMs: 780)
        XCTAssertTrue(scene.answer(.changes, nowMs: 780).hasPrefix("Chưa xác nhận"))
    }

    func testSameIdMotionAndMissingObservationNeverBecomePhysicalClaims() {
        var scene = SceneNarration()
        scene.observe(tracks: [track(x: 0.10, time: 0)], transform: identity, nowMs: 0)
        scene.observe(tracks: [track(x: 0.80, time: 400)], transform: identity, nowMs: 400)
        XCTAssertTrue(scene.answer(.changes, nowMs: 400).hasPrefix("Chưa xác nhận"))
        scene.observe(tracks: [], transform: identity, nowMs: 500)
        XCTAssertTrue(scene.answer(.changes, nowMs: 500).hasPrefix("Chưa xác nhận"))
    }

    func testExplicitResetInvalidTransformAndClockBreakInvalidateEvidence() {
        var scene = SceneNarration()
        scene.observe(tracks: [track(time: 900)], transform: identity, nowMs: 900)
        XCTAssertEqual(scene.answer(.overview, nowMs: 899), SceneNarration.unavailable)
        XCTAssertEqual(scene.answer(.overview, nowMs: .nan), SceneNarration.unavailable)
        scene.observe(tracks: [track(time: 100)], transform: identity, nowMs: 100)
        XCTAssertTrue(scene.answer(.changes, nowMs: 100).hasPrefix("Chưa đủ khung hình"))
        let invalid = Affine(a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0)
        scene.observe(tracks: [track(time: 200)], transform: invalid, nowMs: 200)
        XCTAssertEqual(scene.answer(.overview, nowMs: 200), SceneNarration.unavailable)
        scene.observe(tracks: [track(time: 300)], transform: identity, nowMs: 300)
        scene.reset()
        XCTAssertEqual(scene.answer(.peopleRight, nowMs: 300), SceneNarration.unavailable)
    }

    func testExtendedGapAndFastIdChurnDoNotCreateChangeStory() {
        var scene = SceneNarration()
        for i in 0..<5 {
            let time = Double(i * 120)
            scene.observe(tracks: (1...12).map { track(i * 12 + $0, "car", x: Double($0 - 1) * 0.08,
                                                       width: 0.06, time: time) },
                          transform: identity, nowMs: time)
        }
        XCTAssertTrue(scene.answer(.changes, nowMs: 480).hasPrefix("Chưa đủ khung hình"))
        scene.observe(tracks: [track(99, "car", time: 2_000)], transform: identity, nowMs: 2_000)
        XCTAssertTrue(scene.answer(.changes, nowMs: 2_000).hasPrefix("Chưa đủ khung hình"))
    }
}
