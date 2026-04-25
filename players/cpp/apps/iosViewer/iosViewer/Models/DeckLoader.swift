import Foundation
import ZIPFoundation

/// Loads `Deck`s from zip archives or single files.
///
/// Zip archives are unzipped into a unique subdirectory of
/// `NSTemporaryDirectory()`, then all playable entries are enumerated
/// (depth-first) and sorted alphabetically by path — matching the C++
/// `rcviewer` ordering.
enum DeckLoader {
    enum LoadError: LocalizedError {
        case unsupportedExtension(String)
        case emptyArchive
        case ioFailure(String)

        var errorDescription: String? {
            switch self {
            case .unsupportedExtension(let ext):
                return "Unsupported file type: .\(ext)"
            case .emptyArchive:
                return "Archive contains no RC or video files"
            case .ioFailure(let m): return m
            }
        }
    }

    /// Load a `Deck` from any supported URL. Zip archives are unzipped; single
    /// `.rc`/`.rcd` files are wrapped in a one-slide deck.
    static func load(from url: URL) async throws -> Deck {
        let needsStop = url.startAccessingSecurityScopedResource()
        defer { if needsStop { url.stopAccessingSecurityScopedResource() } }

        let ext = url.pathExtension.lowercased()
        let title = url.deletingPathExtension().lastPathComponent

        if ext == "zip" {
            return try await loadZip(url: url, title: title)
        }
        if let slide = try Slide.from(url: url) {
            return Deck(title: title, slides: [slide], ownedTempDirectory: nil)
        }
        throw LoadError.unsupportedExtension(ext)
    }

    // MARK: - Zip

    private static func loadZip(url: URL, title: String) async throws -> Deck {
        let destination = uniqueTempDirectory(prefix: "deck-")
        try FileManager.default.createDirectory(
            at: destination, withIntermediateDirectories: true)

        // Unzip on a background queue so the main thread stays responsive.
        try await Task.detached(priority: .userInitiated) {
            do {
                try FileManager.default.unzipItem(at: url, to: destination)
            } catch {
                throw LoadError.ioFailure("Unzip failed: \(error.localizedDescription)")
            }
        }.value

        let slides = try enumerateSlides(root: destination)
        if slides.isEmpty {
            try? FileManager.default.removeItem(at: destination)
            throw LoadError.emptyArchive
        }
        return Deck(title: title, slides: slides, ownedTempDirectory: destination)
    }

    /// Recursively walk `root`, collect all files whose extension is playable,
    /// and sort by path (case-insensitive, matches C++ viewer's alphabetical
    /// sort so `01_…` comes before `02_…`).
    private static func enumerateSlides(root: URL) throws -> [Slide] {
        guard let en = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }
        var entries: [URL] = []
        for case let fileURL as URL in en {
            let rvs = try fileURL.resourceValues(forKeys: [.isRegularFileKey])
            guard rvs.isRegularFile == true else { continue }
            let ext = fileURL.pathExtension.lowercased()
            if Slide.playableExtensions.contains(ext) {
                entries.append(fileURL)
            }
        }
        entries.sort { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
        return try entries.compactMap { try Slide.from(url: $0) }
    }

    // MARK: - Temp dir

    private static func uniqueTempDirectory(prefix: String) -> URL {
        let base = FileManager.default.temporaryDirectory
        return base.appendingPathComponent("\(prefix)\(UUID().uuidString)",
                                           isDirectory: true)
    }
}
