import SwiftUI
import UniformTypeIdentifiers

/// Entry screen. Picks a `.zip` deck or a single `.rc`/`.rcd` file, loads it
/// into a `Deck`, and pushes the presenter.
struct ContentView: View {
    @State private var showImporter = false
    @State private var pendingURL: URL?
    @State private var deck: Deck?
    @State private var loadStatus: LoadStatus = .idle

    enum LoadStatus: Equatable {
        case idle
        case loading
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Image(systemName: "square.stack.3d.up")
                    .font(.system(size: 72, weight: .light))
                    .foregroundStyle(.secondary)
                Text("RemoteCompose Viewer")
                    .font(.title2.weight(.semibold))
                Text("Open a .zip deck or a single .rc slide.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)

                Button {
                    showImporter = true
                } label: {
                    Label("Open deck…", systemImage: "doc.badge.plus")
                        .font(.body.weight(.semibold))
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .disabled(loadStatus == .loading)

                switch loadStatus {
                case .loading:
                    ProgressView("Unzipping…")
                case .failed(let message):
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                case .idle:
                    EmptyView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .fileImporter(
                isPresented: $showImporter,
                allowedContentTypes: [
                    .zip,
                    UTType(filenameExtension: "rc") ?? .data,
                    UTType(filenameExtension: "rcd") ?? .data,
                ],
                allowsMultipleSelection: false
            ) { result in
                switch result {
                case .success(let urls):
                    if let url = urls.first { pendingURL = url }
                case .failure(let error):
                    loadStatus = .failed(error.localizedDescription)
                }
            }
            .task(id: pendingURL) { await loadIfNeeded() }
            .navigationDestination(item: $deck) { deck in
                PresenterView(deck: deck)
                    .ignoresSafeArea(edges: .bottom)
            }
            .navigationTitle("RC Viewer")
        }
    }

    private func loadIfNeeded() async {
        guard let url = pendingURL else { return }
        loadStatus = .loading
        do {
            let loaded = try await DeckLoader.load(from: url)
            loadStatus = .idle
            deck = loaded
        } catch {
            loadStatus = .failed(error.localizedDescription)
        }
        pendingURL = nil
    }
}
