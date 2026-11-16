import Foundation

public enum SceneQuestion: CaseIterable {
    case overview, peopleRight, changes

    public var title: String {
        switch self {
        case .overview: return "Trong khung hình có gì?"
        case .peopleRight: return "Bên phải có mấy người?"
        case .changes: return "Vừa có gì thay đổi?"
        }
    }
}

/// Bounded in-memory view of detector observations, not a world model.
/// All clocks belong to the same camera session. The caller resets on source,
/// orientation, interruption, or tracker generation changes.
public struct SceneNarration {
    public static let unavailable = "Chưa đủ dữ liệu mới để mô tả khung hình."
    private static let frameMaxAgeMs = 300.0
    private static let classMaxAgeMs = 3_000.0
    private static let maxTracks = 12
    private static let maxHistory = 48
    private static let historyMs = 3_000.0
    private static let sessionWarmupMs = 400.0
    private static let continuityMs = 600.0
    private static let confirmationMs = 80.0
    private static let changeMaxAgeMs = 1_600.0

    private struct Visible {
        let track: ObjectTrack
        let label: String
        let box: Rect
        var horizontalCenter: Double { box.x + box.width / 2 }
    }
    private struct History {
        let label: String
        let firstSeenMs: Double
        var lastSeenMs: Double
        var continuous: Bool
        let candidate: Bool
    }

    private var latest: [Visible] = []
    private var history: [Int: History] = [:]
    private var latestMs: Double?
    private var epochStartMs: Double?

    public init() {}
    public mutating func reset() { self = SceneNarration() }

    public mutating func observe(tracks: [ObjectTrack], transform: Affine, nowMs: Double) {
        guard nowMs.isFinite, nowMs >= 0, (try? transform.inverse()) != nil else {
            reset()
            return
        }
        if let previous = latestMs {
            if nowMs < previous || nowMs - previous > Self.continuityMs { reset() }
            if nowMs == previous { return }
        }
        let raw = tracks.prefix(Self.maxTracks)
        // Reject repeated IDs as ambiguous, rather than counting whichever
        // observation happened to be first. Unknown labels are not narrated.
        let duplicates = Dictionary(grouping: raw, by: \.id)
        let visible = raw.compactMap { track -> Visible? in
            guard track.id > 0, duplicates[track.id]?.count == 1, Self.fresh(track, at: nowMs),
                  let box = ObjectBoxGeometry.displayBox(track.box, transform: transform) else { return nil }
            let label = ObjectLabels.canonical(track.label)
            guard ObjectLabels.translations[label] != nil else { return nil }
            return Visible(track: track, label: label, box: box)
        }.sorted {
            $0.track.score == $1.track.score ? $0.track.id < $1.track.id : $0.track.score > $1.track.score
        }
        // A conservative lower bound: don't speak two indistinguishable
        // same-class boxes at almost the same location as two instances.
        latest = []
        for value in visible where !latest.contains(where: {
            $0.label == value.label && ObjectBoxGeometry.intersectionOverUnion($0.box, value.box) > 0.80
        }) {
            latest.append(value)
        }
        if epochStartMs == nil { epochStartMs = nowMs }
        latestMs = nowMs
        history = history.filter { nowMs - $0.value.lastSeenMs <= Self.historyMs }
        if history.count + latest.filter({ history[$0.track.id] == nil }).count > Self.maxHistory {
            // Excessive ID churn is not evidence of real changes.
            history.removeAll(keepingCapacity: true)
            epochStartMs = nowMs
        }
        let visibleIDs = Set(latest.map { $0.track.id })
        for id in Array(history.keys) where !visibleIDs.contains(id) { history[id]?.continuous = false }
        for value in latest {
            let track = value.track
            if var old = history[track.id] {
                if old.label != value.label { old.continuous = false }
                old.lastSeenMs = max(old.lastSeenMs, track.lastSeenMs)
                history[track.id] = old
            } else {
                let warmupComplete = epochStartMs.map { track.lastSeenMs - $0 >= Self.sessionWarmupMs } ?? false
                // If the current result contains an older propagated box, it
                // is not a newly detected ID at this camera time.
                let hasDetection = abs(track.lastDetectedAtMs - track.lastSeenMs) < 0.001
                history[track.id] = History(label: value.label, firstSeenMs: track.lastSeenMs,
                                            lastSeenMs: track.lastSeenMs, continuous: true,
                                            candidate: warmupComplete && hasDetection)
            }
        }
    }

