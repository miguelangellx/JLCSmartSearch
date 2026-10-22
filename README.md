# JLCSmartSearch

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

- Node.js 18 or newer
- No npm dependencies

## Run locally

From this folder, run:

```sh
npm start
```

Open <http://127.0.0.1:3000>.

To use a different port:

```sh
PORT=3001 npm start
```

In Windows PowerShell:

```powershell
$env:PORT = 3001
npm start
```

## Deployment

JLCSmartSearch requires a Node.js host because catalog search and product lookup
use API routes in `server.js`. GitHub Pages cannot run this server. Deploy this
folder to a Node.js web service and set its start command to `npm start`. The
server uses the host-provided `PORT` and binds to `0.0.0.0` when deployed.

The app requests public JLCPCB endpoints without browser cookies, account
tokens, or saved session credentials. Do not add credentials or personal data
to the repository.

## Project files

- `server.js` — Node.js HTTP server and JLCPCB API proxy.
- `index.html`, `app.js`, `styles.css` — browser interface.
- `package.json` — project metadata and start command.

Local JSON files, environment files, and logs are excluded by `.gitignore`.

## Data and recommendations

JLCSmartSearch presents catalog information returned by JLCPCB/LCSC and exports
normalized component records. It does not independently verify datasheets,
electrical suitability, stock guarantees, or AI-generated recommendations.
Always check the manufacturer's datasheet and current supplier listing before
choosing a component.
