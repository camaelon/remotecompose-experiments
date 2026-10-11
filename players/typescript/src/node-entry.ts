// Node.js entry point for headless rendering - exports all needed classes.

export { CoreDocument } from './core/CoreDocument';
export { RemoteComposeBuffer } from './core/RemoteComposeBuffer';
export { CanvasPaintContext } from './web/CanvasPaintContext';
export { WebRemoteContext } from './web/WebRemoteContext';
export { ContextMode } from './core/RemoteContext';
export { Operations } from './core/Operations';
export { RcdPlayer } from './web/main';
export { rc2json } from './rc2json';
// For harnesses that need to pin the clock: TimeVariables builds every time variable
// from a snapshot, so a deterministic snapshot is the only way to get a reproducible frame.
export { createSnapshot } from './core/RemoteClock';
