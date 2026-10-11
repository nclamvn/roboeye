import UIKit

// Presentation only: raw association, depth and exports never use filtered boxes.
final class ObjectOverlay:UIView {
    private final class Badge:UILabel {
        let padding=UIEdgeInsets(top:6,left:9,bottom:6,right:9)
        override func drawText(in rect:CGRect) {super.drawText(in:rect.inset(by:padding))}
        override func sizeThatFits(_ size:CGSize)->CGSize {
            let content=super.sizeThatFits(CGSize(width:max(0,size.width-padding.left-padding.right),height:size.height))
            return CGSize(width:content.width+padding.left+padding.right,height:content.height+padding.top+padding.bottom)
        }
    }
    private final class BoxView {
        let outline=UIView(),label=Badge(),ink=CAShapeLayer(),line=CAShapeLayer(),leader=CAShapeLayer(),element:UIAccessibilityElement
        var measuredText="",measuredWidth:CGFloat=0,measuredCategory:UIContentSizeCategory?,labelSize=CGSize.zero
        init(container:UIView,geometry:UIView,badges:UIView,id:Int) {
            element=UIAccessibilityElement(accessibilityContainer:container)
            element.accessibilityIdentifier="object-\(id)";element.accessibilityTraits = .staticText
            outline.isUserInteractionEnabled=false;outline.isAccessibilityElement=false
            [ink,line].forEach {$0.fillColor=UIColor.clear.cgColor;outline.layer.addSublayer($0)}
            ink.strokeColor=UIColor.black.withAlphaComponent(0.8).cgColor;ink.lineWidth=5;line.lineWidth=1.5
            leader.fillColor=UIColor.clear.cgColor;leader.lineWidth=0.75;geometry.layer.addSublayer(leader)
            label.numberOfLines=0;label.adjustsFontForContentSizeCategory=true;label.textColor = .white
            label.layer.cornerRadius=7;label.clipsToBounds=true
            label.layer.borderWidth=0.5;label.isAccessibilityElement=false
            geometry.addSubview(outline);badges.addSubview(label)
        }
    }
    private var boxes:[Int:BoxView]=[:],presentation=ObjectPresentationState(),previousBadges:[Int:Rect]=[:]
    private let geometryPlane=UIView(),badgePlane=UIView()
    private var viewport=CGRect.zero,exclusions:[CGRect]=[],accessibilityOrder:[Int]=[]
    private let cyan=UIColor(red:0.38,green:0.80,blue:0.96,alpha:1),amber=UIColor(red:0.95,green:0.74,blue:0.39,alpha:1)
    private var reducedMotion:Bool {
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--qa-reduced-motion") {return true}
        #endif
        return UIAccessibility.isReduceMotionEnabled
    }
    override init(frame:CGRect) {
        super.init(frame:frame);isUserInteractionEnabled=false;accessibilityIdentifier="objects";backgroundColor = .clear
        // Membership order must never put a later object's corner stroke above
        // an earlier label. Two retained planes enforce this for every ID:
        // ALL geometry/leader lines below ALL readable label plates.
        [geometryPlane,badgePlane].forEach {
            $0.frame=bounds;$0.autoresizingMask=[.flexibleWidth,.flexibleHeight]
            $0.isUserInteractionEnabled=false;$0.isAccessibilityElement=false;addSubview($0)
        }
    }
    required init?(coder:NSCoder) {fatalError("init(coder:) has not been implemented")}
    static func currentRange(_ track:ObjectTrack,nowMs:Double)->Double? {ObjectDisplayMetric.currentMetres(track,nowMs:nowMs)}
    @discardableResult func setPresentationRegion(_ region:CGRect,exclusions:[CGRect])->Bool {
        let changed=viewport != region || self.exclusions != exclusions
        if changed {previousBadges=[:]}
        viewport=region;self.exclusions=exclusions
        return changed
    }
    func clear() {
        boxes.values.forEach {$0.outline.removeFromSuperview();$0.label.removeFromSuperview();$0.leader.removeFromSuperlayer()}
        boxes=[:];previousBadges=[:];accessibilityOrder=[];presentation.reset();accessibilityElements=[]
    }
    private func rect(_ cg:CGRect)->Rect {Rect(x:cg.minX,y:cg.minY,width:cg.width,height:cg.height)}
    private func cgRect(_ r:Rect)->CGRect {CGRect(x:r.x,y:r.y,width:r.width,height:r.height)}
    private func corners(_ frame:CGRect)->CGPath {
        let path=UIBezierPath(),w=frame.width,h=frame.height,l=min(18,min(w,h)*0.3)
        for (x,y,sx,sy) in [(CGFloat(0),CGFloat(0),CGFloat(1),CGFloat(1)),(w,0,-1,1),(0,h,1,-1),(w,h,-1,-1)] {
            path.move(to:CGPoint(x:x+sx*l,y:y));path.addLine(to:CGPoint(x:x,y:y));path.addLine(to:CGPoint(x:x,y:y+sy*l))
        };return path.cgPath
    }
    func show(_ tracks:[ObjectTrack],transform:Affine,nowMs:Double) {
        guard bounds.width>0,bounds.height>0 else {return}
        let raw=tracks.compactMap {track -> ObjectPresentationInput? in
            guard let box=ObjectBoxGeometry.displayBox(track.box,transform:transform) else {return nil}
            return ObjectPresentationInput(id:track.id,box:box,capturedAtMs:track.lastSeenMs,isCoasting:track.isCoasting || nowMs-track.lastSeenMs>300)
        }
        let displayed=presentation.update(raw,nowMs:nowMs,reducedMotion:reducedMotion)
        var present=Set<Int>(),inputs=[ObjectBadgeInput](),accessibility=[UIAccessibilityElement]()
        CATransaction.begin();CATransaction.setDisableActions(true);defer {CATransaction.commit()}
        for track in tracks.sorted(by:{$0.id<$1.id}) {
            guard let r=displayed[track.id] else {continue};present.insert(track.id)
            let box=boxes[track.id] ?? BoxView(container:self,geometry:geometryPlane,badges:badgePlane,id:track.id);boxes[track.id]=box
            #if DEBUG
            // The dense UI fixtures exercise this invariant; collision-free
            // rectangles alone cannot catch a label crossed by later strokes.
            assert(subviews.last===badgePlane && box.label.superview===badgePlane && box.outline.superview===geometryPlane,"Object graphics must never render above labels")
            #endif
            let frame=CGRect(x:r.x*bounds.width,y:r.y*bounds.height,width:r.width*bounds.width,height:r.height*bounds.height)
            if box.outline.frame != frame {box.outline.frame=frame;let path=corners(frame);box.ink.path=path;box.line.path=path}
            let metres=Self.currentRange(track,nowMs:nowMs),value=metres == nil ? "— m · chưa đo":ObjectDisplayMetric.text(metres)
            let fill=ObjectClassPalette.colour(for:track.label)
            let name="#\(track.id) · \(track.vietnameseLabel)",text="\(name)\n\(value)",colour=metres == nil ? amber:cyan
            let coasting=track.isCoasting || nowMs-track.lastSeenMs>300
            box.line.strokeColor=colour.cgColor;box.leader.strokeColor=colour.withAlphaComponent(0.7).cgColor;box.outline.alpha=coasting ? 0.45:1
            box.label.layer.borderColor=colour.withAlphaComponent(0.65).cgColor
            let category=traitCollection.preferredContentSizeCategory
            let available=max(60,min(viewport.width>0 ? viewport.width:bounds.width,category.isAccessibilityCategory ? 320:230))
            if box.measuredText != text || box.measuredWidth != available || box.measuredCategory != category {
                box.label.font=UIFontMetrics(forTextStyle:.callout).scaledFont(for:UIFont.systemFont(ofSize:15,weight:.semibold))
                box.label.text=text;box.measuredText=text;box.measuredWidth=available;box.measuredCategory=category
                let fit=box.label.sizeThatFits(CGSize(width:available,height:CGFloat.greatestFiniteMagnitude))
                box.labelSize=CGSize(width:min(available,max(100,fit.width)),height:max(42,fit.height))
            }
            // Opaque actual chromatic fills are owned ONLY by semantic class.
            // Reduce Transparency, unknown depth and coasting cannot turn them
            // black or change phone into remote. IDs/names remain necessary.
            box.label.backgroundColor=UIColor(red:fill.red,green:fill.green,blue:fill.blue,alpha:1)
            inputs.append(ObjectBadgeInput(id:track.id,box:rect(frame),labelSize:Point(box.labelSize.width,box.labelSize.height),priority:metres == nil ? 0:1))
            box.element.accessibilityLabel="\(name) · \(value)"
            box.element.accessibilityValue=metres == nil ? coasting ? "Mất bám, chưa đo":"Chưa đủ dữ liệu đo: \(track.range.reason)":"Ước lượng tới bề mặt trong khung, không phải khoảng trống đi bộ"
            accessibility.append(box.element)
        }
        let region=viewport.isEmpty ? bounds.insetBy(dx:8,dy:8):viewport
        let placements=ObjectBadgeLayout.place(inputs,viewport:rect(region),exclusions:exclusions.map(rect),previous:previousBadges)
        previousBadges=placements
        for input in inputs {
            guard let box=boxes[input.id] else {continue}
            if let placement=placements[input.id] {
                box.label.isHidden=false;box.label.frame=cgRect(placement);box.element.accessibilityFrameInContainerSpace=box.label.frame
                let badge=box.label.frame,outline=box.outline.frame,centre=CGPoint(x:badge.midX,y:badge.midY)
                if outline.contains(centre) {box.leader.path=nil}
                else {
                    let below=badge.midY>outline.midY,path=UIBezierPath()
                    path.move(to:CGPoint(x:min(outline.maxX,max(outline.minX,badge.midX)),y:below ? outline.maxY:outline.minY))
                    path.addLine(to:CGPoint(x:badge.midX,y:below ? badge.minY:badge.maxY));box.leader.path=path.cgPath
                }
            } else {
                // Dense scenes omit only the badge, never identity or outline.
                box.label.isHidden=true;box.leader.path=nil;box.element.accessibilityFrameInContainerSpace=box.outline.frame
                box.element.accessibilityValue=(box.element.accessibilityValue ?? "")+" · Nhãn ẩn vì khung hình đông vật thể"
            }
        }
        for id in Array(boxes.keys) where !present.contains(id) {boxes[id]?.outline.removeFromSuperview();boxes[id]?.label.removeFromSuperview();boxes[id]?.leader.removeFromSuperlayer();boxes.removeValue(forKey:id)}
        let order=tracks.map(\.id).filter {present.contains($0)}.sorted()
        if order != accessibilityOrder {accessibilityOrder=order;accessibilityElements=accessibility}
    }
}
