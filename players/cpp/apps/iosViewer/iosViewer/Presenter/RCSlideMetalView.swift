import SwiftUI
import MetalKit

/// GPU-backed RC slide view. Wraps an `MTKView` whose delegate calls into
/// `RCMetalRenderer` each frame; Skia's Metal backend paints straight into
/// the drawable's texture — no per-frame pixel readback.
struct RCSlideMetalView: UIViewRepresentable {
    let fileData: Data

    func makeCoordinator() -> Coordinator { Coordinator(fileData: fileData) }

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero, device: context.coordinator.device)
        view.framebufferOnly = false    // Skia needs to write-read the drawable
        view.colorPixelFormat = .bgra8Unorm
        view.clearColor = MTLClearColorMake(0, 0, 0, 1)
        view.isOpaque = true
        view.enableSetNeedsDisplay = false
        view.isPaused = false
        view.preferredFramesPerSecond = 60
        view.autoResizeDrawable = true
        view.delegate = context.coordinator
        view.isMultipleTouchEnabled = false

        context.coordinator.attach(view: view)

        let pan = UIPanGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handlePan(_:)))
        pan.maximumNumberOfTouches = 1
        view.addGestureRecognizer(pan)

        let tap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap(_:)))
        view.addGestureRecognizer(tap)

        return view
    }

    func updateUIView(_ view: MTKView, context: Context) {
        context.coordinator.update(fileData: fileData)
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, MTKViewDelegate {
        let device: MTLDevice
        private let queue: MTLCommandQueue
        private let renderer: RCMetalRenderer
        private weak var view: MTKView?

        private var fileData: Data
        private var needsLoad = true
        private var animTime: Double = 0
        private var lastTimestamp: CFTimeInterval = 0

        init(fileData: Data) {
            self.fileData = fileData
            guard let device = MTLCreateSystemDefaultDevice() else {
                fatalError("[RCSlideMetalView] Metal device not available")
            }
            guard let queue = device.makeCommandQueue() else {
                fatalError("[RCSlideMetalView] Command queue creation failed")
            }
            self.device = device
            self.queue = queue
            guard let r = RCMetalRenderer(device: device, commandQueue: queue) else {
                fatalError("[RCSlideMetalView] GrDirectContext creation failed")
            }
            self.renderer = r
        }

        func attach(view: MTKView) { self.view = view }

        func update(fileData: Data) {
            if fileData != self.fileData {
                self.fileData = fileData
                needsLoad = true
                animTime = 0
                lastTimestamp = 0
            }
        }

        private func ensureLoaded() {
            guard needsLoad else { return }
            needsLoad = false
            if !renderer.loadFileData(fileData) {
                print("[RCSlideMetalView] Failed to parse .rc (\(fileData.count) bytes)")
            }
        }

        // MARK: MTKViewDelegate

        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
            // Renderer rebuilds its RemoteContext on drawable size changes.
        }

        func draw(in view: MTKView) {
            ensureLoaded()
            guard view.currentDrawable != nil else { return }

            let now = CACurrentMediaTime()
            let dt: Double
            if lastTimestamp == 0 {
                dt = 1.0 / 60.0
            } else {
                dt = now - lastTimestamp
            }
            lastTimestamp = now
            animTime += dt

            renderer.draw(in: view, animTime: animTime, deltaTime: dt)
        }

        // MARK: Gestures

        @objc func handleTap(_ g: UITapGestureRecognizer) {
            guard let view = view else { return }
            let p = g.location(in: view)
            let d = mapToDoc(p, view: view.bounds.size)
            renderer.sendTouchDownX(d.x, y: d.y)
            renderer.sendTouchUpX(d.x, y: d.y, velX: 0, velY: 0)
        }

        @objc func handlePan(_ g: UIPanGestureRecognizer) {
            guard let view = view else { return }
            let p = g.location(in: view)
            let d = mapToDoc(p, view: view.bounds.size)
            switch g.state {
            case .began:
                renderer.sendTouchDownX(d.x, y: d.y)
            case .changed:
                renderer.sendTouchDragX(d.x, y: d.y)
            case .ended, .cancelled, .failed:
                let v = g.velocity(in: view)
                let dv = mapVec(v, view: view.bounds.size)
                renderer.sendTouchUpX(d.x, y: d.y, velX: dv.x, velY: dv.y)
            default: break
            }
        }

        /// View-space point → document pixel coords (aspect-fit letterbox
        /// matches what RCMetalRenderer does internally via translate+scale).
        private func mapToDoc(_ p: CGPoint, view: CGSize) -> (x: Float, y: Float) {
            let doc = renderer.documentSize()
            guard doc.width > 0, doc.height > 0 else {
                return (Float(p.x), Float(p.y))
            }
            let scale = min(view.width / doc.width, view.height / doc.height)
            let fitW = doc.width * scale
            let fitH = doc.height * scale
            let ox = (view.width - fitW) / 2
            let oy = (view.height - fitH) / 2
            return (Float((p.x - ox) / scale), Float((p.y - oy) / scale))
        }

        private func mapVec(_ v: CGPoint, view: CGSize) -> (x: Float, y: Float) {
            let doc = renderer.documentSize()
            guard doc.width > 0, doc.height > 0 else {
                return (Float(v.x), Float(v.y))
            }
            let scale = min(view.width / doc.width, view.height / doc.height)
            return (Float(v.x / scale), Float(v.y / scale))
        }
    }
}
