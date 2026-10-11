import Foundation

// Only DISPLAY normalized coordinates enter this state. There is deliberately
// no depth, range, calibration, raw object association or recording API here.
public struct ObjectPresentationInput {
    public let id: Int
    public let box: Rect
    public let capturedAtMs: Double
    public let isCoasting: Bool
    public init(id: Int,box: Rect,capturedAtMs: Double,isCoasting: Bool=false) {
        self.id=id;self.box=box;self.capturedAtMs=capturedAtMs;self.isCoasting=isCoasting
    }
}
public struct ObjectPresentationState {
    private struct Filter {
        var raw: [Double]
        var value: [Double]
        var derivative: [Double]
        var capturedAtMs: Double
        var output: Rect
    }
    private var filters: [Int:Filter]=[:]
    private var previousNowMs: Double?
    public let maxTracks: Int
    // 1€ filter equations, implemented here in normalized-display units. Fixed
    // reproducible defaults: minCutoff2Hz,beta4,dCutoff1Hz. Speed raises cutoff;
    // clamp maximum visual deviation and snap after an evidence discontinuity.
    public init(maxTracks: Int=12) {self.maxTracks=min(12,max(1,maxTracks))}
    public mutating func reset() {filters=[:];previousNowMs=nil}
    private func alpha(_ cutoff: Double,_ seconds: Double) -> Double {
        1/(1+1/(2*Double.pi*cutoff*seconds))
    }
    private func components(_ box: Rect) -> [Double] { [box.x+box.width/2,box.y+box.height/2,box.width,box.height] }
    public mutating func update(_ inputs: [ObjectPresentationInput],nowMs: Double,reducedMotion: Bool=false) -> [Int:Rect] {
        guard nowMs.isFinite,nowMs>=0 else {reset();return [:]}
        if let previousNowMs,nowMs<previousNowMs {reset()}
        previousNowMs=nowMs
        var output:[Int:Rect]=[:],present=Set<Int>()
        for input in inputs.prefix(maxTracks) {
            guard input.id>0,present.insert(input.id).inserted else {continue}
            guard input.capturedAtMs.isFinite,input.capturedAtMs>=0,input.capturedAtMs<=nowMs,nowMs-input.capturedAtMs<=600,
                  let box=ObjectBoxGeometry.clipped(input.box) else {filters.removeValue(forKey:input.id);continue}
            let raw=components(box),old=filters[input.id]
            var snap=reducedMotion || input.isCoasting || old == nil
            if let old {
                let gap=input.capturedAtMs-old.capturedAtMs
                // Repeated evidence is identical for filtering purposes even if
                // a caller passes a newly allocated rectangle for that snapshot.
                if gap==0,!reducedMotion,!input.isCoasting {output[input.id]=old.output;continue}
                let jump=hypot(raw[0]-old.raw[0],raw[1]-old.raw[1])
                let ratios=[raw[2]/old.raw[2],raw[3]/old.raw[3]]
                snap = snap || gap<0 || gap>300 || jump>=0.18 || ratios.contains {$0<0.5 || $0>2}
                // A heartbeat may redraw a fresh old snapshot, but is NOT a new
                // observation. It must not integrate smoothing/velocity again.
            }
            if snap {
                filters[input.id]=Filter(raw:raw,value:raw,derivative:[0,0,0,0],capturedAtMs:input.capturedAtMs,output:box)
                output[input.id]=box;continue
            }
            var next=old!
            let dt=(input.capturedAtMs-next.capturedAtMs)/1000,derivativeAlpha=alpha(1,dt)
            let deviation=max(0.001,min(0.015,min(box.width,box.height)*0.15))
            for axis in 0..<4 {
                let velocity=(raw[axis]-next.raw[axis])/dt
                next.derivative[axis]+=derivativeAlpha*(velocity-next.derivative[axis])
                let adaptive=alpha(2+4*abs(next.derivative[axis]),dt)
                next.value[axis]+=adaptive*(raw[axis]-next.value[axis])
                next.value[axis]=min(raw[axis]+deviation,max(raw[axis]-deviation,next.value[axis]))
            }
            guard let drawn=ObjectBoxGeometry.clipped(Rect(x:next.value[0]-next.value[2]/2,y:next.value[1]-next.value[3]/2,width:next.value[2],height:next.value[3])) else {filters.removeValue(forKey:input.id);continue}
            next.raw=raw;next.capturedAtMs=input.capturedAtMs;next.output=drawn;filters[input.id]=next;output[input.id]=drawn
        }
        for id in Array(filters.keys) where output[id] == nil {filters.removeValue(forKey:id)}
        return output
    }
}

