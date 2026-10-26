# BIM Studio — IFC Viewer

A browser-based Building Information Modeling (BIM) workspace for viewing and inspecting Industry Foundation Classes (IFC) models. The application uses pre-generated Fragments files for responsive model loading and switching, while retaining the original IFC files for optional in-browser conversion.

## Key Features

- Displays five included BIM models: Building Overview, Foyer, Black Room, White Room, and Research Room.
- Switches between optimized `.frag` models and caches loaded models for the current browser session.
- Preloads the remaining models in the background after the initial model is ready.
- Supports orbit, zoom, and pan camera controls.
- Selects and highlights model elements through raycasting.
- Shows the selected element's model ID, local ID, and available IFC property data.
- Converts the included `.ifc` files to `.frag` files in the browser and downloads the result.
- Adapts the three-panel workspace for narrower screens.

## Tech Stack

| Technology | Purpose |
| --- | --- |
| JavaScript (ES modules) | Application logic and browser interactions |
| HTML5 and CSS3 | Interface structure and responsive styling |
| [Vite](https://vite.dev/) | Development server and production build tooling |
| [That Open Components](https://github.com/ThatOpen/engine_components) | BIM world, scene, renderer, camera, IFC loading, and Fragments integration |
| [That Open Fragments](https://github.com/ThatOpen/engine_fragment) | Optimized BIM model loading and worker-based geometry processing |
| [Three.js](https://threejs.org/) | 3D primitives used by element picking and highlighting |
| [web-ifc](https://github.com/ThatOpen/engine_web-ifc) | WebAssembly-based IFC parsing during conversion |

## System Architecture

The project is a client-side application. It has no application server, API, or database.

```text
Browser interface (index.html + src/main.js)
├── Viewer setup (src/viewer.js)
│   ├── That Open scene, renderer, and camera
│   ├── Fragments manager ──> public/fragments/*.frag
│   └── IFC loader ─────────> public/models/*.ifc
│                              public/wasm/web-ifc.wasm
├── Model picker (src/model-picker.js)
│   └── Raycast + element highlight
└── Element inspector (src/element-inspector.js)
    └── Selected element property data
```

The viewer normally reads the pre-generated Fragments files. The converter tab reads an original IFC file, parses it with the local `web-ifc.wasm` binary, and creates a downloadable Fragments file. Converted files are held only in browser memory until downloaded.

## Prerequisites

- [Node.js](https://nodejs.org/) `20.19.0` or newer in the Node 20 line, or `22.12.0` or newer
- npm (included with Node.js)
- A modern browser with JavaScript, WebAssembly, Web Workers, and WebGL support
- An internet connection when the viewer initializes; the installed Fragments library obtains its version-matched worker from `unpkg.com`

## Installation and Setup

From the repository root:

```bash
npm ci
```

`npm ci` installs the versions recorded in `package-lock.json`. The required IFC, Fragments, and WebAssembly assets are already located under `public/`.

No environment variables or `.env` file are required by the current application.

## Running the Application

Start the Vite development server:

```bash
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`).

To create and inspect a production build:

```bash
npm run build
npm run preview
```

The production output is written to `dist/`.

## Project Structure

```text
IFC-Viewer/
├── public/
│   ├── fragments/             # Pre-generated models used by the viewer
│   ├── models/                # Original IFC files used by the converter
│   ├── wasm/web-ifc.wasm      # Local IFC parsing runtime
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── main.js                # Application state, model catalog, caching, and UI events
│   ├── viewer.js              # That Open viewer and IFC loader initialization
│   ├── model-picker.js        # Element raycasting, selection, and highlighting
│   ├── element-inspector.js   # Selected-element property retrieval
│   └── style.css              # Desktop and responsive interface styles
├── index.html                 # Application shell
├── package.json               # npm scripts and dependency declarations
└── package-lock.json          # Reproducible dependency versions
```

## Usage Guide

### View and navigate a model

1. Start the application and wait for **Building Overview** to load.
2. Choose a model from **3D Model Library** to switch the active view.
3. Use left-drag to orbit, the scroll wheel to zoom, and right-drag to pan.
4. Select **Preload other models** to explicitly load all remaining Fragments files. The application also starts this preload automatically after the first model is ready.

### Inspect an element

1. Open the **Element Info** tab.
2. Click an element in the active model.
3. Review its model identifier, local identifier, and property data in the right panel.
4. Click empty space or switch models to clear the selection.

### Convert an IFC file

1. Open the **IFC Converter** tab.
2. Select **Convert IFC** for one of the included models.
3. When conversion finishes, select **Download .frag**.
4. Move the downloaded file into `public/fragments/`, keeping the filename shown in the converter, and refresh the application.

Conversion is performed locally in the browser. It does not overwrite the source IFC file or upload it to an application backend.

## Deployment

Run `npm run build` and deploy the generated `dist/` directory to a static web host. The application requests assets from absolute paths such as `/fragments/`, `/models/`, and `/wasm/`, so it must currently be hosted at the root of a domain or be adjusted before deploying under a subpath.

The deployed site must be allowed to connect to `https://unpkg.com` so the Fragments worker can initialize. Large files under `public/models/` are copied into the production output and should be considered when choosing host storage and transfer limits.

## Known Limitations

- **Fit camera to model** is present in the interface but is not implemented; the application reports this and directs the user to the mouse controls.
- The model catalog is hard-coded in `src/main.js`; the interface does not upload or discover arbitrary IFC files.
- IFC conversion is sequential and session-only. Generated data is lost unless the user downloads it.
- The application depends on an externally fetched Fragments worker during initialization and is therefore not fully offline.
- No automated test command or test suite is configured in the repository.

