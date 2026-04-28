# vscode-extension/ — RC Viewer for Visual Studio Code

A VS Code custom editor that previews `.rc` and `.rcd` binary documents
inline. Opens the file in a webview running the bundled TypeScript
player; alongside the visual preview it offers a JSON inspector via the
bundled `rc2json` converter.

## Build

```sh
cd ../          # the typescript player root
npm install     # one-time — installs esbuild, tsc, vsce

cd vscode-extension
./build.sh
```

`build.sh` does three things:

1. **Bundles the player** (`../src/web/main.ts`) and **rc2json**
   (`../src/rc2json.ts`) via `esbuild` into `media/rc-bundle.js` and
   `media/rc2json-bundle.js`.
2. **Compiles the extension** (`src/extension.ts`,
   `src/RcEditorProvider.ts`) via `tsc` into `out/`.
3. **Packages** the extension into `rc-viewer-<version>.vsix` via
   `@vscode/vsce`.

The extension shares its toolchain with the TypeScript player project
(esbuild, tsc, vsce are all dev-deps over there), so you don't need a
separate `npm install` here.

## Install

```sh
code --install-extension rc-viewer-0.1.0.vsix
```

After installing, opening any `.rc` or `.rcd` file in VS Code defaults
to the RemoteCompose Preview editor.

## Layout

```
vscode-extension/
├── package.json          extension manifest (contributes the custom editor)
├── tsconfig.json         compiles src/ → out/
├── build.sh              one-shot bundler + compiler + packager
├── src/
│   ├── extension.ts             activate() entry point
│   └── RcEditorProvider.ts      CustomReadonlyEditorProvider impl
└── media/                       generated bundles (gitignored)
    ├── rc-bundle.js             esbuild output of ../src/web/main.ts
    └── rc2json-bundle.js        esbuild output of ../src/rc2json.ts
```
