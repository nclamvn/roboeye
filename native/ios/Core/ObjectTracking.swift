import Foundation

// Object boxes are raw-image NORMALIZED top-left coordinates. Depth supports
// use RGB PIXELS. UIKit may smooth its presentation, never these sampling boxes.
public struct ObjectDetection {
    public var label: String
    public var score: Double
    public var box: Rect
    public init(label: String, score: Double, box: Rect) { self.label=label; self.score=score; self.box=box }
}

public struct ObjectTrack {
    public let id: Int
    public var label: String
    public var score: Double
    public var box: Rect
    public var lastSeenMs: Double
    public var lastDetectedAtMs: Double
    public var range: ProbeResult
    public var rangeCapturedAtMs: Double?
    public var isCoasting: Bool
    public var vietnameseLabel: String { ObjectLabels.vietnamese(label) }
}

public enum ObjectBoxGeometry {
    public static func clipped(_ r: Rect) -> Rect? {
        guard [r.x,r.y,r.width,r.height].allSatisfy(\.isFinite), r.width>0, r.height>0 else { return nil }
        let x=max(0,r.x), y=max(0,r.y), right=min(1,r.x+r.width), bottom=min(1,r.y+r.height)
        guard right-x>1e-6, bottom-y>1e-6 else { return nil }
        return Rect(x:x,y:y,width:right-x,height:bottom-y)
    }
    private static func corners(_ r: Rect) -> [Point] {
        [Point(r.x,r.y),Point(r.x+r.width,r.y),Point(r.x,r.y+r.height),Point(r.x+r.width,r.y+r.height)]
    }
    private static func envelope(_ points: [Point]) -> Rect? {
        guard points.count==4,points.allSatisfy({$0.x.isFinite && $0.y.isFinite}) else { return nil }
        let xs=points.map(\.x),ys=points.map(\.y)
        return clipped(Rect(x:xs.min()!,y:ys.min()!,width:xs.max()!-xs.min()!,height:ys.max()!-ys.min()!))
    }
    public static func rawNormalizedBox(fromVision r: Rect, rotation: Int=0) -> Rect? {
        guard [0,90,180,270].contains(rotation),let upright=clipped(Rect(x:r.x,y:1-r.y-r.height,width:r.width,height:r.height)) else { return nil }
        let presentation=Presentation(crop:Rect(x:0,y:0,width:1,height:1),rotation:rotation)
        return envelope(corners(upright).map {ProbeGeometry.fromDisplay($0,presentation)})
    }
    public static func visionBox(fromRaw r: Rect, rotation: Int=0) -> Rect? {
        guard [0,90,180,270].contains(rotation),let raw=clipped(r) else { return nil }
        let presentation=Presentation(crop:Rect(x:0,y:0,width:1,height:1),rotation:rotation)
        guard let upright=envelope(corners(raw).map {ProbeGeometry.toDisplay($0,presentation)}) else { return nil }
        return clipped(Rect(x:upright.x,y:1-upright.y-upright.height,width:upright.width,height:upright.height))
    }
    public static func pixelBox(_ r: Rect, imageWidth: Int, imageHeight: Int) -> Rect? {
        guard imageWidth>1,imageHeight>1,let r=clipped(r) else { return nil }
        return Rect(x:r.x*Double(imageWidth),y:r.y*Double(imageHeight),width:r.width*Double(imageWidth),height:r.height*Double(imageHeight))
    }
    public static func displayBox(_ r: Rect, transform: Affine) -> Rect? {
        guard let r=clipped(r), (try? transform.inverse()) != nil else { return nil }
        return envelope(corners(r).map(transform.apply))
    }
    public static func intersectionOverUnion(_ a: Rect, _ b: Rect) -> Double {
        let w=max(0,min(a.x+a.width,b.x+b.width)-max(a.x,b.x)),h=max(0,min(a.y+a.height,b.y+b.height)-max(a.y,b.y))
        let intersection=w*h,union=a.width*a.height+b.width*b.height-intersection
        return union>0 ? intersection/union : 0
    }
}

