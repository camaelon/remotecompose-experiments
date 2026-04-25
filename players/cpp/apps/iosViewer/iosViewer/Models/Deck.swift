import Foundation

/// An ordered collection of `Slide`s drawn from either a zip archive
/// (unzipped into `ownedTempDirectory`) or a single standalone file.
final class Deck: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let slides: [Slide]

    /// If set, the directory is owned by this Deck and recursively removed on
    /// deinit. Zip decks own their temp dir; single-file decks do not.
    private let ownedTempDirectory: URL?

    init(title: String, slides: [Slide], ownedTempDirectory: URL? = nil) {
        self.title = title
        self.slides = slides
        self.ownedTempDirectory = ownedTempDirectory
    }

    deinit {
        if let dir = ownedTempDirectory {
            try? FileManager.default.removeItem(at: dir)
        }
    }

    static func == (lhs: Deck, rhs: Deck) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
