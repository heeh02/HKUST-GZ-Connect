import AppKit
import Foundation

private let expectedLayers: Set<String> = [
    "icon_16x16.png",
    "icon_16x16@2x.png",
    "icon_32x32.png",
    "icon_32x32@2x.png",
    "icon_128x128.png",
    "icon_128x128@2x.png",
    "icon_256x256.png",
    "icon_256x256@2x.png",
    "icon_512x512.png",
    "icon_512x512@2x.png",
]

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("macOS icon verification failed: \(message)\n".utf8))
    exit(1)
}

guard CommandLine.arguments.count == 2 else { fail("one ICNS path is required") }
let source = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
guard source.pathExtension == "icns",
      FileManager.default.fileExists(atPath: source.path) else {
    fail("ICNS file is missing")
}

let temporary = FileManager.default.temporaryDirectory
    .appendingPathComponent("campus-connect-icon-\(UUID().uuidString)", isDirectory: true)
let iconset = temporary.appendingPathComponent("icon.iconset", isDirectory: true)
defer { try? FileManager.default.removeItem(at: temporary) }

do { try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: false) }
catch { fail("temporary directory could not be created") }

let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "iconset", source.path, "-o", iconset.path]
let diagnostics = Pipe()
process.standardOutput = diagnostics
process.standardError = diagnostics
do { try process.run() } catch { fail("iconutil could not start") }
process.waitUntilExit()
if process.terminationStatus != 0 { fail("iconutil rejected the ICNS file") }

let files: [URL]
do { files = try FileManager.default.contentsOfDirectory(at: iconset, includingPropertiesForKeys: nil) }
catch { fail("iconset output could not be read") }
let names = Set(files.map(\.lastPathComponent))
guard names == expectedLayers else { fail("ICNS layer set is incomplete") }

for file in files {
    guard let data = try? Data(contentsOf: file),
          let image = NSBitmapImageRep(data: data),
          image.pixelsWide > 0, image.pixelsHigh > 0 else {
        fail("\(file.lastPathComponent) is not a readable PNG layer")
    }
    let width = image.pixelsWide
    let height = image.pixelsHigh
    let corners = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    if corners.contains(where: {
        (image.colorAt(x: $0.0, y: $0.1)?.alphaComponent ?? 1) > 0.01
    }) {
        fail("\(file.lastPathComponent) has an opaque corner")
    }
    if (image.colorAt(x: width / 2, y: height / 2)?.alphaComponent ?? 0) < 0.99 {
        fail("\(file.lastPathComponent) has an empty center")
    }
}

print("macOS icon verification passed: \(files.count) transparent-corner layers")
