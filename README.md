# Deepfake Detective

Deepfake Detective is a lightweight, locally running web application for a
university research project. It will study whether interactive learning can
improve people's ability to recognize political deepfakes.

The repository currently contains the initial application interface and
stage navigation. Experiment content loading, response collection, scoring,
and data export have not been implemented yet.

## Technology stack

- HTML5
- CSS3
- Vanilla JavaScript
- JSON files for application content

The project uses no frontend frameworks, backend, database, external
dependencies, or build tools.

## Project structure

```text
deepfake-detective/
├── index.html
├── css/
│   └── style.css
├── js/
│   └── app.js
├── data/
│   ├── demographics.json
│   ├── assessment.json
│   ├── videos.json
│   └── lessons.json
├── media/
│   └── .gitkeep
├── .gitignore
└── README.md
```

- `index.html` is the application entry point.
- `css/` contains the application styles.
- `js/` contains the vanilla JavaScript application code.
- `data/` contains JSON content loaded by the application.
- `media/` will hold the videos and other media used in the study.

## Run locally

From the project root, start a local static web server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in a web browser. Stop the server with
`Ctrl+C` when finished.

The HTTP server is needed so that the browser can load the JSON data and media
files consistently.

## Application flow

1. Welcome/Demographics
2. Pre-Assessment
3. Learning
4. Post-Assessment
5. Results

The current interface provides temporary preview navigation between these
stages. These controls do not record consent, save responses, or run the
research protocol.

## Research content

All four JSON files currently contain empty arrays. Actual questionnaire
questions, demographic fields, videos, educational lessons, and assessment
content will be provided separately by team members.
