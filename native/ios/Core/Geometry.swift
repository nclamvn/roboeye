import Foundation

public struct Point: Equatable {
    public var x, y: Double
    public init(_ x: Double, _ y: Double) { self.x = x; self.y = y }
}
public struct Affine {
    public var a, b, c, d, tx, ty: Double
    public init(a: Double, b: Double, c: Double, d: Double, tx: Double, ty: Double) { self.a = a; self.b = b; self.c = c; self.d = d; self.tx = tx; self.ty = ty }
    public func apply(_ p: Point) -> Point { Point(a*p.x + c*p.y + tx, b*p.x + d*p.y + ty) }
    public func inverse() throws -> Affine {
        let det = a*d-b*c
        guard [a,b,c,d,tx,ty,det].allSatisfy(\.isFinite), abs(det) > 1e-10 else { throw ProbeError.invalid }
        return Affine(a:d/det, b:-b/det, c:-c/det, d:a/det, tx:(c*ty-d*tx)/det, ty:(b*tx-a*ty)/det)
    }
}
public enum ProbeGeometry {
    public static func toDisplay(_ p: Point, _ g: Presentation) -> Point {
        var x = (p.x-g.crop.x)/g.crop.width, y = (p.y-g.crop.y)/g.crop.height
        switch g.rotation { case 90: (x,y) = (1-y,x); case 180: (x,y) = (1-x,1-y); case 270: (x,y) = (y,1-x); default: break }
        if g.mirrored { x = 1-x }; return Point(x,y)
    }
    public static func fromDisplay(_ p: Point, _ g: Presentation) -> Point {
        var x = p.x, y = p.y
        if g.mirrored { x = 1-x }
        switch g.rotation { case 90: (x,y) = (y,1-x); case 180: (x,y) = (1-x,1-y); case 270: (x,y) = (1-y,x); default: break }
        return Point(g.crop.x+x*g.crop.width, g.crop.y+y*g.crop.height)
    }
    // Prove cardinal crop/rotation/mirror representation equals SDK affine.
    // Reject shear, off-image/letterbox/non-invertible transforms; never guess.
    public static func presentation(transform: Affine, width: Int, height: Int) throws -> Presentation {
        guard width > 1, height > 1 else { throw ProbeError.invalid }
        let inv = try transform.inverse(), w = Double(width), h = Double(height)
        let corners = [Point(0,0), Point(1,0), Point(0,1), Point(1,1)].map { inv.apply($0) }
        let x = corners.map(\.x).min()!, y = corners.map(\.y).min()!, x2 = corners.map(\.x).max()!, y2 = corners.map(\.y).max()!
        guard x >= -1e-6, y >= -1e-6, x2 <= 1+1e-6, y2 <= 1+1e-6, x2>x, y2>y else { throw ProbeError.invalid }
        let left=max(0,x)*w,top=max(0,y)*h
        let rect = Rect(x:left, y:top, width:min(w-left,(min(1,x2)-max(0,x))*w), height:min(h-top,(min(1,y2)-max(0,y))*h))
        for rotation in [0,90,180,270] { for mirror in [false,true] {
            let g = Presentation(crop:rect, rotation:rotation, mirrored:mirror)
            if corners.allSatisfy({ p in
                let expected = transform.apply(p), actual = toDisplay(Point(p.x*w,p.y*h),g)
                return hypot(expected.x-actual.x, expected.y-actual.y) < 1e-5
            }) { return g }
        } }
        throw ProbeError.invalid
    }
    public static func range(_ s: SupportSample, _ k: Calibration, kind: String = "metre-z") -> Double {
        let ray = hypot(hypot((s.u-k.cx)/k.fx,(s.v-k.cy)/k.fy),1)
        return kind == "metre-ray" ? s.value : s.value*ray
    }
    public static func rgbPixel(depthX: Int, depthY: Int, depthWidth: Int, depthHeight: Int, rgbWidth: Int, rgbHeight: Int) -> Point {
        // Pixel-centre alignment for the co-registered, full-FOV ARKit depth map.
        Point((Double(depthX)+0.5)*Double(rgbWidth)/Double(depthWidth)-0.5,
              (Double(depthY)+0.5)*Double(rgbHeight)/Double(depthHeight)-0.5)
    }
    public static func confidence(_ raw: UInt8) -> Double { raw == 2 ? 1 : raw == 1 ? 0.5 : 0 }
    public static func cameraPose(arkitColumnMajor m: [Double]) throws -> [Double] {
        guard m.count == 16 else { throw ProbeError.invalid }
        // ARKit camera +Y up, -Z forward → v1 +Y down, +Z forward.
        let signs = [1.0,-1,-1,1]
        let row = (0..<16).map { i in m[(i%4)*4+i/4]*signs[i%4] }
        guard validPose(row) else { throw ProbeError.invalid }; return row
    }
    public static func validPose(_ m: [Double]) -> Bool {
        guard m.count == 16, m.allSatisfy({ $0.isFinite && abs($0)<=1e6 }), (0..<4).allSatisfy({ abs(m[12+$0]-($0==3 ? 1:0))<1e-6 }) else { return false }
        let rows = [0,4,8].map { Array(m[$0..<$0+3]) }
        func dot(_ a: [Double],_ b: [Double]) -> Double { zip(a,b).reduce(0){$0+$1.0*$1.1} }
        guard rows.allSatisfy({abs(dot($0,$0)-1)<1e-4}), abs(dot(rows[0],rows[1]))<1e-4, abs(dot(rows[0],rows[2]))<1e-4, abs(dot(rows[1],rows[2]))<1e-4 else { return false }
        let a=rows[0], b=rows[1], c=rows[2]
        let det = a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0])
        return abs(det-1)<1e-4
    }
}
public struct ProbeResult {
    public var metres: Double?; public var reason: String; public var ageMs: Double?; public var supportCount: Int
    public init(metres: Double? = nil, reason: String, ageMs: Double? = nil, supportCount: Int = 0) { self.metres=metres; self.reason=reason; self.ageMs=ageMs; self.supportCount=supportCount }
}
public enum RangeProbe {
    public static func evaluate(_ f: ProbeFrame, nowMs: Double, trackingNormal: Bool = true, reused: Bool = false) -> ProbeResult {
        let age = f.depth.map { nowMs-$0.capturedAtMs }
        func refuse(_ why: String) -> ProbeResult { ProbeResult(reason:why,ageMs:age) }
        guard trackingNormal else { return refuse("tracking-limited") }
        guard nowMs.isFinite, nowMs >= f.rgb.readyAtMs, age == nil || age! >= 0 else { return refuse("clock-future") }
        guard let dp=f.depth else { return refuse("no-depth") }
        guard dp.kind != "relative" else { return refuse("relative-only") }
        guard ["metre-z","metre-ray"].contains(dp.kind) else { return refuse("no-depth") }
        guard let k=f.intrinsics, [k.fx,k.fy,k.cx,k.cy].allSatisfy(\.isFinite), k.fx>0,k.fy>0 else { return refuse("no-intrinsics") }
        guard !reused else { return refuse("depth-reused") }
        guard nowMs-dp.capturedAtMs<=300, nowMs-f.rgb.capturedAtMs<=300 else { return refuse("stale") }
        guard abs(f.rgb.capturedAtMs-dp.capturedAtMs)<=50 else { return refuse("rgb-depth-skew") }
        guard let t=f.targets.first, t.support == "foreground-associated" else { return refuse("no-foreground") }
        guard t.sampleIndices.allSatisfy({dp.samples.indices.contains($0)}) else { return refuse("low-support") }
        let candidates:[SupportSample] = t.sampleIndices.map { dp.samples[$0] }
        let maxU=Double(f.rgb.width-1),maxV=Double(f.rgb.height-1)
        let samples = candidates.filter { s in
            let quality=s.confidence.isFinite && s.confidence>=0.7 && s.confidence<=1
            let metric=s.value.isFinite && s.value>=1e-6 && s.value<=100
            let inside=s.u.isFinite && s.v.isFinite && s.u>=0 && s.v>=0 && s.u<=maxU && s.v<=maxV
            return quality && metric && inside
        }
        guard samples.count>=5, Set(samples.map { "\($0.u)/\($0.v)" }).count>=5 else { return refuse("low-support") }
        let values=samples.map { ProbeGeometry.range($0,k,kind:dp.kind) }.sorted(), median=values[values.count/2]
        guard values.filter({abs($0-median)>max(0.15,median*0.15)}).count*5 < values.count else { return refuse("ambiguous-support") }
        guard median.isFinite, median>=0.5, median<=5 else { return refuse("outside-domain") }
        return ProbeResult(metres:median, reason:"supported", ageMs:age, supportCount:samples.count)
    }
}
public struct FrameClock {
    public private(set) var origin: Double?; private var previous: Double = -1
    public init() {}
    public static func fresh(captureSeconds:Double,nowSeconds:Double) -> Bool {
        captureSeconds.isFinite && nowSeconds.isFinite && nowSeconds>=captureSeconds && nowSeconds-captureSeconds<=0.3
    }
    public mutating func accept(captureSeconds: Double, readySeconds: Double) -> (capture: Double, ready: Double)? {
        guard captureSeconds.isFinite,readySeconds.isFinite,captureSeconds>previous,readySeconds>=captureSeconds,readySeconds-captureSeconds<=60 else { return nil }
        if origin == nil { origin=captureSeconds }; previous=captureSeconds
        let c=(captureSeconds-origin!)*1000, r=(readySeconds-origin!)*1000
        guard c<=86_400_000 else { return nil }; return (c,r)
    }
}