// Bounded, class-aware association, not re-identification or physical identity.
// A moving same-class overlap may be ambiguous: create a fresh ID, never carry a
// previous object's metres across that association. Detector TTL is distinct
// from intermediate Vision updates so an unverified tracker cannot live forever.
public struct ObjectTracker {
    private var tracks: [ObjectTrack]=[]
    private var nextID=1
    private var lastUpdateMs: Double = -1
    public let maxTracks: Int
    public let coastMs: Double
    public let maxDetectionGapMs: Double
    public init(maxTracks: Int=12, coastMs: Double=600, maxDetectionGapMs: Double=3000) {
        self.maxTracks=min(12,max(1,maxTracks))
        self.coastMs=coastMs.isFinite ? min(1000,max(0,coastMs)) : 600
        self.maxDetectionGapMs=maxDetectionGapMs.isFinite ? min(5000,max(300,maxDetectionGapMs)) : 3000
    }
    public mutating func reset() { tracks=[]; nextID=1; lastUpdateMs = -1 }
    private let duplicateOverlap=0.75
    private func contradictoryHandheldLabels(_ a: String,_ b: String) -> Bool {
        // Only the observed phone/remote confusion pair. Person/phone, book/phone
        // and other real nested objects must never become broad cross-class NMS.
        (a=="cell phone" && b=="remote") || (a=="remote" && b=="cell phone")
    }
    private func fresh(_ t: ObjectTrack,_ now: Double) -> Bool {
        now>=t.lastSeenMs && now-t.lastSeenMs<=coastMs && now-t.lastDetectedAtMs<=maxDetectionGapMs
    }
    private func score(_ old: Rect,_ new: Rect) -> Double? {
        let ratio=(new.width*new.height)/(old.width*old.height)
        guard ratio>=0.25,ratio<=4 else { return nil }
        let iou=ObjectBoxGeometry.intersectionOverUnion(old,new)
        let distance=hypot(old.x+old.width/2-new.x-new.width/2,old.y+old.height/2-new.y-new.height/2)
        let scale=max(hypot(old.width,old.height),hypot(new.width,new.height))
        guard iou>=0.12 || distance<=scale*0.45 else { return nil }
        return iou*0.8+max(0,1-distance/max(scale,1e-6))*0.2
    }
    private struct Association {
        var rows: [Int?]
        var count: Int
        var quality: Double
    }
    // Hungarian assignment over <=24 rows/columns (12 detections,12 tracks plus
    // unmatched dummy nodes). Each real edge has a cardinality bonus larger
    // than ALL possible quality differences, then its geometric quality. This
    // avoids confidence-order greed consuming another detection's only match.
    private func associate(_ scores: [[Double?]], oldCount: Int, excluding: (Int,Int)?=nil) -> Association {
        let rows=scores.count,size=rows+oldCount
        guard rows>0,size>0 else {return Association(rows:Array(repeating:nil,count:rows),count:0,quality:0)}
        var cost=Array(repeating:Array(repeating:0.0,count:size),count:size)
        for row in 0..<rows {for column in 0..<oldCount {
            if let score=scores[row][column],excluding?.0 != row || excluding?.1 != column {cost[row][column] = -100-score}
            else {cost[row][column]=10_000}
        }}
        var u=Array(repeating:0.0,count:size+1),v=u,p=Array(repeating:0,count:size+1),way=p
        for row in 1...size {
            p[0]=row
            var column0=0,minima=Array(repeating:Double.infinity,count:size+1),used=Array(repeating:false,count:size+1)
            repeat {
                used[column0]=true
                let row0=p[column0]
                var delta=Double.infinity,column1=0
                for column in 1...size where !used[column] {
                    let candidate=cost[row0-1][column-1]-u[row0]-v[column]
                    if candidate<minima[column] {minima[column]=candidate;way[column]=column0}
                    if minima[column]<delta {delta=minima[column];column1=column}
                }
                for column in 0...size {
                    if used[column] {u[p[column]]+=delta;v[column]-=delta}
                    else {minima[column]-=delta}
                }
                column0=column1
            } while p[column0] != 0
            repeat {
                let previous=way[column0];p[column0]=p[previous];column0=previous
            } while column0 != 0
        }
        var result=Association(rows:Array(repeating:nil,count:rows),count:0,quality:0)
        for column in 1...size {
            let row=p[column]-1,index=column-1
            guard row>=0,row<rows,index<oldCount,let score=scores[row][index],excluding?.0 != row || excluding?.1 != index else {continue}
            result.rows[row]=index;result.count+=1;result.quality+=score
        }
        return result
    }
    public mutating func update(_ observations: [ObjectDetection], atMs: Double) -> [ObjectTrack] {
        guard atMs.isFinite,atMs>=0,atMs>=lastUpdateMs else { return snapshot(nowMs:atMs) }
        lastUpdateMs=atMs; tracks=tracks.filter {fresh($0,atMs)}
        let candidates=observations.prefix(128).compactMap {observation -> ObjectDetection? in
            guard observation.score.isFinite,observation.score>=0.2,observation.score<=1,let box=ObjectBoxGeometry.clipped(observation.box) else { return nil }
            let label=ObjectLabels.canonical(observation.label)
            guard !label.isEmpty else {return nil}
            return ObjectDetection(label:label,score:observation.score,box:box)
        }.sorted {a,b in
            if a.score != b.score {return a.score>b.score}
            // A general, reproducible tie order, not a phone-name preference.
            // Stronger raw confidence always wins before any tie comparison.
            if a.label != b.label {return a.label<b.label}
            // Preserve existing equal-score same-class observation order. IDs
            // are associated by raw geometry, not reordered for this pair fix.
            return false
        }
        var accepted:[ObjectDetection]=[]
        for observation in candidates {
            let label=observation.label,box=observation.box
            // Duplicate detector rows are not independent objects.
            // A high-overlap phone/remote pair is competing evidence, not proof
            // that the stronger hypothesis is semantically correct.
            if accepted.contains(where:{($0.label==label || contradictoryHandheldLabels($0.label,label)) && ObjectBoxGeometry.intersectionOverUnion($0.box,box)>duplicateOverlap}) { continue }
            accepted.append(ObjectDetection(label:label,score:observation.score,box:box))
            if accepted.count==maxTracks { break }
        }
        let scores=accepted.map {observation in tracks.map {track -> Double? in
            track.label==observation.label ? score(track.box,observation.box):nil
        }}
        let best=associate(scores,oldCount:tracks.count)
        var ambiguous=Set<Int>(),retired=Set<Int>(),used=Set<Int>(),current:[ObjectTrack]=[]
        for row in accepted.indices {
            guard let column=best.rows[row] else {continue}
            let alternative=associate(scores,oldCount:tracks.count,excluding:(row,column))
            if alternative.count==best.count,best.quality-alternative.quality<0.05 {
                for changed in accepted.indices where alternative.rows[changed] != best.rows[changed] {ambiguous.insert(changed)}
            }
        }
        // Ambiguity creates fresh identities and RETIRES compatible old rows,
        // not three stacked ghost boxes for one observed subject. This is still
        // geometric association, not person re-identification or identity proof.
        for row in ambiguous {for column in tracks.indices where scores[row][column] != nil {retired.insert(column)}}
        for row in accepted.indices {
            let observation=accepted[row]
            if let column=best.rows[row],!ambiguous.contains(row) {
                used.insert(column)
                var t=tracks[column]
                t.box=observation.box;t.score=observation.score;t.lastSeenMs=atMs;t.lastDetectedAtMs=atMs;t.isCoasting=false
                t.range=ProbeResult(reason:"awaiting-current-depth");t.rangeCapturedAtMs=nil
                current.append(t)
            } else {
                current.append(ObjectTrack(id:nextID,label:observation.label,score:observation.score,box:observation.box,lastSeenMs:atMs,lastDetectedAtMs:atMs,range:ProbeResult(reason:"awaiting-current-depth"),rangeCapturedAtMs:nil,isCoasting:false))
                nextID+=1
            }
        }
        for index in tracks.indices where !used.contains(index) {
            // Retire only an obsolete contradictory coast at essentially the
            // same geometry. The replacement keeps its NEW identity and must
            // wait for its own same-frame depth; no label or metres are borrowed.
            if current.contains(where:{contradictoryHandheldLabels($0.label,tracks[index].label) && ObjectBoxGeometry.intersectionOverUnion($0.box,tracks[index].box)>duplicateOverlap}) {retired.insert(index)}
        }
        for index in tracks.indices where !used.contains(index) && !retired.contains(index) && current.count<maxTracks {
            var t=tracks[index];t.isCoasting=true;t.range=ProbeResult(reason:"tracking-lost");t.rangeCapturedAtMs=nil;current.append(t)
        }
        tracks=current; return snapshot(nowMs:atMs)
    }
    public mutating func updateTrackedBoxes(_ boxes: [Int:Rect], atMs: Double) -> [ObjectTrack] {
        guard atMs.isFinite,atMs>=0,atMs>=lastUpdateMs else { return snapshot(nowMs:atMs) }
        lastUpdateMs=atMs;tracks=tracks.filter { fresh($0,atMs) }
        for index in tracks.indices {
            if let box=boxes[tracks[index].id].flatMap(ObjectBoxGeometry.clipped) {
                tracks[index].box=box;tracks[index].lastSeenMs=atMs;tracks[index].isCoasting=false
                tracks[index].range=ProbeResult(reason:"awaiting-current-depth")
            } else {
                tracks[index].isCoasting=true;tracks[index].range=ProbeResult(reason:"tracking-lost")
            }
            tracks[index].rangeCapturedAtMs=nil
        }
        return snapshot(nowMs:atMs)
    }
    public mutating func setRanges(_ ranges: [Int:ProbeResult], capturedAtMs: Double, nowMs: Double) -> [ObjectTrack] {
        guard capturedAtMs.isFinite,nowMs.isFinite,nowMs>=capturedAtMs,capturedAtMs>=lastUpdateMs,nowMs-capturedAtMs<=300 else { return snapshot(nowMs:nowMs) }
        for index in tracks.indices {
            // The range must belong to exactly the box/frame just updated. Never
            // accept a late worker result for an already advanced track.
            guard !tracks[index].isCoasting,abs(tracks[index].lastSeenMs-capturedAtMs)<0.001 else { continue }
            let proposed=ranges[tracks[index].id] ?? ProbeResult(reason:"no-depth")
            if let m=proposed.metres, m.isFinite,m>=0.5,m<=5,proposed.supportCount>=9 {
                tracks[index].range=ProbeResult(metres:m,reason:proposed.reason,ageMs:nowMs-capturedAtMs,supportCount:proposed.supportCount)
                tracks[index].rangeCapturedAtMs=capturedAtMs
            } else {
                tracks[index].range=ProbeResult(reason:proposed.metres == nil ? proposed.reason : "invalid-range",ageMs:nowMs-capturedAtMs,supportCount:proposed.supportCount)
                tracks[index].rangeCapturedAtMs=nil
            }
        }
        return snapshot(nowMs:nowMs)
    }
    public func snapshot(nowMs: Double) -> [ObjectTrack] {
        guard nowMs.isFinite,nowMs>=0 else { return [] }
        return tracks.filter {fresh($0,nowMs)}.map { source in
            var t=source
            if let captured=t.rangeCapturedAtMs {
                let age=nowMs-captured
                if age<0 || age>300 { t.range=ProbeResult(reason:"stale",ageMs:age);t.rangeCapturedAtMs=nil }
                else { t.range.ageMs=age }
            }
            return t
        }
    }
}

