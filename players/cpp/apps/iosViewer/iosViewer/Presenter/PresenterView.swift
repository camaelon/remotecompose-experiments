import SwiftUI

/// Hosts a `Deck` and drives slide navigation. Two distinct modes:
///
/// - **Regular mode** — toolbar always visible with prev/next chevrons and a
///   Present button. The slide receives normal touch input (forwarded to the
///   RC runtime for interactive docs).
/// - **Presentation mode** — chrome hidden, full-bleed slide. A transparent
///   `PresentationOverlay` intercepts all touches: tap left half = prev, tap
///   right half = next, any swipe exits back to regular mode.
struct PresenterView: View {
    @StateObject private var state: PresenterState
    @Environment(\.dismiss) private var dismiss

    init(deck: Deck) {
        _state = StateObject(wrappedValue: PresenterState(deck: deck))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            currentSlide
            if state.isPresenting {
                PresentationOverlay(
                    onPrev: state.prev,
                    onNext: state.next,
                    onExit: { state.isPresenting = false }
                )
                .ignoresSafeArea()
            }
        }
        .statusBar(hidden: state.isPresenting)
        .persistentSystemOverlays(state.isPresenting ? .hidden : .automatic)
        .toolbar(state.isPresenting ? .hidden : .visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("\(state.currentIndex + 1) / \(state.deck.slides.count)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.primary)
            }
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                Button { state.prev() } label: {
                    Image(systemName: "chevron.left")
                }
                .disabled(!state.canGoPrev)
                Button { state.next() } label: {
                    Image(systemName: "chevron.right")
                }
                .disabled(!state.canGoNext)
                Button { state.isPresenting = true } label: {
                    Image(systemName: "play.rectangle")
                }
            }
        }
        .navigationTitle(state.deck.title)
        .navigationBarTitleDisplayMode(.inline)
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(.rightArrow) { state.next(); return .handled }
        .onKeyPress(.leftArrow)  { state.prev(); return .handled }
        .onKeyPress(.space)      { state.next(); return .handled }
        .onKeyPress(.escape) {
            if state.isPresenting { state.isPresenting = false; return .handled }
            return .ignored
        }
    }

    @ViewBuilder
    private var currentSlide: some View {
        switch state.currentSlide {
        case .rc(_, let data):
            RCSlideMetalView(fileData: data)
        case .video(let url):
            VideoSlideView(url: url)
        }
    }
}

@MainActor
final class PresenterState: ObservableObject {
    let deck: Deck
    @Published var currentIndex: Int = 0
    @Published var isPresenting: Bool = false

    init(deck: Deck) { self.deck = deck }

    var currentSlide: Slide { deck.slides[currentIndex] }
    var canGoPrev: Bool { currentIndex > 0 }
    var canGoNext: Bool { currentIndex < deck.slides.count - 1 }

    func prev() { if canGoPrev { currentIndex -= 1 } }
    func next() { if canGoNext { currentIndex += 1 } }
}