    public func answer(_ question: SceneQuestion, nowMs: Double) -> String {
        guard let latestMs, nowMs.isFinite, nowMs >= latestMs,
              nowMs - latestMs <= Self.frameMaxAgeMs else { return Self.unavailable }
        let current = latest.filter { Self.fresh($0.track, at: nowMs) }
        switch question {
        case .overview:
            return overview(current, at: nowMs)
        case .peopleRight:
            // The center band is intentionally not assigned to either side.
            let right = current.filter { $0.label == "person" && $0.horizontalCenter >= 0.56 }.count
            if right > 0 { return "Nhận diện được ít nhất \(right) người ở bên phải khung hình." }
            if current.contains(where: { $0.label == "person" && $0.horizontalCenter > 0.44 }) {
                return "Có người gần giữa khung hình; chưa xác định được số người bên phải."
            }
            return "Chưa nhận diện được người ở bên phải khung hình."
        case .changes:
            guard let epochStartMs, latestMs - epochStartMs >= Self.sessionWarmupMs else {
                return "Chưa đủ khung hình để so sánh thay đổi."
            }
            let new = current.filter {
                guard let past = history[$0.track.id], past.candidate, past.continuous,
                      past.label == $0.label else { return false }
                return past.lastSeenMs - past.firstSeenMs >= Self.confirmationMs
                    && nowMs - past.firstSeenMs <= Self.changeMaxAgeMs
            }
            let labels = Self.summary(new)
            return labels.isEmpty ? "Chưa xác nhận được thay đổi mới trong khung hình."
                : "Trong khung hình vừa nhận diện thêm \(labels.joined(separator: ", "))."
        }
    }

    private static func fresh(_ track: ObjectTrack, at nowMs: Double) -> Bool {
        !track.isCoasting && track.score.isFinite && track.score > 0 && track.score <= 1
            && track.lastSeenMs.isFinite && track.lastDetectedAtMs.isFinite
            && track.lastDetectedAtMs >= 0 && track.lastSeenMs >= track.lastDetectedAtMs
            && nowMs >= track.lastSeenMs && nowMs - track.lastSeenMs <= frameMaxAgeMs
            && nowMs - track.lastDetectedAtMs <= classMaxAgeMs
    }

    private static func groups(_ visible: [Visible]) -> [String] {
        var seen: Set<String> = ["person"]
        var labels = visible.contains(where: { $0.label == "person" }) ? ["person"] : []
        for value in visible where seen.insert(value.label).inserted { labels.append(value.label) }
        return Array(labels.prefix(3))
    }

    private static func summary(_ visible: [Visible], groups: [String]? = nil) -> [String] {
        (groups ?? Self.groups(visible)).map { label in
            let count = visible.filter { $0.label == label }.count
            let name = ObjectLabels.vietnamese(label).lowercased()
            if label == "person" { return "ít nhất \(count) người" }
            let classifier = vehicleLabels.contains(label) ? "chiếc " : ""
            if count > 1 { return "ít nhất \(count) \(classifier)\(name)" }
            return classifier.isEmpty ? name : "một \(classifier)\(name)"
        }
    }

    private static let vehicleLabels: Set<String> = ["car", "motorcycle", "bicycle", "truck", "bus", "airplane", "train", "boat"]

    private func overview(_ current: [Visible], at nowMs: Double) -> String {
        let groups = Self.groups(current)
        let labels = Self.summary(current, groups: groups)
        guard !labels.isEmpty else { return "Chưa nhận diện được đối tượng rõ ràng trong khung hình." }
        let text = "Trong khung hình nhận diện được \(labels.joined(separator: ", "))."
        let measured = current.compactMap { value -> (Visible, Double)? in
            guard groups.contains(value.label) else { return nil }
            // Use the shipping depth gate unchanged; no cached value and no
            // guessed metres, even when the RGB track remains usable.
            return ObjectDisplayMetric.currentMetres(value.track, nowMs: nowMs).map { (value, $0) }
        }
        guard let closest = measured.min(by: { $0.1 < $1.1 }) else { return text }
        let metres = String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), closest.1)
            .replacingOccurrences(of: ".", with: ",")
        let label = ObjectLabels.vietnamese(closest.0.label).lowercased()
        return "\(text) Camera cách bề mặt của \(label) khoảng \(metres) mét."
    }
}
