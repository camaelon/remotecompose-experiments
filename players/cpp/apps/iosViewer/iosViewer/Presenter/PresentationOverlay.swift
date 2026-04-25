import SwiftUI
import UIKit

/// Full-bleed input surface used in presentation mode. Intercepts **all**
/// touches so the underlying slide view (MTKView / AVPlayerLayer) never sees
/// them. Tap in the left half = prev, right half = next; any swipe exits
/// back to regular mode.
struct PresentationOverlay: UIViewRepresentable {
    var onPrev:   () -> Void
    var onNext:   () -> Void
    var onExit:   () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onPrev: onPrev, onNext: onNext, onExit: onExit)
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = true

        let tap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap(_:)))
        view.addGestureRecognizer(tap)

        // One recognizer per direction. A swipe — in any direction — exits
        // presentation mode. Taps still fire (they're a different recognizer).
        for dir in [UISwipeGestureRecognizer.Direction.up,
                    .down, .left, .right] {
            let swipe = UISwipeGestureRecognizer(
                target: context.coordinator,
                action: #selector(Coordinator.handleSwipe))
            swipe.direction = dir
            view.addGestureRecognizer(swipe)
        }
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.onPrev = onPrev
        context.coordinator.onNext = onNext
        context.coordinator.onExit = onExit
    }

    final class Coordinator: NSObject {
        var onPrev: () -> Void
        var onNext: () -> Void
        var onExit: () -> Void

        init(onPrev: @escaping () -> Void,
             onNext: @escaping () -> Void,
             onExit: @escaping () -> Void) {
            self.onPrev = onPrev
            self.onNext = onNext
            self.onExit = onExit
        }

        @objc func handleTap(_ g: UITapGestureRecognizer) {
            guard let v = g.view else { return }
            let x = g.location(in: v).x
            if x < v.bounds.width / 2 { onPrev() } else { onNext() }
        }

        @objc func handleSwipe() { onExit() }
    }
}
