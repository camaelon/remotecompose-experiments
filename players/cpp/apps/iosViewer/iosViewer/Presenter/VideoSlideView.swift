import SwiftUI
import AVFoundation

/// Plays a video file looped + muted, handling rotation metadata manually.
///
/// `AVPlayer` / `AVPlayerLayer` / `AVPlayerViewController` / `AVVideoComposition`
/// all fail to apply the H.264 SEI rotation tag (`rotation=-90`) that modern
/// iPhone captures embed, so we read the track's `preferredTransform`, derive
/// the rotation angle, and apply it to the `AVPlayerLayer` directly via
/// `CGAffineTransform`.
///
/// When the content aspect and host aspect differ substantially (e.g. a
/// portrait-oriented video in a landscape slide area), the layer is sized via
/// aspect-fill math so the rotated content fills the screen; otherwise
/// aspect-fit is used so both dimensions are visible.
struct VideoSlideView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIView(context: Context) -> PlayerContainerView {
        let view = PlayerContainerView()
        view.backgroundColor = .black
        view.attach(player: context.coordinator.player)
        context.coordinator.displayConfig = { [weak view] angle, natural in
            view?.configureDisplay(rotation: angle, naturalSize: natural)
        }
        return view
    }

    func updateUIView(_ view: PlayerContainerView, context: Context) {
        context.coordinator.update(url: url)
    }

    static func dismantleUIView(_ view: PlayerContainerView,
                                coordinator: Coordinator) {
        coordinator.tearDown()
    }

    /// Container view that hosts the AVPlayerLayer as a sublayer (not the
    /// backing layer), so we can freely resize and rotate the player-layer
    /// without the geometry looping back into the view's own bounds.
    final class PlayerContainerView: UIView {
        let playerLayer = AVPlayerLayer()

        private var naturalRotation: CGFloat = 0
        private var naturalSize: CGSize = .zero

        override init(frame: CGRect) {
            super.init(frame: frame)
            layer.addSublayer(playerLayer)
        }
        required init?(coder: NSCoder) { fatalError() }

        func attach(player: AVPlayer) {
            playerLayer.videoGravity = .resizeAspect
            playerLayer.player = player
        }

        func configureDisplay(rotation: CGFloat, naturalSize: CGSize) {
            self.naturalRotation = rotation
            self.naturalSize = naturalSize
            setNeedsLayout()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            CATransaction.begin()
            CATransaction.setDisableActions(true)

            if naturalSize == .zero {
                playerLayer.setAffineTransform(.identity)
                playerLayer.bounds = bounds
                playerLayer.position = CGPoint(x: bounds.midX, y: bounds.midY)
                CATransaction.commit()
                return
            }

            let swap = abs(sin(naturalRotation)) > 0.5
            let contentSize = swap
                ? CGSize(width: naturalSize.height, height: naturalSize.width)
                : naturalSize
            let contentAspect = contentSize.width / contentSize.height
            let hostAspect = bounds.width / bounds.height
            // When the content and host have very different aspects (e.g.
            // portrait content in a landscape screen), aspect-fit leaves a
            // narrow rectangle with big side bars. Switch to aspect-fill so
            // the rotated content fills the screen (cropping top/bottom).
            let mismatched = abs(contentAspect - hostAspect) > 0.4
            let useFill = mismatched

            let scale: CGFloat
            if useFill {
                scale = max(bounds.width / contentSize.width,
                            bounds.height / contentSize.height)
            } else {
                scale = min(bounds.width / contentSize.width,
                            bounds.height / contentSize.height)
            }
            let w = contentSize.width * scale
            let h = contentSize.height * scale
            let preRotW = swap ? h : w
            let preRotH = swap ? w : h

            playerLayer.setAffineTransform(.identity)
            playerLayer.videoGravity = .resizeAspect   // fill happens via layer bounds, not gravity
            playerLayer.bounds = CGRect(x: 0, y: 0, width: preRotW, height: preRotH)
            playerLayer.position = CGPoint(x: bounds.midX, y: bounds.midY)
            playerLayer.setAffineTransform(CGAffineTransform(rotationAngle: naturalRotation))

            // Clip overflow when the rotated layer exceeds the host bounds
            // (aspect-fill case pushes the layer beyond the visible area).
            clipsToBounds = useFill

            CATransaction.commit()
        }
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject {
        let player: AVPlayer
        private var currentURL: URL
        private var loopObserver: NSObjectProtocol?
        private var installTask: Task<Void, Never>?

        init(url: URL) {
            self.currentURL = url
            self.player = AVPlayer()
            self.player.isMuted = true
            super.init()
            installTask = Task { [weak self] in await self?.install(url: url) }
        }

        deinit {
            if let loopObserver {
                NotificationCenter.default.removeObserver(loopObserver)
            }
        }

        func update(url: URL) {
            guard url != currentURL else { return }
            currentURL = url
            installTask?.cancel()
            installTask = Task { [weak self] in await self?.install(url: url) }
        }

        @MainActor
        private func install(url: URL) async {
            let asset = AVURLAsset(url: url)
            let item = AVPlayerItem(asset: asset)

            if let old = loopObserver {
                NotificationCenter.default.removeObserver(old)
            }
            loopObserver = NotificationCenter.default.addObserver(
                forName: .AVPlayerItemDidPlayToEndTime,
                object: item,
                queue: .main
            ) { [weak self] _ in
                self?.player.seek(to: .zero)
                self?.player.play()
            }
            player.replaceCurrentItem(with: item)
            player.play()

            // `preferredTransform` maps source pixels → display pixels.
            // Applied to a UIView (destination space) the direction flips,
            // so negate the angle.
            if let tracks = try? await asset.loadTracks(withMediaType: .video),
               let track = tracks.first,
               let transform = try? await track.load(.preferredTransform),
               let natural = try? await track.load(.naturalSize) {
                let angle: CGFloat = -atan2(transform.b, transform.a)
                displayConfig?(angle, natural)
            }
        }

        /// Set by `makeUIView`; forwards rotation + natural size into the
        /// container view once the asset's metadata is loaded.
        var displayConfig: ((CGFloat, CGSize) -> Void)?

        func tearDown() {
            player.pause()
            player.replaceCurrentItem(with: nil)
            if let loopObserver {
                NotificationCenter.default.removeObserver(loopObserver)
                self.loopObserver = nil
            }
        }
    }
}
