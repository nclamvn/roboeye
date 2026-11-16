import CoreML
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

// Standalone Mac baseline for M2. Nothing in this tool runs on iPhone or
// infers metric/temporal facts from a still image.
private struct QAError: LocalizedError {
    let text: String
    var errorDescription: String? { text }
    init(_ text: String) { self.text = text }
}

private struct Configuration: Encodable {
    let modelId: String
    let confidenceThreshold: Double
    let iouThreshold: Double
    let cropAndScale = "scaleFill"
    let computeUnits = "all"
    let coordinates = "EXIF-upright normalized top-left"
    let detectionTiming = "VNImageRequestHandler.perform only"
}

private struct Track: Encodable {
    let id: Int
    let label: String
    let score: Double
    let box: Rect
}

private struct ImageReport: Encodable {
    let path: String
    let width: Int
    let height: Int
    let rawWidth: Int
    let rawHeight: Int
    let orientation: UInt32
    let detectionMs: Double
    let tracks: [Track]
    let sceneOverview: String
    let peopleRight: String
}

private struct QAReport: Encodable {
    let schemaVersion = 1
    let platform = "macOS Core ML + Vision"
    let inputKind = "independent static JPEGs; no depth or temporal evidence"
    let modelLoadMs: Double
    let configuration: Configuration
    let images: [ImageReport]
}

private func nowSeconds() -> Double { ProcessInfo.processInfo.systemUptime }

private func loadVision(_ url: URL, descriptor: ObjectModelDescriptor) throws -> VNCoreMLModel {
    guard url.pathExtension == "mlmodelc" else { throw QAError("Expected a compiled .mlmodelc directory.") }
    let configuration = MLModelConfiguration()
    configuration.computeUnits = .all
    let model = try MLModel(contentsOf: url, configuration: configuration)
    let description = model.modelDescription
    // Same contract/gates as the native ObjectPipeline.
    guard descriptor.valid,
          let image = description.inputDescriptionsByName[descriptor.imageInput], image.type == .image,
          image.imageConstraint?.pixelsWide == descriptor.imageWidth,
          image.imageConstraint?.pixelsHigh == descriptor.imageHeight,
          description.inputDescriptionsByName[descriptor.confidenceInput]?.type == .double,
          description.inputDescriptionsByName[descriptor.iouInput]?.type == .double,
          description.outputDescriptionsByName[descriptor.confidenceOutput]?.multiArrayConstraint?.shape.last?.intValue == descriptor.classCount,
          description.outputDescriptionsByName[descriptor.coordinateOutput]?.multiArrayConstraint?.shape.last?.intValue == 4 else {
        throw QAError("Core ML artifact does not match the shipping YOLOv3 descriptor.")
    }
    let vision = try VNCoreMLModel(for: model)
    vision.featureProvider = try MLDictionaryFeatureProvider(dictionary: [
        descriptor.confidenceInput: descriptor.confidenceThreshold,
        descriptor.iouInput: descriptor.iouThreshold
    ])
    return vision
}

private func analyze(_ pathname: String, vision: VNCoreMLModel, descriptor: ObjectModelDescriptor) throws -> ImageReport {
    let url = URL(fileURLWithPath: pathname)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let type = CGImageSourceGetType(source), UTType(type as String)?.conforms(to: .jpeg) == true,
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
          let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
          width > 1, height > 1, width <= 16_384, height <= 16_384, width * height <= 50_000_000 else {
        throw QAError("Cannot read bounded JPEG metadata: \(pathname)")
    }
    // EXIF orientations 5–8 swap dimensions, including mirrored rotations.
    let rawOrientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.uint32Value ?? 1
    guard let orientation = CGImagePropertyOrientation(rawValue: rawOrientation),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          image.width == width, image.height == height else {
        throw QAError("Cannot decode a supported JPEG/orientation: \(pathname)")
    }
    let swapsAxes = rawOrientation >= 5
    let request = VNCoreMLRequest(model: vision)
    request.imageCropAndScaleOption = .scaleFill
    let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
    let start = nowSeconds()
    try handler.perform([request])
    let detectionMs = (nowSeconds() - start) * 1_000
    guard let raw = request.results, raw.allSatisfy({ $0 is VNRecognizedObjectObservation }) else {
        throw QAError("Unexpected Vision output for \(pathname)")
    }
    let detections = raw.compactMap { $0 as? VNRecognizedObjectObservation }.compactMap { observation -> ObjectDetection? in
        guard let label = observation.labels.first else { return nil }
        let confidence = Double(label.confidence) * Double(observation.confidence)
        let rect = observation.boundingBox
        // Vision's normalized boxes refer to the oriented image supplied by
        // the handler. Convert only the Y origin here (identity display).
        guard confidence.isFinite, confidence >= descriptor.confidenceThreshold, confidence <= 1,
              let box = ObjectBoxGeometry.rawNormalizedBox(fromVision: Rect(
                x: rect.minX, y: rect.minY, width: rect.width, height: rect.height)) else { return nil }
        return ObjectDetection(label: label.identifier, score: confidence, box: box)
    }
    var tracker = ObjectTracker()
    let tracks = tracker.update(detections, atMs: 0).filter { !$0.isCoasting }
    var scene = SceneNarration()
    scene.observe(tracks: tracks, transform: Affine(a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0), nowMs: 0)
    return ImageReport(path: pathname, width: swapsAxes ? height : width, height: swapsAxes ? width : height,
                       rawWidth: width, rawHeight: height, orientation: rawOrientation, detectionMs: detectionMs,
                       tracks: tracks.map { Track(id: $0.id, label: $0.label, score: $0.score, box: $0.box) },
                       sceneOverview: scene.answer(.overview, nowMs: 0), peopleRight: scene.answer(.peopleRight, nowMs: 0))
}

private func run() throws {
    let args = CommandLine.arguments
    guard args.count >= 3, args.count <= 66 else {
        throw QAError("Usage: sceneqa <compiled-model.mlmodelc> <image.jpg> [image.jpg ...] (maximum 64 images)")
    }
    let descriptor = ObjectModelDescriptor.shipping
    let loadStart = nowSeconds()
    let vision = try loadVision(URL(fileURLWithPath: args[1]), descriptor: descriptor)
    let modelLoadMs = (nowSeconds() - loadStart) * 1_000
    let images = try args.dropFirst(2).map { path in
        try autoreleasepool { try analyze(path, vision: vision, descriptor: descriptor) }
    }
    let report = QAReport(modelLoadMs: modelLoadMs,
                          configuration: Configuration(modelId: descriptor.id,
                                                       confidenceThreshold: descriptor.confidenceThreshold,
                                                       iouThreshold: descriptor.iouThreshold),
                          images: images)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    FileHandle.standardOutput.write(try encoder.encode(report))
    FileHandle.standardOutput.write(Data("\n".utf8))
}

do {
    try run()
} catch {
    fputs("SceneQA: \(error.localizedDescription)\n", stderr)
    exit(1)
}
