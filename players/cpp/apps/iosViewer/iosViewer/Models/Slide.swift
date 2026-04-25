import Foundation

/// A single entry in a deck — either an RC document (bytes preloaded in
/// memory) or a video file (streamed from disk by AVFoundation).
/// Preloading RC bytes avoids a per-slide disk-read flash during navigation.
enum Slide: Hashable, Identifiable {
    case rc(URL, Data)
    case video(URL)

    var id: URL { url }

    var url: URL {
        switch self {
        case .rc(let u, _), .video(let u): return u
        }
    }

    var displayName: String { url.lastPathComponent }

    /// Extensions recognised in a deck, matching the C++ `rcviewer`.
    static let rcExtensions: Set<String> = ["rc", "rcd"]
    static let videoExtensions: Set<String> = ["mp4", "mov", "m4v", "webp", "gif", "apng"]
    static var playableExtensions: Set<String> { rcExtensions.union(videoExtensions) }

    /// Build a `Slide` from a file URL. RC files are read into memory so
    /// navigation between slides doesn't do disk I/O in the hot path. Returns
    /// `nil` if the extension isn't playable.
    static func from(url: URL) throws -> Slide? {
        let ext = url.pathExtension.lowercased()
        if rcExtensions.contains(ext) {
            let data = try Data(contentsOf: url)
            return .rc(url, data)
        }
        if videoExtensions.contains(ext) { return .video(url) }
        return nil
    }
}