public enum ObjectDisplayMetric {
    // Current measurement only, no numerical smoothing, hold or label hysteresis.
    public static func currentMetres(_ track: ObjectTrack,nowMs: Double) -> Double? {
        guard !track.isCoasting,nowMs.isFinite,nowMs>=0,let captured=track.rangeCapturedAtMs,captured.isFinite,captured>=0,
              nowMs>=captured,nowMs-captured<=300,let metres=track.range.metres,metres.isFinite,metres>=0.5,metres<=5 else {return nil}
        return metres
    }
    public static func text(_ metres: Double?) -> String {
        guard let metres,metres.isFinite,metres>=0.5,metres<=5 else {return "— m"}
        return String(format:"≈%.1f m",metres)
    }
}

// A class-owned opaque badge fill, not a depth/confidence/safety signal.
// Kept UIKit-free so every shipping color/alias and white contrast is testable.
public struct ObjectBadgeColor:Equatable {
    public let name:String,rgb:UInt32
    public init(name:String,rgb:UInt32) {self.name=name;self.rgb=rgb}
    public var red:Double {Double((rgb>>16)&255)/255}
    public var green:Double {Double((rgb>>8)&255)/255}
    public var blue:Double {Double(rgb&255)/255}
    public var hex:String {String(format:"#%06X",rgb)}
    public var whiteContrast:Double {
        func linear(_ component:Double)->Double {component<=0.04045 ? component/12.92:pow((component+0.055)/1.055,2.4)}
        let luminance=0.2126*linear(red)+0.7152*linear(green)+0.0722*linear(blue)
        return 1.05/(luminance+0.05)
    }
}
public enum ObjectClassPalette {
    public static let person=ObjectBadgeColor(name:"azure",rgb:0x085A9C)
    public static let phone=ObjectBadgeColor(name:"violet",rgb:0x7238AC)
    public static let remote=ObjectBadgeColor(name:"ochre",rgb:0x8E5D09)
    public static let furniture=ObjectBadgeColor(name:"teal",rgb:0x0A7162)
    public static let book=ObjectBadgeColor(name:"indigo",rgb:0x3F4DAD)
    public static let container=ObjectBadgeColor(name:"berry",rgb:0x963E79)
    public static let appliance=ObjectBadgeColor(name:"petrol",rgb:0x33677C)
    public static let transport=ObjectBadgeColor(name:"steel",rgb:0x45577A)
    public static let animal=ObjectBadgeColor(name:"copper",rgb:0x805827)
    public static let plant=ObjectBadgeColor(name:"olive",rgb:0x666225)
    public static let food=ObjectBadgeColor(name:"russet",rgb:0x855342)
    public static let accessory=ObjectBadgeColor(name:"lilac",rgb:0x715185)
    public static let other=ObjectBadgeColor(name:"slate",rgb:0x4A5577)
    public static let all=[person,phone,remote,furniture,book,container,appliance,transport,animal,plant,food,accessory,other]
    public static func colour(for raw:String)->ObjectBadgeColor {
        switch ObjectLabels.canonical(raw) {
        case "person":return person
        case "cell phone":return phone
        case "remote":return remote
        case "chair","couch","bed","bench","dining table":return furniture
        case "book":return book
        case "bottle","wine glass","cup","bowl","vase":return container
        case "refrigerator","microwave","oven","toaster","sink","toilet","hair drier":return appliance
        case "bicycle","car","motorcycle","airplane","bus","train","truck","boat":return transport
        case "bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe","teddy bear":return animal
        case "potted plant":return plant
        case "banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake":return food
        case "backpack","umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket":return accessory
        default:return other
        }
    }
}

