import XCTest
@testable import AssistiveCore

final class ObjectRuntimePolicyTests:XCTestCase {
    func testShippingDescriptorIsValid() {XCTAssertTrue(ObjectModelDescriptor.shipping.valid)}
    func testInvalidNamesThresholdsAndVocabularyAreRejected() {
        var d=ObjectModelDescriptor();d.resourceName="../remote";XCTAssertFalse(d.valid)
        d=ObjectModelDescriptor();d.confidenceThreshold = .nan;XCTAssertFalse(d.valid)
        d=ObjectModelDescriptor();d.iouThreshold=0;XCTAssertFalse(d.valid)
        d=ObjectModelDescriptor();d.classCount=1000;XCTAssertFalse(d.valid)
    }
    func testTerminalFailureRequiresExplicitReset() {
        var p=ObjectRetryPolicy();p.failed(.missingModel,atMs:0);XCTAssertFalse(p.permits(1_000_000))
        p.succeeded();XCTAssertFalse(p.permits(1_000_000));p.reset();XCTAssertTrue(p.permits(0))
    }
    func testTransientBackoffIsBoundedAndSuccessResets() {
        var p=ObjectRetryPolicy()
        for expected in [250.0,500,1000,2000,2000] {
            p.failed(.vision,atMs:100);XCTAssertEqual(p.nextAttemptAtMs,100+expected)
            XCTAssertFalse(p.permits(100+expected-1));XCTAssertTrue(p.permits(100+expected))
        }
        p.succeeded();XCTAssertEqual(p.consecutiveFailures,0);XCTAssertTrue(p.permits(100))
    }
    func testInvalidClockDoesNotCreateImmediateRetryLoop() {
        var p=ObjectRetryPolicy();p.failed(.vision,atMs:.nan);XCTAssertFalse(p.permits(0))
        XCTAssertFalse(ObjectRetryPolicy().permits(-1))
    }
    func testRollingWindowHasBoundedCapacityAndRejectsInvalidValues() {
        var w=ObjectLatencyWindow(capacity:10_000)
        for i in 0..<1000 {w.observe(Double(i))};w.observe(.nan);w.observe(-1);w.observe(60_001)
        XCTAssertEqual(w.summary.sampleCount,64);XCTAssertEqual(w.summary.p50Ms,967)
        XCTAssertEqual(w.summary.p95Ms!,996,accuracy:0.00001)
    }
    func testEmptyTimingIsUnknownNotZero() {XCTAssertNil(ObjectLatencyWindow().summary.p95Ms)}
    func testStageCountersOnlyCountActuallyExecutedStages() {
        var s=ObjectRuntimeStatistics()
        s.observe(workMs:20,captureReadyMs:25,inferenceMs:12,trackingMs:nil,depthMs:3,depthLockPairs:1,projected:false)
        s.observe(workMs:8,captureReadyMs:11,inferenceMs:nil,trackingMs:4,depthMs:2,depthLockPairs:1,projected:true)
        let d=s.snapshot(busyDrops:7,retrySkips:2)
        XCTAssertEqual(d.detectorCalls,1);XCTAssertEqual(d.trackerCalls,1);XCTAssertEqual(d.depthLockPairs,2)
        XCTAssertEqual(d.metadataProjections,1);XCTAssertEqual(d.busyDrops,7);XCTAssertEqual(d.retrySkips,2)
        XCTAssertEqual(d.work.sampleCount,2);XCTAssertEqual(d.inference.sampleCount,1)
    }
    func testFailureDiagnosticDoesNotInventTimings() {
        var s=ObjectRuntimeStatistics();s.failure(.unsupportedOutput);let d=s.snapshot(busyDrops:0,retrySkips:0)
        XCTAssertEqual(d.phase,"blocked");XCTAssertEqual(d.failureCount,1);XCTAssertEqual(d.work.sampleCount,0)
    }
    func testSchedulingIsBoundedByThermalAndObservedWork() {
        XCTAssertEqual(ObjectRuntimeStatistics.detectionInterval(thermalLimited:false,p95WorkMs:nil),0.2)
        XCTAssertEqual(ObjectRuntimeStatistics.detectionInterval(thermalLimited:true,p95WorkMs:20),0.4)
        XCTAssertEqual(ObjectRuntimeStatistics.detectionInterval(thermalLimited:false,p95WorkMs:200),0.4)
        XCTAssertEqual(ObjectRuntimeStatistics.detectionInterval(thermalLimited:false,p95WorkMs:100_000),1)
    }
}
