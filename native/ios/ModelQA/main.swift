import Foundation
import CoreML
import Vision
import ImageIO

// Independent Mac smoke runner. This is not linked into the iPhone app and its
// timings must never be reported as phone latency or physical range accuracy.
func describe(_ features:[String:MLFeatureDescription]) -> [[String:Any]] {
    features.sorted { $0.key < $1.key }.map { name,value in
        var description:[String:Any] = ["name":name,"type":String(describing:value.type)]
        if let image=value.imageConstraint { description["width"]=image.pixelsWide;description["height"]=image.pixelsHigh }
        if let array=value.multiArrayConstraint { description["shape"]=array.shape;description["dataType"]=String(describing:array.dataType) }
        return description
    }
}
func run() throws {
    let args=CommandLine.arguments
    guard args.count>=3 else { throw NSError(domain:"QA",code:1,userInfo:[NSLocalizedDescriptionKey:"Usage: model-qa compiled.mlmodelc photo.jpg [expected-class]"]) }
    let configuration=MLModelConfiguration();configuration.computeUnits = .all
    let start=ProcessInfo.processInfo.systemUptime
    let model=try MLModel(contentsOf:URL(fileURLWithPath:args[1]),configuration:configuration)
    let loaded=ProcessInfo.processInfo.systemUptime
    let vision=try VNCoreMLModel(for:model)
    // Match the shipping detector's NMS inputs and combined-confidence gate.
    // A looser smoke threshold would certify detections the app actually drops.
    let descriptor=ObjectModelDescriptor.shipping
    let description=model.modelDescription
    guard descriptor.valid,let input=description.inputDescriptionsByName[descriptor.imageInput],input.type == .image,
          input.imageConstraint?.pixelsWide==descriptor.imageWidth,input.imageConstraint?.pixelsHigh==descriptor.imageHeight,
          description.inputDescriptionsByName[descriptor.confidenceInput]?.type == .double,
          description.inputDescriptionsByName[descriptor.iouInput]?.type == .double,
          description.outputDescriptionsByName[descriptor.confidenceOutput]?.multiArrayConstraint?.shape.last?.intValue==descriptor.classCount,
          description.outputDescriptionsByName[descriptor.coordinateOutput]?.multiArrayConstraint?.shape.last?.intValue==4 else {throw NSError(domain:"QA",code:4,userInfo:[NSLocalizedDescriptionKey:"Actual model does not match the shipping descriptor"])}
    let confidenceThreshold=descriptor.confidenceThreshold,iouThreshold=descriptor.iouThreshold
    vision.featureProvider=try MLDictionaryFeatureProvider(dictionary:[descriptor.confidenceInput:confidenceThreshold,descriptor.iouInput:iouThreshold])
    let imageURL=URL(fileURLWithPath:args[2])
    guard let image=CGImageSourceCreateWithURL(imageURL as CFURL,nil),let cgImage=CGImageSourceCreateImageAtIndex(image,0,nil) else { throw NSError(domain:"QA",code:2,userInfo:[NSLocalizedDescriptionKey:"Cannot decode photo"]) }
    var durations=[Double]();var observations=[VNRecognizedObjectObservation]()
    for _ in 0..<3 {
        // A new handler/request prevents Vision caching the same request/image;
        // repeated cached completions are not meaningful inference durations.
        let request=VNCoreMLRequest(model:vision);request.imageCropAndScaleOption = .scaleFill
        let handler=VNImageRequestHandler(cgImage:cgImage,orientation:.up,options:[:])
        let began=ProcessInfo.processInfo.systemUptime
        try handler.perform([request])
        durations.append((ProcessInfo.processInfo.systemUptime-began)*1000)
        guard let found=request.results as? [VNRecognizedObjectObservation] else { throw NSError(domain:"QA",code:3,userInfo:[NSLocalizedDescriptionKey:"Vision results are not VNRecognizedObjectObservation"]) }
        observations=found
    }
    let detections:[[String:Any]]=observations.compactMap { observation in
        guard let label=observation.labels.first else { return nil }
        let b=observation.boundingBox
        let classification=Double(label.confidence),observationConfidence=Double(observation.confidence)
        // Apple's observation contract separates object-presence confidence
        // from conditional class confidence. A saturated label alone is not a
        // strongly supported detection; use their product, like live runtime.
        return ["label":label.identifier,"classificationConfidence":classification,"observationConfidence":observationConfidence,"combinedConfidence":classification*observationConfidence,"visionBottomLeftBox":[b.minX,b.minY,b.width,b.height]]
    }
    let expected=args.count>3 ? args[3] : "bird"
    let pass=observations.contains { observation in
        guard let label=observation.labels.first else { return false }
        return label.identifier==expected && Double(label.confidence)*Double(observation.confidence)>=confidenceThreshold
    }
    let metadata=model.modelDescription.metadata.reduce(into:[String:Any]()) { $0[$1.key.rawValue] = String(describing:$1.value) }
    let report:[String:Any]=["pass":pass,"schemaVersion":3,"confidencePolicy":"classificationConfidence * observationConfidence >= 0.38 for expected class","configuration":["confidenceThreshold":confidenceThreshold,"iouThreshold":iouThreshold,"cropAndScale":"scaleFill"],"platform":"Mac CoreML + Vision — NOT iPhone","expectedClass":expected,"modelLoadMs":(loaded-start)*1000,"macInferenceMs":durations,"imageWidth":cgImage.width,"imageHeight":cgImage.height,"modelInputs":describe(model.modelDescription.inputDescriptionsByName),"modelOutputs":describe(model.modelDescription.outputDescriptionsByName),"modelMetadata":metadata,"detections":detections,"phoneLatency":"NOT TESTED","physicalRangeAccuracy":"NOT TESTED","semanticRecall":"NOT MEASURED: one smoke photo"]
    let json=try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys])
    FileHandle.standardOutput.write(json);FileHandle.standardOutput.write(Data("\n".utf8))
    if !pass { exit(1) }
}
do { try run() } catch { fputs("Model smoke failed: \(error)\n",stderr);exit(1) }