public enum ObjectRangeEstimator {
    public static let sampleLimit=256
    public static let interiorMargin=0.18
    public static func evaluate(box: Rect, samples: [SupportSample], calibration: Calibration?, rgbWidth: Int, rgbHeight: Int,
        rgbCapturedAtMs: Double, depthCapturedAtMs: Double?, nowMs: Double,
        trackingNormal: Bool=true, sameFrame: Bool=true, label: String="") -> ProbeResult {
        let age=depthCapturedAtMs.map { nowMs-$0 }
        func refuse(_ reason: String,_ count: Int=0) -> ProbeResult { ProbeResult(reason:reason,ageMs:age,supportCount:count) }
        guard trackingNormal else { return refuse("tracking-limited") }
        guard nowMs.isFinite,rgbCapturedAtMs.isFinite,nowMs>=rgbCapturedAtMs else { return refuse("clock-future") }
        guard let depthTime=depthCapturedAtMs,depthTime.isFinite else { return refuse("no-depth") }
        guard nowMs>=depthTime else { return refuse("clock-future") }
        guard nowMs-depthTime<=300,nowMs-rgbCapturedAtMs<=300 else { return refuse("stale") }
        guard sameFrame,abs(rgbCapturedAtMs-depthTime)<=1 else { return refuse("rgb-depth-skew") }
        guard let k=calibration,[k.fx,k.fy,k.cx,k.cy].allSatisfy(\.isFinite),k.fx>0,k.fy>0 else { return refuse("no-intrinsics") }
        guard let pixels=ObjectBoxGeometry.pixelBox(box,imageWidth:rgbWidth,imageHeight:rgbHeight) else { return refuse("invalid-box") }
        // A glass silhouette is not evidence that the depth belongs to glass.
        if ObjectLabels.canonical(label)=="wine glass" { return refuse("transparent-surface") }
        let inner=Rect(x:pixels.x+pixels.width*interiorMargin,y:pixels.y+pixels.height*interiorMargin,width:pixels.width*(1-2*interiorMargin),height:pixels.height*(1-2*interiorMargin))
        guard inner.width>=2,inner.height>=2 else { return refuse("low-support") }
        var unique=Set<String>(),support:[SupportSample]=[]
        for s in samples.prefix(sampleLimit) {
            guard [s.u,s.v,s.value,s.confidence].allSatisfy(\.isFinite),s.confidence>=0.5,s.confidence<=1,
                s.value>0,s.value<=100,s.u>=0,s.v>=0,s.u<=Double(rgbWidth-1),s.v<=Double(rgbHeight-1),
                s.u>=inner.x,s.u<=inner.x+inner.width,s.v>=inner.y,s.v<=inner.y+inner.height else { continue }
            guard unique.insert("\(s.u)/\(s.v)").inserted else { continue }
            support.append(s)
        }
        guard support.count>=9 else { return refuse("low-support",support.count) }
        // Cluster OPTICAL Z before ray conversion; oblique planes naturally have
        // different camera-to-point ray lengths across a single coherent object.
        let sorted=support.sorted {$0.value<$1.value}
        var clusters:[[SupportSample]]=[]
        for s in sorted {
            if var last=clusters.last,let anchor=last.first,abs(s.value-anchor.value)<=max(0.10,anchor.value*0.08) {
                last.append(s);clusters[clusters.count-1]=last
            } else { clusters.append([s]) }
        }
        // Select the nearest spatially credible cohort, not a background-majority
        // peak. A small foreground competing with a dominant wall must be unknown.
        let candidates=clusters.filter {$0.count>=max(3,Int(ceil(Double(support.count)*0.10)))}
        guard let cohort=candidates.first else { return refuse("ambiguous-support",support.count) }
        let fraction=Double(cohort.count)/Double(support.count),high=cohort.filter {$0.confidence>=0.7}.count
        let mediumOnly=high<9,required=mediumOnly ? 16 : 9
        guard cohort.count>=required else { return refuse("low-support",cohort.count) }
        guard fraction >= (mediumOnly ? 0.80 : 0.70) else { return refuse("ambiguous-support",cohort.count) }
        let competing=candidates.dropFirst().contains {Double($0.count)>=Double(cohort.count)*0.4}
        guard !competing else { return refuse("ambiguous-support",cohort.count) }
        let xs=cohort.map(\.u),ys=cohort.map(\.v)
        let cells=Set(cohort.map { s in
            let x=min(2,max(0,Int((s.u-inner.x)/inner.width*3))),y=min(2,max(0,Int((s.v-inner.y)/inner.height*3)))
            return y*3+x
        })
        guard xs.max()!-xs.min()!>=inner.width*0.35,ys.max()!-ys.min()!>=inner.height*0.35,cells.contains(4),cells.count >= (mediumOnly ? 6 : 4) else { return refuse("low-spatial-support",cohort.count) }
        let values=cohort.map {ProbeGeometry.range($0,k)}.sorted(),median=values[values.count/2]
        guard median.isFinite,median>=0.5,median<=5 else { return refuse("outside-domain",cohort.count) }
        // Approximate supported surface INSIDE a box. A bounding box is not a
        // segmentation mask and cannot prove semantic foreground or clearance.
        return ProbeResult(metres:median,reason:"approximate-interior-supported",ageMs:age,supportCount:cohort.count)
    }
}

