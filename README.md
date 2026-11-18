# Deepfake Detective

Deepfake Detective is a lightweight, locally running web application for a
university research project. It will study whether interactive learning can
improve people's ability to recognize political deepfakes.

The repository currently contains the application interface, stage navigation,
the configurable demographic questionnaire and consent gate. Assessment
scoring and data export have not been implemented yet.

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

The welcome stage loads the demographic questionnaire and consent statement
from `data/demographics.json`. Required answers and explicit consent must be
provided before participation can continue to the pre-assessment. The later
stage controls remain temporary preview navigation.

## Research content

The assessment, video, and lesson content files do not yet contain research
materials. They will be provided separately by team members.

`data/demographics.json` contains temporary example demographic questions and a
short consent statement. These will be replaced with final research content.

`data/demographics.json` uses this structure:

```json
{
    "consentStatement": "",
    "questions": [
        {
            "id": "unique_question_id",
            "label": "Question label",
            "type": "text | number | select | radio | checkbox",
            "required": true,
            "options": ["Option one", "Option two"],
            "min": 15,
            "max": 100
        }
    ]
}
```

`options` is required for `select`, `radio`, and `checkbox` questions and is
omitted for `text` and `number` questions. An empty consent statement or an
empty question array leaves participation disabled. Optional inclusive `min`
and `max` bounds can be added to `number` questions.
