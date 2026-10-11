import UIKit
import QuartzCore

final class ProbeViewController: UIViewController {
    private let engine=DepthSession(), recorder=ProbeRecorder(), camera=UIView(), reticle=UIView(), objects=ObjectOverlay()
    private let range=UILabel(), status=UILabel(), source=UILabel(), count=UILabel(), note=UILabel(), timings=UILabel()
    private let start=UIButton(type:.system), surface=UIButton(type:.system), record=UIButton(type:.system), truth=UIButton(type:.system), export=UIButton(type:.system), erase=UIButton(type:.system)
    private let diagnostics=UIButton(type:.system),mode=UISegmentedControl(items:["Tự động","Đo điểm"])
    private let consent=UISwitch(), scroll=UIScrollView(), controls=UIStackView(),detail=UIStackView()
    private let metricRow=UIStackView(),actionRow=UIStackView(),heading=UIStackView()
    private var scrollCap:NSLayoutConstraint?,diagnosticsOpen=false,objectOutput:ObjectPresentation?
    private var compactLandscape=false,lastLayoutCategory:UIContentSizeCategory?,objectPresentationDirty=true,objectExpiryState=""
    private let exporter=SnapshotExporter()
    private var selected: Point?, latest: ProbeFrame?, lastRecord:Double = -1000
    private var shareDirectory: URL?, fixtureTimer:Timer?, fixtureIndex=0, fixtureConfirmed=false
    private var fixtureRunning=false,fixtureStartSeconds:Double=0,fixtureTracker=ObjectTracker()
    private var heartbeat:Timer?,pendingPresentation:(ProbeResult,String,Double)?,lastMaintenanceSeconds:Double=0
    private let blue=UIColor(red:0.38,green:0.80,blue:0.96,alpha:1),amber=UIColor(red:0.95,green:0.74,blue:0.39,alpha:1)
    #if DEBUG && targetEnvironment(simulator)
    private let fixtureMode=ProcessInfo.processInfo.arguments.contains("--qa-fixture") || ProcessInfo.processInfo.arguments.contains("--qa-objects")
    private let objectFixture=ProcessInfo.processInfo.arguments.contains("--qa-objects")
    #else
    private let fixtureMode=false,objectFixture=false
    #endif
    override var preferredStatusBarStyle:UIStatusBarStyle { .lightContent }
    private var automatic:Bool {mode.selectedSegmentIndex==0}
    private var cameraRunning:Bool {engine.running || fixtureRunning}
    private var reducedTransparency:Bool {
        #if DEBUG && targetEnvironment(simulator)
        if fixtureMode,ProcessInfo.processInfo.arguments.contains("--qa-reduce-transparency") {return true}
        #endif
        return UIAccessibility.isReduceTransparencyEnabled
    }
    override func viewDidLoad() {
        super.viewDidLoad(); overrideUserInterfaceStyle = .dark; view.backgroundColor = .black
        // Recover only this app's known export directories after an interrupted
        // share/crash. Never clear the whole temporary container.
        if let old=try? FileManager.default.contentsOfDirectory(at:FileManager.default.temporaryDirectory,includingPropertiesForKeys:[.isDirectoryKey]) {
            for url in old where url.lastPathComponent.range(of:"^codex-tmp-tip64b1-export-[A-Fa-f0-9-]{36}$",options:.regularExpression) != nil {
                if (try? url.resourceValues(forKeys:[.isDirectoryKey]).isDirectory)==true { try? FileManager.default.removeItem(at:url) }
            }
        }
        camera.translatesAutoresizingMaskIntoConstraints=false; view.addSubview(camera)
        NSLayoutConstraint.activate([camera.topAnchor.constraint(equalTo:view.topAnchor),camera.bottomAnchor.constraint(equalTo:view.bottomAnchor),camera.leadingAnchor.constraint(equalTo:view.leadingAnchor),camera.trailingAnchor.constraint(equalTo:view.trailingAnchor)])
        camera.addGestureRecognizer(UITapGestureRecognizer(target:self,action:#selector(tap(_:))))
        engine.attach(to:camera)
        objects.frame=camera.bounds;objects.autoresizingMask=[.flexibleWidth,.flexibleHeight];camera.addSubview(objects)
        reticle.layer.borderWidth=2; reticle.layer.borderColor=blue.cgColor; reticle.layer.cornerRadius=8; reticle.isUserInteractionEnabled=false; reticle.isHidden=true; camera.addSubview(reticle)
        reticle.accessibilityIdentifier="reticle"
        heading.axis = .vertical;heading.spacing=4;heading.translatesAutoresizingMaskIntoConstraints=false;heading.accessibilityIdentifier="header";view.addSubview(heading)
        let title=UILabel();title.text="RoboEye Assist · "+(Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "prototype");title.font=UIFont.preferredFont(forTextStyle:.headline);title.textColor = .white;title.adjustsFontForContentSizeCategory=true;heading.addArrangedSubview(title)
        source.font=UIFont.preferredFont(forTextStyle:.caption1);source.adjustsFontForContentSizeCategory=true;source.textColor=amber;source.numberOfLines=2;source.text=fixtureMode ? "Mô phỏng UI · không phải LiDAR thật":"Đo bề mặt 0,5–5 m · Không dẫn đường";source.accessibilityIdentifier="source";heading.addArrangedSubview(source)
        heading.backgroundColor=UIColor.black.withAlphaComponent(0.78); heading.layer.cornerRadius=12;heading.isLayoutMarginsRelativeArrangement=true; heading.layoutMargins=UIEdgeInsets(top:9,left:12,bottom:9,right:12)
        NSLayoutConstraint.activate([heading.topAnchor.constraint(equalTo:view.safeAreaLayoutGuide.topAnchor,constant:8),heading.leadingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.leadingAnchor,constant:12),heading.trailingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.trailingAnchor,constant:-12)])
        scroll.translatesAutoresizingMaskIntoConstraints=false; scroll.accessibilityIdentifier="controls"; scroll.backgroundColor=UIColor.black.withAlphaComponent(0.88); scroll.layer.cornerRadius=20; view.addSubview(scroll)
        controls.axis = .vertical; controls.spacing=8; controls.translatesAutoresizingMaskIntoConstraints=false; controls.isLayoutMarginsRelativeArrangement=true; controls.layoutMargins=UIEdgeInsets(top:12,left:12,bottom:12,right:12); scroll.addSubview(controls)
        mode.selectedSegmentIndex=fixtureMode && !objectFixture ? 1:0
        if ProcessInfo.processInfo.arguments.contains("--qa-manual") {mode.selectedSegmentIndex=1}
        engine.automatic=automatic;mode.accessibilityIdentifier="mode";mode.addTarget(self,action:#selector(modeChanged),for:.valueChanged)
        mode.setTitleTextAttributes([.font:UIFont.preferredFont(forTextStyle:.callout)],for:.normal)
        mode.selectedSegmentTintColor=UIColor(white:0.23,alpha:1);mode.backgroundColor=UIColor(white:0.07,alpha:0.95)
        mode.heightAnchor.constraint(greaterThanOrEqualToConstant:44).isActive=true;controls.addArrangedSubview(mode)
        metricRow.axis = .horizontal;metricRow.alignment = .center;metricRow.spacing=12;controls.addArrangedSubview(metricRow)
        range.font=UIFontMetrics(forTextStyle:.title1).scaledFont(for:UIFont.monospacedDigitSystemFont(ofSize:29,weight:.semibold)); range.adjustsFontForContentSizeCategory=true; range.textColor = .white; range.text="— m"; range.accessibilityIdentifier="range"; range.accessibilityLabel="Chưa đo";range.setContentHuggingPriority(UILayoutPriority(751),for:.horizontal);range.setContentCompressionResistancePriority(.required,for:.horizontal);metricRow.addArrangedSubview(range)
        status.font=UIFont.preferredFont(forTextStyle:.callout);status.adjustsFontForContentSizeCategory=true;status.textColor=amber;status.numberOfLines=2;status.accessibilityIdentifier="status";status.text="Mở camera để nhận diện";metricRow.addArrangedSubview(status)
        configure(start,"Mở camera","start",#selector(toggleCamera)); configure(surface,"Đo vùng này","surface",#selector(confirm));configure(diagnostics,"Chẩn đoán","diagnostics",#selector(toggleDiagnostics));actionRow.axis = .horizontal;actionRow.spacing=10;actionRow.distribution = .fillEqually;[start,surface,diagnostics].forEach {actionRow.addArrangedSubview($0)};controls.addArrangedSubview(actionRow);surface.isHidden=automatic
        detail.axis = .vertical;detail.spacing=10;detail.isHidden=true;controls.addArrangedSubview(detail)
        let consentLabel=UILabel(); consentLabel.text="Cho phép ghi metadata, không ghi hình"; consentLabel.font=UIFont.preferredFont(forTextStyle:.body); consentLabel.adjustsFontForContentSizeCategory=true; consentLabel.textColor = .white; consentLabel.numberOfLines=0
        consent.accessibilityIdentifier="consent"; consent.addTarget(self,action:#selector(consentChanged),for:.valueChanged); let consentRow=UIStackView(arrangedSubviews:[consentLabel,consent]); consentRow.spacing=12; consentRow.alignment = .center; detail.addArrangedSubview(consentRow)
        configure(record,"Ghi mẫu","record",#selector(toggleRecord)); configure(export,"Xuất JSON","export",#selector(share)); detail.addArrangedSubview(row(record,export))
        configure(truth,"Gắn số đo thực","truth",#selector(addTruth)); configure(erase,"Xoá dữ liệu","erase",#selector(clear)); detail.addArrangedSubview(row(truth,erase))
        count.font=UIFont.preferredFont(forTextStyle:.body); count.adjustsFontForContentSizeCategory=true; count.textColor = .white; count.accessibilityIdentifier="count"; detail.addArrangedSubview(count)
        timings.font=UIFont.preferredFont(forTextStyle:.caption1);timings.adjustsFontForContentSizeCategory=true;timings.textColor = .lightGray;timings.numberOfLines=0;timings.text="Chưa có lần xử lý thực.";timings.accessibilityIdentifier="timings";detail.addArrangedSubview(timings)
        note.text="80 nhóm vật thể COCO; quạt chưa thuộc nhóm hỗ trợ. ≈ là khoảng cách tới bề mặt trong khung, không phải khoảng trống đi bộ. Kính, phản chiếu, mép vật hoặc dữ liệu cũ có thể chưa đo. JSON v1 ghi bbox-only, tối đa128 điểm và8 nhóm nhãn (nhóm khác: unknown), không giả định phân vùng vật. Đo điểm cần chọn và xác nhận cùng bề mặt."; note.font=UIFont.preferredFont(forTextStyle:.caption1); note.adjustsFontForContentSizeCategory=true; note.textColor = .lightGray; note.numberOfLines=0; detail.addArrangedSubview(note)
        let hug=scroll.heightAnchor.constraint(equalTo:controls.heightAnchor);hug.priority = .defaultHigh
        NSLayoutConstraint.activate([scroll.bottomAnchor.constraint(equalTo:view.safeAreaLayoutGuide.bottomAnchor,constant:-8),scroll.leadingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.leadingAnchor,constant:12),scroll.trailingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.trailingAnchor,constant:-12),scroll.topAnchor.constraint(greaterThanOrEqualTo:heading.bottomAnchor,constant:8),hug,controls.topAnchor.constraint(equalTo:scroll.contentLayoutGuide.topAnchor),controls.bottomAnchor.constraint(equalTo:scroll.contentLayoutGuide.bottomAnchor),controls.leadingAnchor.constraint(equalTo:scroll.contentLayoutGuide.leadingAnchor),controls.trailingAnchor.constraint(equalTo:scroll.contentLayoutGuide.trailingAnchor),controls.widthAnchor.constraint(equalTo:scroll.frameLayoutGuide.widthAnchor)])
        updateScrollCap()
        engine.onUpdate={ [weak self] frame,result,message in self?.update(frame,result,message) }
        engine.onObjects={ [weak self] output in self?.updateObjects(output) }
        engine.onSuspend={ [weak self] in self?.clear() }
        refreshControls()
        if fixtureMode { setupFixture() }
        if ProcessInfo.processInfo.arguments.contains("--qa-live-camera"),!fixtureMode {
            DispatchQueue.main.async { [weak self] in self?.toggleCamera() }
        }
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        updateCompactLayout()
        if engine.viewport != camera.bounds.size {
            selected=nil;fixtureConfirmed=false;pendingPresentation=nil;reticle.isHidden=true;objects.clear();objectOutput=nil
            updateScrollCap()
            engine.viewport=camera.bounds.size;range.text="— m";range.accessibilityLabel="Chưa đo"
            // Rotation invalidates the measurement, and must not leave its new
            // unknown state offscreen at the previous tapped button's offset.
            scroll.setContentOffset(.zero,animated:false);refreshControls()
        }
        // Full-camera pixel coordinates; neither a badge nor its AX frame may
        // cover the source warning, bottom instrument or unsafe screen edges.
        if objects.setPresentationRegion(view.safeAreaLayoutGuide.layoutFrame.insetBy(dx:8,dy:8),exclusions:[heading.frame.insetBy(dx:-8,dy:-8),scroll.frame.insetBy(dx:-8,dy:-8)]) {objectPresentationDirty=true}
        heading.backgroundColor=reducedTransparency ? .black:UIColor.black.withAlphaComponent(0.78)
        scroll.backgroundColor=reducedTransparency ? .black:UIColor.black.withAlphaComponent(0.88)
    }
    private func updateCompactLayout() {
        let next=camera.bounds.width>camera.bounds.height && !traitCollection.preferredContentSizeCategory.isAccessibilityCategory
        let category=traitCollection.preferredContentSizeCategory
        guard next != compactLandscape || category != lastLayoutCategory else {return}
        lastLayoutCategory=category
        if next != compactLandscape, next {
            compactLandscape=next
            controls.removeArrangedSubview(mode);mode.removeFromSuperview();actionRow.insertArrangedSubview(mode,at:0)
        } else if next != compactLandscape {
            compactLandscape=next
            actionRow.removeArrangedSubview(mode);mode.removeFromSuperview();controls.insertArrangedSubview(mode,at:0)
        }
        let accessible=traitCollection.preferredContentSizeCategory.isAccessibilityCategory
        metricRow.axis=accessible ? .vertical:.horizontal;metricRow.alignment=accessible ? .fill:.center;status.numberOfLines=accessible ? 3:2
        updateScrollCap();scroll.setContentOffset(.zero,animated:false)
    }
    private func updateScrollCap() {
        scrollCap?.isActive=false
        let landscape=camera.bounds.width>camera.bounds.height
        let cap:CGFloat
        if landscape,traitCollection.preferredContentSizeCategory.isAccessibilityCategory {cap=0.78}
        else if landscape {cap=diagnosticsOpen ? 0.68:0.55}
        else {cap=diagnosticsOpen ? 0.58:0.36}
        scrollCap=scroll.heightAnchor.constraint(lessThanOrEqualTo:view.safeAreaLayoutGuide.heightAnchor,multiplier:cap)
        scrollCap?.isActive=true
    }
    private func row(_ buttons:UIButton...) -> UIStackView { let row=UIStackView(arrangedSubviews:buttons); row.spacing=10; row.distribution = .fillEqually; return row }
    private func configure(_ b:UIButton,_ title:String,_ id:String,_ action:Selector) {
        var c=UIButton.Configuration.filled();c.title=title;c.cornerStyle = .medium;c.contentInsets=NSDirectionalEdgeInsets(top:10,leading:12,bottom:10,trailing:12)
        c.baseBackgroundColor=id == "start" ? UIColor(white:0.95,alpha:1):UIColor(white:0.1,alpha:1);c.baseForegroundColor=id == "start" ? UIColor(white:0.05,alpha:1):.white
        if id == "start" {c.image=UIImage(systemName:"camera");c.imagePadding=7}
        if id == "diagnostics" {c.image=UIImage(systemName:"slider.horizontal.3");c.imagePadding=7;c.background.strokeColor=UIColor(white:0.5,alpha:0.55);c.background.strokeWidth=0.5}
        c.titleTextAttributesTransformer=UIConfigurationTextAttributesTransformer {var v=$0;v.font=UIFont.preferredFont(forTextStyle:.callout);return v}
        b.configuration=c;b.accessibilityIdentifier=id;b.heightAnchor.constraint(greaterThanOrEqualToConstant:44).isActive=true;b.addTarget(self,action:action,for:.touchUpInside)
    }
    private func refreshControls() {
        title(start,engine.starting ? "Huỷ mở camera" : cameraRunning ? "Dừng camera" : "Mở camera")
        surface.isEnabled=selected != nil && cameraRunning;surface.isHidden=automatic
        title(record,recorder.active ? "Dừng ghi" : "Ghi mẫu")
        record.isEnabled = !fixtureMode && (recorder.active || (engine.running && engine.liveNowMs != nil && consent.isOn && recorder.frames.isEmpty))
        title(export,exporter.isBusy ? "Đang xuất…" : "Xuất JSON")
        export.isEnabled = !exporter.isBusy && !recorder.active && !recorder.frames.isEmpty
        truth.isEnabled = !exporter.isBusy && !recorder.active && recorder.frames.last?.targets.first?.support == "foreground-associated"
        consent.isEnabled = !fixtureMode && !recorder.active && recorder.frames.isEmpty
        text(count,"\(recorder.frames.count)/600 mẫu · \(recorder.rejected) bị từ chối" + (recorder.frames.isEmpty || recorder.active ? "" : " · \(recorder.stopReason)"))
        erase.isEnabled = !recorder.frames.isEmpty || consent.isOn || recorder.active
        engine.recordingRequested=recorder.active
        updatePresentationTimer()
    }
    private func updatePresentationTimer() {
        guard cameraRunning || engine.starting else {heartbeat?.invalidate();heartbeat=nil;return}
        guard heartbeat==nil else {return}
        // Bounded 30 Hz expiry/presentation, not a 120 Hz display-link or an
        // inference scheduler. No timer exists while capture is stopped. Common
        // mode keeps metric expiry active during scrolling; controls/diagnostics
        // maintenance stays <=10 Hz. This is a scheduling cap, not measured FPS.
        let timer=Timer(timeInterval:1.0/30,repeats:true) {[weak self] _ in self?.presentationTick()}
        heartbeat=timer;RunLoop.main.add(timer,forMode:.common)
    }
    private func presentationTick() {
        guard cameraRunning || engine.starting else {refreshControls();return}
        if automatic,let output=objectOutput {
            let now=fixtureMode ? (CACurrentMediaTime()-fixtureStartSeconds)*1000:engine.liveNowMs ?? output.nowMs
            renderObjects(output,nowMs:now)
        } else if let pending=pendingPresentation {
            let age=(pending.0.ageMs ?? 0)+(CACurrentMediaTime()-pending.2)*1000
            render(age>300 ? ProbeResult(reason:"stale",ageMs:age):pending.0,pending.1)
            if age>300 {pendingPresentation=nil}
        }
        let seconds=CACurrentMediaTime()
        if seconds-lastMaintenanceSeconds>=0.1 {
            lastMaintenanceSeconds=seconds
            if let now=engine.liveNowMs {recorder.tick(liveNowMs:now)}
            if diagnosticsOpen {refreshDiagnostics()}
            refreshControls()
        }
    }
    private func title(_ button:UIButton,_ value:String) { if button.configuration?.title != value {var config=button.configuration;config?.title=value;button.configuration=config} }
    private func text(_ label:UILabel,_ value:String) { if label.text != value { label.text=value } }
    @objc private func toggleDiagnostics() {
        diagnosticsOpen.toggle();detail.isHidden = !diagnosticsOpen;title(diagnostics,diagnosticsOpen ? "Thu gọn":"Chẩn đoán");updateScrollCap();scroll.setContentOffset(.zero,animated:false)
        if diagnosticsOpen {refreshDiagnostics()}
    }
    @objc private func modeChanged() {
        recorder.stop();selected=nil;latest=nil;fixtureConfirmed=false;reticle.isHidden=true;pendingPresentation=nil;objects.clear();objectOutput=nil
        engine.automatic=automatic;engine.select(nil);fixtureTracker.reset()
        render(ProbeResult(reason:"unavailable"),automatic ? "Tự nhận diện khi camera đang mở.":"Chạm bề mặt rồi bấm Đo vùng này.");refreshControls()
    }
    @objc private func toggleCamera() {
        selected=nil; reticle.isHidden=true; pendingPresentation=nil;objectOutput=nil;objects.clear()
        if fixtureMode {
            fixtureRunning.toggle();fixtureConfirmed=false;fixtureIndex=0;fixtureTracker.reset();fixtureStartSeconds=CACurrentMediaTime()
            render(ProbeResult(reason:"unavailable"),fixtureRunning ? "Mô phỏng UI · không phải số đo thật":"Camera đã dừng. Không dùng số đo cũ.")
        } else if engine.running || engine.starting { engine.stop(); recorder.stop(); latest=nil }
        else if !DepthSession.supported { render(ProbeResult(reason:"unavailable"),"Cần iPhone có LiDAR. Simulator không nhận diện hay đo thật.") }
        else { engine.start() }
        refreshControls()
    }
    @objc private func tap(_ recognizer:UITapGestureRecognizer) {
        guard !automatic,cameraRunning,camera.bounds.width>0,camera.bounds.height>0 else { return }
        let p=recognizer.location(in:camera); selected=Point(p.x/camera.bounds.width,p.y/camera.bounds.height)
        fixtureConfirmed=false; fixtureIndex=0; engine.select(selected); reticle.frame=CGRect(x:p.x-18,y:p.y-18,width:36,height:36); reticle.isHidden=false;render(ProbeResult(reason:"no-foreground"),"Giữ điểm trên vật rồi bấm Đo vùng này.");refreshControls()
    }
    @objc private func confirm() { engine.confirmSurface(); fixtureConfirmed=true }
    private func update(_ frame:ProbeFrame?,_ result:ProbeResult,_ message:String) {
        if automatic {
            if frame==nil,result.metres==nil,!cameraRunning || objectOutput==nil {render(result,message)}
            refreshControls()
            return
        }
        latest=frame
        if result.metres == nil { pendingPresentation=nil; render(result,message) }
        else { pendingPresentation=(result,message,CACurrentMediaTime()) }
        if recorder.active,let frame,frame.rgb.capturedAtMs-lastRecord>=200 {
            if recorder.append(frame) { lastRecord=frame.rgb.capturedAtMs }
        }
    }
    private func updateObjects(_ output:ObjectPresentation?) {
        guard automatic else {objects.clear();return}
        objectOutput=output;objectPresentationDirty=true
        guard let output else {objects.clear();range.text="— m";range.accessibilityLabel="Chưa đo";return}
        if let frame=output.frame {
            latest=frame
            if recorder.active,frame.rgb.capturedAtMs-lastRecord>=200 {
                if recorder.append(frame) {lastRecord=frame.rgb.capturedAtMs}
            }
        }
        updatePresentationTimer()
    }
    private func refreshDiagnostics() {
        guard let output=objectOutput else {return}
        guard let d=output.diag else {text(timings,fixtureMode ? "Mô phỏng UI · không phải phép đo hiệu năng":"Chưa có thống kê runtime");return}
        func percentile(_ value:Double?)->String {value.map {String(format:"%.0f ms",$0)} ?? "chưa có"}
        text(timings,"\(d.modelId) · \(d.phase)\nInference P50/P95: \(percentile(d.inference.p50Ms)) / \(percentile(d.inference.p95Ms)) (\(d.inference.sampleCount) mẫu)\nCapture→ready P95: \(percentile(d.captureReady.p95Ms)) · work P95: \(percentile(d.work.p95Ms))\nDetector \(d.detectorCalls) · tracker \(d.trackerCalls) · busy drops \(d.busyDrops) · retry skips \(d.retrySkips)\nLỗi \(d.failureCount) · depth lock pairs \(d.depthLockPairs) · metadata \(d.metadataProjections)"+(d.lastFailure.map {"\nLỗi gần nhất: \($0)"} ?? ""))
    }
    private func renderObjects(_ output:ObjectPresentation,nowMs:Double) {
        let tracks=output.tracks.filter {nowMs>=$0.lastSeenMs && nowMs-$0.lastSeenMs<=600 && nowMs-$0.lastDetectedAtMs<=3000 && ObjectBoxGeometry.displayBox($0.box,transform:output.transform) != nil}
        let expiry=tracks.map {"\($0.id):\(ObjectDisplayMetric.currentMetres($0,nowMs:nowMs) == nil):\(nowMs-$0.lastSeenMs>300)"}.sorted().joined(separator:"|")
        guard objectPresentationDirty || objectExpiryState != expiry else {return}
        objectPresentationDirty=false;objectExpiryState=expiry
        // The 30 Hz clock checks expiry; unchanged evidence does not incur a
        // duplicate render/label-layout pass. A fresh worker result or viewport
        // change marks graphics dirty. No old metric is retained by this cache.
        objects.show(tracks,transform:output.transform,nowMs:nowMs)
        let candidates=tracks.compactMap {t -> (ObjectTrack,Double)? in ObjectOverlay.currentRange(t,nowMs:nowMs).map {(t,$0)}}
        if let nearest=candidates.min(by:{$0.1<$1.1}) {
            text(range,ObjectDisplayMetric.text(nearest.1));range.accessibilityLabel=String(format:"≈%.1f mét tới bề mặt",nearest.1)
            text(status,"#\(nearest.0.id) · \(nearest.0.vietnameseLabel)\nGần nhất đã đo");status.textColor = .white
        } else {
            text(range,"— m");range.accessibilityLabel="Chưa đo";status.textColor=amber
            if let first=tracks.first {
                let stale=first.rangeCapturedAtMs.map {nowMs-$0>300} ?? false
                text(status,reason(stale ? "stale":first.range.reason,"\(first.vietnameseLabel) · chưa đủ dữ liệu đo"))
            } else {text(status,output.message)}
        }
    }
    private func render(_ result:ProbeResult,_ message:String) {
        text(range,ObjectDisplayMetric.text(result.metres))
        let accessibility=result.metres.map {String(format:"≈%.1f mét, chưa kiểm chứng vật lý",$0)} ?? "Chưa đo"
        if range.accessibilityLabel != accessibility { range.accessibilityLabel=accessibility }
        // Keep rapidly changing diagnostic age out of the main readout's layout.
        text(status,result.metres != nil ? "\(result.supportCount) điểm hỗ trợ\n\(message)" : reason(result.reason,message))
        status.textColor=result.metres == nil ? amber : .white
    }
    private func reason(_ key:String,_ fallback:String) -> String {
        let reasons=["tracking-limited":"Camera chưa có pose ổn định; di chuyển chậm để ARKit định vị.","no-depth":"Chưa có depth. Giữ camera ổn định, chọn bề mặt có ánh sáng.","no-foreground":"Chọn điểm và xác nhận vùng nằm trên bề mặt cần đo.","low-support":"Thiếu điểm depth tin cậy; chưa đo.","low-spatial-support":"Thiếu điểm trên bề mặt vật; chưa đo.","awaiting-current-depth":"Đang chờ depth cùng frame; chưa đo.","invalid-range":"Số đo không hợp lệ; chưa đo.","ambiguous-support":"Vùng trộn nhiều bề mặt; chưa đo.","transparent-surface":"Kính không có depth tin cậy; chưa đo.","tracking-lost":"Mất bám vật; không giữ số đo cũ.","outside-domain":"Ngoài vùng thử 0,5–5 m; chưa đo.","stale":"Dữ liệu cũ hơn 300 ms; chưa đo.","clock-future":"Clock camera không hợp lệ; chưa đo.","rgb-depth-skew":"RGB và depth không đồng bộ; chưa đo."]
        return reasons[key] ?? fallback
    }
    @objc private func consentChanged() { if !consent.isOn { clear() }; refreshControls() }
    @objc private func toggleRecord() {
        do {
            if recorder.active { recorder.stop() }
            else {
                guard let now=engine.liveNowMs else { return }
                try recorder.start(consent:consent.isOn,liveOriginMs:now); lastRecord = -1000
            }
            refreshControls()
        } catch { status.text="Xoá bản ghi cũ trước khi bắt đầu phiên mới." }
    }
    @objc private func addTruth() {
        guard !recorder.active,let binding=recorder.truthBinding,let f=recorder.frames.last,let t=f.targets.first else { return }
        let alert=UIAlertController(title:"Mốc thực cho frame \(f.id) / \(t.id)",message:"Nhập khoảng cách đo bằng thước từ camera tới điểm trên vật, đơn vị mét. Không nhập số dự đoán của app.",preferredStyle:.alert)
        alert.addTextField { $0.placeholder="Ví dụ 1,25"; $0.keyboardType = .decimalPad; $0.accessibilityIdentifier="truthInput" }
        for split in ["development","holdout"] {
            alert.addAction(UIAlertAction(title:split == "holdout" ? "Thước · kiểm định độc lập" : "Thước · phát triển",style:.default) { [weak self,weak alert] _ in
                guard let self,let text=alert?.textFields?.first?.text,let value=Double(text.replacingOccurrences(of:",",with:".")) else { self?.status.text="Số đo không hợp lệ; chưa lưu mốc."; return }
                do { try self.recorder.addTruth(metres:value,method:"tape",split:split,binding:binding); self.status.text="Đã gắn số đo thước vào frame \(f.id), không phải planned distance." } catch { self.status.text="Mốc không hợp lệ hoặc phiên đã đổi; chưa lưu." }
            })
        }
        alert.addAction(UIAlertAction(title:"Huỷ",style:.cancel)); present(alert,animated:true)
    }
    @objc private func share() {
        do {
            let snapshot=try recorder.snapshot()
            guard exporter.submit(snapshot,completion:{ [weak self] result in
                guard let self else { return }
                self.refreshControls()
                guard let result,self.view.window != nil,UIApplication.shared.applicationState == .active else { return }
                do { try self.presentExport(result.get()) }
                catch { self.cleanShare(); self.status.text="Không xuất được. Kiểm tra giới hạn JSON rồi thử lại." }
            }) else { return }
            refreshControls()
        } catch { cleanShare(); status.text="Không xuất được. Dừng ghi trước và kiểm tra giới hạn JSON." }
    }
    private func presentExport(_ data:Data) throws {
        guard presentedViewController == nil else { return }
        cleanShare()
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent("codex-tmp-tip64b1-export-"+UUID().uuidString,isDirectory:true)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:false)
        shareDirectory=directory
        let file=directory.appendingPathComponent("assistive-depth-recording.json"); try data.write(to:file,options:.atomic)
        let sheet=UIActivityViewController(activityItems:[file],applicationActivities:nil)
        sheet.popoverPresentationController?.sourceView=export
        sheet.completionWithItemsHandler={ [weak self] _,_,_,_ in self?.cleanShare() }
        present(sheet,animated:true)
    }
    private func cleanShare() { if let directory=shareDirectory { try? FileManager.default.removeItem(at:directory); shareDirectory=nil } }
    @objc fileprivate func clear() {
        exporter.cancel(); recorder.clear(); consent.isOn=false; latest=nil; selected=nil; pendingPresentation=nil; engine.select(nil); reticle.isHidden=true
        presentedViewController?.dismiss(animated:false); cleanShare()
        if !automatic {range.text="— m";range.accessibilityLabel="Chưa đo"};refreshControls()
    }
    func suspend() {
        engine.stop();fixtureRunning=false;fixtureConfirmed=false;objectOutput=nil;objects.clear();clear()
        range.text="— m";range.accessibilityLabel="Chưa đo";status.text="Đã dừng camera, xoá metadata và quyền ghi. Mở camera lại để bắt đầu.";refreshControls()
    }
    func resignActive() {
        // Do not cancel an initial system permission dialog; its callback still
        // checks foreground/epoch before starting. Already running capture stops.
        if cameraRunning { suspend() } else { clear() }
    }
    override func didReceiveMemoryWarning() {
        super.didReceiveMemoryWarning(); suspend();engine.releaseModelForMemoryPressure()
        status.text="Bộ nhớ thấp. Đã dừng camera và xoá bản ghi để tránh tăng tải."
    }
    // UI-only QA path is compiled out of physical-device builds. It cannot record
    // or export and carries a permanent synthetic watermark.
    private func setupFixture() {
        #if DEBUG && targetEnvironment(simulator)
        fixtureRunning = !objectFixture;fixtureStartSeconds=CACurrentMediaTime()
        if ProcessInfo.processInfo.arguments.contains("--qa-bright-background") {camera.backgroundColor = .white}
        status.text=automatic ? "Mô phỏng UI · bấm Mở camera":"Mô phỏng: chạm vùng camera rồi Đo vùng này. Không có cảm biến thật."
        let timer=Timer(timeInterval:0.1,repeats:true) { [weak self] _ in
            guard let self,self.fixtureRunning else { return }
            if self.automatic {
                guard self.objectFixture else { return };self.fixtureIndex+=1
                let now=(CACurrentMediaTime()-self.fixtureStartSeconds)*1000
                let ambiguous=ProcessInfo.processInfo.arguments.contains("--qa-object-ambiguous")
                let stale=ProcessInfo.processInfo.arguments.contains("--qa-object-stale") && self.fixtureIndex>40
                var tracks:[ObjectTrack]
                if stale {tracks=self.fixtureTracker.snapshot(nowMs:now)}
                else {
                    var detections=[ObjectDetection(label:"person",score:0.92,box:Rect(x:0.18,y:0.24,width:0.24,height:0.32)),ObjectDetection(label:"cell phone",score:0.88,box:Rect(x:0.57,y:0.30,width:0.15,height:0.21))]
                    if ProcessInfo.processInfo.arguments.contains("--qa-class-palette") {
                        let labels=["person","cell phone","remote","chair","book","bottle","refrigerator"]
                        detections=labels.enumerated().map {index,label in ObjectDetection(label:label,score:0.92,box:Rect(x:0.12+Double(index%2)*0.45,y:0.23+Double(index/2)*0.12,width:0.23,height:0.095))}
                    } else if ProcessInfo.processInfo.arguments.contains("--qa-object-dense") {
                        let labels=["person","cell phone","chair","book","bottle","laptop","tv","refrigerator","clock","cup","backpack","suitcase"]
                        detections=labels.enumerated().map {index,label in ObjectDetection(label:label,score:0.92,box:Rect(x:0.06+Double(index%4)*0.21,y:0.24+Double(index/4)*0.11,width:0.19,height:0.18))}
                    } else if ProcessInfo.processInfo.arguments.contains("--qa-object-edge") {
                        detections=[ObjectDetection(label:"person",score:0.92,box:Rect(x:0,y:0,width:0.08,height:0.16)),ObjectDetection(label:"cell phone",score:0.88,box:Rect(x:0.92,y:0.82,width:0.08,height:0.17))]
                    }
                    if ProcessInfo.processInfo.arguments.contains("--qa-object-jitter") {
                        let offset=sin(Double(self.fixtureIndex)*1.9)*0.003
                        detections=detections.map {ObjectDetection(label:$0.label,score:$0.score,box:Rect(x:$0.box.x+offset,y:$0.box.y-offset,width:$0.box.width,height:$0.box.height))}
                    }
                    tracks=self.fixtureTracker.update(detections,atMs:now)
                    let results=Dictionary(uniqueKeysWithValues:tracks.map {($0.id,ambiguous ? ProbeResult(reason:"ambiguous-support"):ProbeResult(metres:$0.label=="person" ? 2.01:2.45,reason:"approximate-bbox-surface",ageMs:0,supportCount:49))})
                    tracks=self.fixtureTracker.setRanges(results,capturedAtMs:now,nowMs:now)
                }
                self.updateObjects(ObjectPresentation(tracks:tracks,transform:Affine(a:1,b:0,c:0,d:1,tx:0,ty:0),frame:nil,nowMs:now,workMs:0,captureToReadyMs:0,message:stale ? "Mô phỏng stale · chưa đo":"Mô phỏng UI, không phải số đo vật lý"))
            } else {
                guard self.selected != nil,self.fixtureConfirmed else { return };self.fixtureIndex+=1
                if ProcessInfo.processInfo.arguments.contains("--qa-stale"),self.fixtureIndex>40 {self.fixtureConfirmed=false;self.update(nil,ProbeResult(reason:"stale"),"Mô phỏng stale");return}
                self.update(nil,ProbeResult(metres:2.01,reason:"supported",ageMs:35,supportCount:25),"Mô phỏng UI, không phải số đo vật lý")
            }
        }
        fixtureTimer=timer;RunLoop.main.add(timer,forMode:.common);refreshControls()
        #endif
    }
    deinit { heartbeat?.invalidate(); fixtureTimer?.invalidate(); exporter.cancel(); cleanShare() }
}
