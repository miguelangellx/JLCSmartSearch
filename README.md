# JLCSmartSearch

**Live app:** [jlcsmartsearch.onrender.com](https://jlcsmartsearch.onrender.com/)

**Tagline:** Find the right JLCPCB part. Filter, compare, and export with confidence.

**Description:** JLCSmartSearch is a lightweight, self-hosted Node.js web app for
searching the public JLCPCB component catalog, filtering parts by specifications
and availability, importing JLCPCB/LCSC component data, and comparing
components side by side. Export normalized component data as JSON for your own
workflows, including AI-assisted analysis.

## Features

- Search the public JLCPCB catalog by category, subcategory, and keyword.
- Filter by component attributes, brand, package, stock, component library,
  sorting, and PCBA type.
- Select individual facet values or use Shift-click to select a range.
- Import component arrays or API responses containing `data` from a JSON file
  or pasted JSON.
- Add components by JLCPCB/LCSC product URL or component code.
- Compare components and export normalized catalog data as JSON.
- Use the light or dark theme.

## Requirements

- Node.js 20.19+ or 22.12+
- pnpm 12.15.0 (pinned in `package.json`)

## Development

Use the pinned pnpm version to install dependencies and start the API server and
Vite dev server together:

```sh
corepack pnpm@12.15.0 install
corepack pnpm@12.15.0 dev
```

Open <http://127.0.0.1:5173>. Vite provides hot module replacement (HMR) for
the frontend and proxies `/api` requests to the local Node server on port 3000.
This project uses plain JavaScript and CSS, so Svelte, TypeScript, Tailwind,
Lucide, and dependency pre-bundling are not needed.

## Production build and preview

Build minified frontend files into `dist/`:

```sh
corepack pnpm@12.15.0 build
```

Run the production API server locally with `corepack pnpm@12.15.0 start` and open
<http://127.0.0.1:3000>. To preview the production frontend through Vite, run:

```sh
corepack pnpm@12.15.0 preview
```

Open <http://127.0.0.1:4173>. Preview starts the API server and proxies API
requests to it.

The production server uses the host-provided `PORT`. For a local port override:

```powershell
$env:PORT = 3001
corepack pnpm@12.15.0 start
```

## Deployment

JLCSmartSearch requires a Node.js host because catalog search and product lookup
use API routes in `server.js`. GitHub Pages cannot run this server. Deploy this
folder to a Node.js web service such as Render. Set the build command to
`corepack pnpm@12.15.0 install --frozen-lockfile && corepack pnpm@12.15.0 build`
and the start command to `corepack pnpm@12.15.0 start`. Render runs the build
command when creating a deployment; starting or restarting the service runs
only `node server.js`, not `pnpm build`. The server serves the minified
production build from `dist/` and binds to `0.0.0.0` when the host provides
`PORT`.

The app requests public JLCPCB endpoints without browser cookies, account
tokens, or saved session credentials. Do not add credentials or personal data
to the repository.

## Project files

- `server.js` — Node.js HTTP server and JLCPCB API proxy.
- `frontend/index.html`, `frontend/app.js`, `frontend/styles.css` — frontend
  source files.
- `frontend/vite.config.mjs` — Vite build, dev server, HMR, and API proxy config.
- `frontend/public/favicon.svg` — app icon.
- `package.json`, `pnpm-lock.yaml` — project metadata and locked dependencies.

Generated files in `dist/`, local JSON files, environment files, and logs are
excluded by `.gitignore`.

## Data and recommendations

JLCSmartSearch presents catalog information returned by JLCPCB/LCSC and exports
normalized component records. It does not independently verify datasheets,
electrical suitability, stock guarantees, or AI-generated recommendations.
Always check the manufacturer's datasheet and current supplier listing before
choosing a component.
