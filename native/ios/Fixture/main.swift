import Foundation
import AssistiveCore

// Contract interoperability fixture, never a physical-device capture.
let mode=CommandLine.arguments.dropFirst().first ?? "synthetic"
let samples: [SupportSample]=(0..<25).map { i in
    let u=Double(408+i%5), v=Double(238+i/5)
    return SupportSample(u:u,v:v,value:2,confidence:1)
}
let depth=Depth(captureId:"fixture-depth-1",capturedAtMs:0,samples:samples)
let target=SurfaceTarget(box:Rect(x:408,y:238,width:4,height:4),associated:true,sampleIndices:Array(0..<25))
var f=ProbeFrame(id:1,rgb:RGB(capturedAtMs:0,readyAtMs:35,width:640,height:480),display:Presentation(crop:Rect(x:80,y:40,width:500,height:400),rotation:90),intrinsics:Calibration(fx:500,fy:500,cx:320,cy:240),cameraToWorld:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],depth:depth,targets:[target])
if mode == "nulls" { f.depth=nil; f.intrinsics=nil; f.cameraToWorld=nil; f.targets=[] }
if mode == "low" { f.depth!.samples[0].confidence=0.5; f.targets[0].support="bbox-only" }
if mode == "float" { f.rgb.capturedAtMs=0.000001; f.rgb.readyAtMs=1.0000001; f.depth!.capturedAtMs=0.000001; f.depth!.samples[0].u=408.00000000000006 }
if mode == "objects" || mode == "objects-empty" {
    // Exercise the EXACT projection called by ObjectPipeline, not a handcrafted
    // already-valid manual packet. These remain fixtures, never hardware proof.
    let labels=["person","chair","bottle","cellphone","book","car","refrigerator","cup","pottedplant","truck","tvmonitor","motorbike"]
    let inputs=labels.enumerated().map { item -> ObjectRecordingInput in
        let i=item.offset,r=Rect(x:0.02+Double(i%4)*0.24,y:0.02+Double(i/4)*0.30,width:0.18,height:0.24)
        let full:[SupportSample]=(0..<64).map {j in
            SupportSample(u:(r.x+r.width*(0.2+0.6*(Double(j%8)+0.5)/8))*640,
                          v:(r.y+r.height*(0.2+0.6*(Double(j/8)+0.5)/8))*480,value:2,confidence:1)
        }
        return ObjectRecordingInput(id:i+1,label:item.element,score:0.9,box:r,samples:mode == "objects-empty" ? []:full)
    }
    let projected=ObjectExportProjection.project(inputs,imageWidth:640,imageHeight:480)
    f.targets=projected.targets
    f.depth=mode == "objects-empty" ? nil:Depth(captureId:"fixture-objects-depth",capturedAtMs:0,samples:projected.samples)
}
var recording=ProbeRecording(id:"contract-fixture",createdUtc:"2026-10-10T00:00:00.000Z",frames:[f],truth:[],counters:RecordCounters(rejectedFrames:0,stopReason:"user"))
if mode == "synthetic" { recording.origin="synthetic-fixture"; recording.frames[0].provider="fixture"; recording.frames[0].rgb.timestampBasis="synthetic"; recording.frames[0].depth!.provenance="synthetic" }
FileHandle.standardOutput.write(try EnvelopeWriter.export(recording))