public enum ObjectLabels {
    public static func canonical(_ raw: String) -> String {
        let label=raw.trimmingCharacters(in:.whitespacesAndNewlines).lowercased().replacingOccurrences(of:"_",with:" ")
        let aliases=["motorbike":"motorcycle","aeroplane":"airplane","sofa":"couch","pottedplant":"potted plant","diningtable":"dining table","tvmonitor":"tv","cellphone":"cell phone","mobile phone":"cell phone","hair dryer":"hair drier"]
        return aliases[label] ?? label
    }
    public static func vietnamese(_ raw: String) -> String { translations[canonical(raw)] ?? raw }
    public static let translations: [String:String] = [
        "person":"Người","bicycle":"Xe đạp","car":"Ô tô","motorcycle":"Xe máy","airplane":"Máy bay","bus":"Xe buýt","train":"Tàu hoả","truck":"Xe tải","boat":"Thuyền",
        "traffic light":"Đèn giao thông","fire hydrant":"Trụ cứu hoả","stop sign":"Biển dừng","parking meter":"Đồng hồ đỗ xe","bench":"Ghế dài","bird":"Chim","cat":"Mèo","dog":"Chó","horse":"Ngựa","sheep":"Cừu","cow":"Bò","elephant":"Voi","bear":"Gấu","zebra":"Ngựa vằn","giraffe":"Hươu cao cổ",
        "backpack":"Ba lô","umbrella":"Ô","handbag":"Túi xách","tie":"Cà vạt","suitcase":"Vali","frisbee":"Đĩa ném","skis":"Ván trượt tuyết","snowboard":"Ván tuyết","sports ball":"Bóng","kite":"Diều","baseball bat":"Gậy bóng chày","baseball glove":"Găng bóng chày","skateboard":"Ván trượt","surfboard":"Ván lướt sóng","tennis racket":"Vợt tennis",
        "bottle":"Chai","wine glass":"Ly rượu","cup":"Cốc","fork":"Nĩa","knife":"Dao","spoon":"Thìa","bowl":"Bát","banana":"Chuối","apple":"Táo","sandwich":"Bánh sandwich","orange":"Cam","broccoli":"Súp lơ xanh","carrot":"Cà rốt","hot dog":"Bánh hot dog","pizza":"Pizza","donut":"Bánh vòng","cake":"Bánh ngọt",
        "chair":"Ghế","couch":"Sofa","potted plant":"Cây cảnh","bed":"Giường","dining table":"Bàn ăn","toilet":"Bồn cầu","tv":"Tivi","laptop":"Máy tính xách tay","mouse":"Chuột máy tính","remote":"Điều khiển","keyboard":"Bàn phím","cell phone":"Điện thoại","microwave":"Lò vi sóng","oven":"Lò nướng","toaster":"Máy nướng bánh","sink":"Bồn rửa","refrigerator":"Tủ lạnh","book":"Sách","clock":"Đồng hồ","vase":"Bình hoa","scissors":"Kéo","teddy bear":"Gấu bông","hair drier":"Máy sấy tóc","toothbrush":"Bàn chải"
    ]
}

