import Foundation
import ImageIO
import Vision

struct Observation: Encodable {
  let text: String
  let minX: Double
  let minY: Double
  let maxX: Double
  let maxY: Double
  let midX: Double
  let midY: Double
  let width: Double
  let height: Double
}

func loadImage(from path: String) -> CGImage? {
  let url = URL(fileURLWithPath: path)
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(source, 0, nil)
}

guard CommandLine.arguments.count >= 2 else {
  fputs("Missing image path\n", stderr)
  exit(1)
}

let arguments = Array(CommandLine.arguments.dropFirst())
let outputJSON = arguments.contains("--json")
guard let path = arguments.first(where: { !$0.hasPrefix("--") }) else {
  fputs("Missing image path\n", stderr)
  exit(1)
}

guard let image = loadImage(from: path) else {
  fputs("Couldn't open image\n", stderr)
  exit(1)
}

var recognized = ""
var observationsPayload: [Observation] = []
let request = VNRecognizeTextRequest { request, error in
  if let error {
    fputs("Vision OCR failed: \(error.localizedDescription)\n", stderr)
    exit(1)
  }

  let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
  let sorted = observations.sorted {
    let leftY = $0.boundingBox.midY
    let rightY = $1.boundingBox.midY
    if abs(leftY - rightY) > 0.03 { return leftY > rightY }
    return $0.boundingBox.minX < $1.boundingBox.minX
  }

  recognized = sorted
    .compactMap { $0.topCandidates(1).first?.string }
    .joined(separator: "\n")

  observationsPayload = sorted.compactMap { observation in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    return Observation(
      text: candidate.string,
      minX: box.minX,
      minY: box.minY,
      maxX: box.maxX,
      maxY: box.maxY,
      midX: box.midX,
      midY: box.midY,
      width: box.width,
      height: box.height
    )
  }
}

request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["en-US"]
request.minimumTextHeight = 0.012

do {
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  try handler.perform([request])
  if outputJSON {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    let data = try encoder.encode(observationsPayload)
    if let json = String(data: data, encoding: .utf8) {
      print(json)
    }
  } else {
    print(recognized.trimmingCharacters(in: .whitespacesAndNewlines))
  }
} catch {
  fputs("Vision OCR failed: \(error.localizedDescription)\n", stderr)
  exit(1)
}
