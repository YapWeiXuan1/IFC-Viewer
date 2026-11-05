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
- Reads real, synchronized itemit asset data through the separate FOBE-API service. Asset searching is local to the loaded API response; IFC-to-asset mapping is deliberately not implemented yet.
- Exports a read-only IFC element index for Smart Mapping analysis, using the stable `{ modelKey, GlobalId }` identity rather than Fragments local IDs.
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

### Connecting FOBE-API locally

Start the separate FOBE-API service on its default address (`http://127.0.0.1:8000`). During development, Vite proxies frontend requests from `/api/*` to that service, so the browser never contacts itemit or SQLite directly.

```powershell
cd ..\FOBE-Assets\FOBE-Asset\FOBE-API
..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

If the service is on another machine, start Vite with `FOBE_API_TARGET` set to its address, for example:

```powershell
$env:FOBE_API_TARGET = "http://192.168.1.50:8000"
npm run dev
```

For a deployed frontend, set the public `VITE_FOBE_API_BASE_URL` at build time to the API's reachable URL (for example `https://api.example.com`). This value must contain no credentials. Configure CORS on FOBE-API when using a separate origin.

The verified FOBE-API v0.1 routes are `GET /health`, `GET /assets?active_only=true&limit=100`, and `GET /assets/{asset_id}`. `/assets` returns an array of itemit asset objects, augmented with `is_active` and `current_location`; the viewer uses the asset `id`, `name`, `serial`, and `current_location` fields. v0.1 has no server-side search or offset parameter, so the viewer loads up to 500 active records and filters names/serials locally.

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

### Manually map an IFC element to itemit

1. Select an IFC element with an available GlobalId and remain in **Element Info**.
2. BIM Studio retrieves its persisted mapping using the stable `modelKey + GlobalId` pair.
3. For an unmapped element, choose **Load inventory**, search by item name or serial number, and inspect a record before selecting it.
4. Select **Confirm mapping**. The write creates a confirmed mapping directly.

The UI never selects an asset automatically. Mapping writes are for the trusted local-development FOBE-API only; the current API has no authentication and must not be exposed on an untrusted network. Asset Collection membership is displayed only when a future FOBE-API response supplies it; the current API exposes the asset name, serial number, UUID, and location.

### Mapping Workspace

Use the existing right-side **Mapping** tab or select an IFC element and choose **Map this IFC element**. The mapping controls preserve the stable `modelKey + GlobalId` selection, list indexed IFC elements, and show IFC details beside the chosen itemit asset before a manual confirmation.

The central BIM Studio viewer remains visible throughout mapping; no second viewer or full-screen mapping page is created. Selecting an object in 3D uses the normal highlight/inspection path, while selecting an IFC list entry highlights that same Fragments object in the viewer. Orbit, zoom, pan, model visibility, and export controls remain available. The model library is available from the **Models** drawer in the top bar.

On desktop, Mapping starts in **Balanced** layout (approximately 42% viewer / 58% workspace). Drag the divider between the viewer and the right panel to choose a working width; minimum viewer and mapping widths keep both surfaces usable. **Mapping Focus**, **Balanced**, and **3D Focus** presets restore practical splits quickly. The existing renderer is resized in place after every layout change, and the active model is framed with a small margin when it is switched or when **Fit camera to model** is selected.

Asset filters are applied before pagination: asset name, complete serial, normalized location/room, Collection when available from the API, and mapping status. Selecting the White model suggests the `white-box` location alias (matching `White Box`, `whitebox`, or `D108G`), but the filter can always be changed or cleared. Results use pages of 25, so all matching records remain reachable; the former 30-result truncation is removed.

The workspace defaults to **Asset-oriented elements**, hiding common building geometry such as walls, slabs, columns, openings, doors, windows, and structural members from the IFC list. Furnishings and generic `IfcBuildingElementProxy` objects remain visible because they may represent real assets. Choose **All geometry, including building elements** for review when needed.

Mapping creation stays disabled until the workspace can retrieve the mapping list from FOBE-API. This prevents a missing/old `/mappings` route from being mistaken for an unmapped IFC element.

Confirmed mappings are read-only in the workspace. Their linked itemit record remains visible, but asset selection and the confirm action are disabled. Confirmed IFC elements cannot enter a batch; the batch control reports how many were excluded. Correction or unlink support is intentionally deferred to a future enhancement.

The FOBE-API mapping backend must enforce the same rule: mapping creation must atomically reject an already-confirmed `{ model_key, ifc_global_id }` with HTTP `409 Conflict`, and its update route must not overwrite confirmed mappings. The frontend controls are a usability measure, not the security boundary.

### Export an IFC element index

Select a loaded model and use **Export IFC element index** in the left panel. The downloaded JSON lists every geometry-bearing element with its stable model key, IFC GlobalId where available, IFC type, name, description, containing IFC space when recoverable, and identifying property values. `sourceLocalId` is included only to inspect the active Fragments session and must not be used for a persistent mapping.

The exporter labels elements as `likely-asset` or `review` using configurable IFC type and identifying-property hints. It never discards generic types, and it never creates mappings to itemit assets.

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

- Mapping writes remain unavailable until the running FOBE-API exposes the Phase 2 `/mappings` routes; restart that API after deploying its mapping backend.
- The model catalog is hard-coded in `src/main.js`; the interface does not upload or discover arbitrary IFC files.
- IFC conversion is sequential and session-only. Generated data is lost unless the user downloads it.
- The application depends on an externally fetched Fragments worker during initialization and is therefore not fully offline.
- The asset panel needs a running FOBE-API service and does not persist API responses. If it is offline, the BIM viewer continues to work normally.