// The live COCO80 detector and64-support-per-object estimator are richer than
// the closed v1 interchange contract. Projection is diagnostic-only: NEVER feed
// its downsampled supports back into live ranging, or widen v1's vocabulary.
public struct ObjectRecordingInput {
    public let id: Int
    public let label: String
    public let score: Double
    public let box: Rect
    public let samples: [SupportSample]
    public init(id: Int,label: String,score: Double,box: Rect,samples: [SupportSample]) {
        self.id=id;self.label=label;self.score=score;self.box=box;self.samples=samples
    }
}
public struct ObjectRecordingProjection {
    public let samples: [SupportSample]
    public let targets: [SurfaceTarget]
}
public enum ObjectExportProjection {
    public static let sampleLimit=128
    public static func recordingLabel(_ label: String) -> String {
        let label=ObjectLabels.canonical(label)
        switch label {
        case "person","chair","bottle","phone","book","wall","vehicle","unknown": return label
        case "cell phone": return "phone"
        case "car","truck","bus","motorcycle","bicycle","train","boat","airplane": return "vehicle"
        default: return "unknown"
        }
    }
    public static func project(_ inputs: [ObjectRecordingInput],imageWidth: Int,imageHeight: Int) -> ObjectRecordingProjection {
        guard imageWidth>1,imageHeight>1 else {return ObjectRecordingProjection(samples:[],targets:[])}
        var identities=Set<Int>()
        let valid=inputs.prefix(12).compactMap {input -> (ObjectRecordingInput,Rect)? in
            guard input.id>0,input.score.isFinite,input.score>=0,input.score<=1,
                  let rawPixels=ObjectBoxGeometry.pixelBox(input.box,imageWidth:imageWidth,imageHeight:imageHeight) else {return nil}
            let pixels=Rect(x:rawPixels.x,y:rawPixels.y,width:min(rawPixels.width,Double(imageWidth)-rawPixels.x),height:min(rawPixels.height,Double(imageHeight)-rawPixels.y))
            // v1 minimum sizes are PIXELS, not normalized image fractions. Clamp
            // floating-point edges before serialization, never emit a tiny sliver
            // that cannot pass the closed contract's .001-pixel rectangle bound.
            guard pixels.width>=0.001,pixels.height>=0.001,identities.insert(input.id).inserted else {return nil}
            return (input,pixels)
        }
        let quota=sampleLimit/max(1,valid.count)
        var samples:[SupportSample]=[],targets:[SurfaceTarget]=[]
        for (input,box) in valid {
            let eligible=input.samples.prefix(ObjectRangeEstimator.sampleLimit).filter {s in
                [s.u,s.v,s.value,s.confidence].allSatisfy(\.isFinite) && s.u>=0 && s.u<=Double(imageWidth-1) && s.v>=0 && s.v<=Double(imageHeight-1) && s.value>=0.000001 && s.value<=100 && s.confidence>=0 && s.confidence<=1 && s.u>=box.x && s.u<=box.x+box.width && s.v>=box.y && s.v<=box.y+box.height
            }
            let retained=min(quota,eligible.count),offset=samples.count
            // Endpoint-preserving deterministic uniform indices, rather than
            // retaining only the top rows of an8×8 spatial grid.
            samples.append(contentsOf:(0..<retained).map {i in eligible[retained<=1 ? 0:Int(Double(i)*Double(eligible.count-1)/Double(retained-1))]})
            var target=SurfaceTarget(id:"object-\(input.id)",box:box,associated:false,sampleIndices:Array(offset..<samples.count))
            target.label=recordingLabel(input.label);target.score=input.score;targets.append(target)
        }
        return ObjectRecordingProjection(samples:samples,targets:targets)
    }
}