public struct ObjectBadgeInput {
    public let id: Int
    public let box: Rect
    public let labelSize: Point
    public let priority: Int
    public init(id: Int,box: Rect,labelSize: Point,priority: Int=0) {self.id=id;self.box=box;self.labelSize=labelSize;self.priority=priority}
}
public enum ObjectBadgeLayout {
    private static func valid(_ r: Rect) -> Bool {[r.x,r.y,r.width,r.height].allSatisfy(\.isFinite) && r.width>0 && r.height>0}
    private static func intersects(_ a: Rect,_ b: Rect) -> Bool {
        min(a.x+a.width,b.x+b.width)-max(a.x,b.x)>0.001 && min(a.y+a.height,b.y+b.height)-max(a.y,b.y)>0.001
    }
    private static func attached(_ r: Rect,_ box: Rect) -> Bool {
        let overlap=min(r.x+r.width,box.x+box.width)-max(r.x,box.x)
        guard overlap>=min(12,min(box.width,r.width)*0.25) else {return false}
        let above=abs(r.y+r.height-box.y)<=6,below=abs(r.y-box.y-box.height)<=6
        let inside=r.y>=box.y-1 && r.y<=box.y+min(30,box.height/3)
        let bottomInside=abs(r.y+r.height-box.y-box.height)<=6
        return above || below || inside || bottomInside
    }
    public static func place(_ inputs: [ObjectBadgeInput],viewport: Rect,exclusions: [Rect]=[],previous: [Int:Rect]=[:]) -> [Int:Rect] {
        guard valid(viewport),viewport.width>12,viewport.height>12 else {return [:]}
        let obstacles=exclusions.prefix(32).filter(valid)
        var result:[Int:Rect]=[:],seen=Set<Int>()
        let sorted=inputs.prefix(12).sorted { $0.priority == $1.priority ? $0.id<$1.id:$0.priority>$1.priority }
        for input in sorted {
            guard input.id>0,seen.insert(input.id).inserted,valid(input.box),input.labelSize.x.isFinite,input.labelSize.y.isFinite,input.labelSize.x>0,input.labelSize.y>0 else {continue}
            let box=input.box,width=min(input.labelSize.x,viewport.width-12),height=input.labelSize.y
            guard height<=viewport.height-12 else {continue}
            func legal(_ r: Rect) -> Bool {
                valid(r) && abs(r.width-width)<0.5 && abs(r.height-height)<0.5 && r.x>=viewport.x+6 && r.y>=viewport.y+6 && r.x+r.width<=viewport.x+viewport.width-6 && r.y+r.height<=viewport.y+viewport.height-6 && attached(r,box) && !obstacles.contains(where:{intersects(r,$0)}) && !result.values.contains(where:{intersects(r,$0)})
            }
            if let old=previous[input.id],legal(old) {result[input.id]=old;continue}
            let xs=[box.x,box.x+box.width/2-width/2,box.x+box.width-width]
            let ys=[box.y-height-4,box.y+4,box.y+box.height+4,box.y+box.height-height-4]
            var candidate:Rect?
            for y in ys {
                for x in xs {
                    let clamped=min(max(viewport.x+6,x),viewport.x+viewport.width-width-6)
                    let r=Rect(x:clamped,y:y,width:width,height:height)
                    if legal(r) {candidate=r;break}
                }
                if candidate != nil {break}
            }
            if let candidate {result[input.id]=candidate}
            // Dense scenes may have no attached collision-free slot. Omitting
            // the badge is honest; UIKit retains the outline/AX and focus HUD.
        }
        return result
    }
}
