# Deepfake Detective

Deepfake Detective is a lightweight, locally running web application for a
university research project. It will study whether interactive learning can
improve people's ability to recognize political deepfakes.

The repository currently contains the application interface, stage navigation,
the configurable demographic questionnaire and consent gate, the reusable
pre/post video assessment, the JSON-driven interactive learning stage, and the
pre/post Results comparison. Automatic result submission has not been
implemented yet.

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
│   ├── ex.webm
│   ├── ex2.webm
│   ├── ex3.webm
│   └── ex4.webm
├── tests/
│   ├── phase5-learning-check.mjs
│   └── phase6-results-check.mjs
├── .gitignore
└── README.md
```

- `index.html` is the application entry point.
- `css/` contains the application styles.
- `js/` contains the vanilla JavaScript application code.
- `data/` contains JSON content loaded by the application.
- `media/` contains the local videos used by the assessment.
- `tests/` contains browser-level checks that use local Chrome.

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
provided before participation can continue to the pre-assessment.

Starting the experiment assigns the participant to one of two stable
conditions:

- Condition 1: pre-assessment uses set A; post-assessment uses set B
- Condition 2: pre-assessment uses set B; post-assessment uses set A

Each assessment shows one configured video at a time. A submitted answer is
stored in the in-memory participant session and the assessment advances only
after all required responses are valid. The last pre-assessment video moves to
the Learning stage. Learning shows one module at a time in the order configured
in `data/lessons.json`. A configured quiz must be checked before a participant
can continue. The final module opens the post-assessment, and the last
post-assessment video moves to Results.

Participant state is held in the existing `participantSession` object in
`js/app.js`. It includes the participant ID, consent and demographic responses,
the assigned condition and video sets, assessment progress by stage, and the
submitted assessment answers. Learning state records completed module IDs,
checked quiz answers, and whether all modules are complete. Nothing is persisted
to localStorage or submitted over the network yet.

The Results stage calculates correct classifications, accuracy, and average
confidence from the in-memory assessment answers and the labels in
`data/videos.json`. It also prepares a JSON-serializable submission payload with
the participant, demographic, condition, assessment, learning, and calculated
performance data. The submission control remains disabled until the network
workflow is implemented in Phase 7.

## Research content

The assessment and video files currently contain temporary test content. They
must be replaced or reviewed before they are used for research conclusions. The
temporary `real`/`fake` labels do not establish the actual authenticity of the
videos. The lesson file contains two short placeholder modules and must be
replaced with approved educational content.

The application shows an unavailable/configuration message instead of
fabricating content when assessment or lesson files are empty or invalid.

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

### Learning configuration

`data/lessons.json` is an array. Array order defines the module sequence.
`media` and `quiz` are optional for each module.

```json
[
    {
        "id": "unique_module_id",
        "title": "Module title",
        "content": [
            "First approved text paragraph.",
            "Second approved text paragraph."
        ],
        "media": {
            "type": "image | video",
            "src": "media/example.webm",
            "alt": "Accessible description of the media"
        },
        "quiz": {
            "question": "Single-choice question text",
            "options": [
                { "value": "option_a", "label": "First answer" },
                { "value": "option_b", "label": "Second answer" }
            ],
            "correctAnswer": "option_a",
            "explanation": "Explanation shown after the answer is checked."
        }
    }
]
```

- Module IDs must be unique, and `content` must contain at least one non-empty
  paragraph.
- Image and video media require `type`, `src`, and `alt`. Videos must use a local
  file path. The configured source aspect ratio is preserved.
- Quiz options require at least two unique `value` fields. `correctAnswer` must
  match one option value.
- An empty or invalid module list shows a configuration message and leaves
  Learning incomplete and blocked.

### Video configuration

`data/videos.json` is an array. Array order defines the fixed order of videos
within each set. IDs and local file paths must be unique across the file so a
video cannot appear in both assessments.

```json
[
    {
        "id": "unique_video_id",
        "file": "media/video-file.webm",
        "label": "real",
        "set": "A",
        "source": ""
    }
]
```

- `file` must be a local path, not an external URL.
- `label` must be `real` or `fake`.
- `set` must be `A` or `B`, and both sets need at least one video.
- `source` and `label` are available in the configuration but are not displayed
  during the assessment.
- `source` may be an empty string while temporary test content is in use.

The current temporary video mapping is:

- Set A: `ex1` → `media/ex.webm`, `ex2` → `media/ex2.webm`
- Set B: `ex3` → `media/ex3.webm`, `ex4` → `media/ex4.webm`

The first file is currently named `ex.webm`; the configured video ID remains
`ex1`.

### Assessment configuration

`data/assessment.json` contains exactly one classification, confidence, and
detection-clue question. Question labels and option text can be changed without
editing JavaScript. All three questions must set `required` to `true`.

```json
{
    "questions": [
        {
            "id": "classification",
            "type": "classification",
            "required": true,
            "label": "Question text supplied by the research team",
            "options": [
                { "value": "real", "label": "Authentic" },
                { "value": "fake", "label": "AI-generated" }
            ]
        },
        {
            "id": "confidence",
            "type": "confidence",
            "required": true,
            "label": "Question text supplied by the research team",
            "min": 0,
            "max": 100,
            "step": 1
        },
        {
            "id": "clues",
            "type": "clues",
            "required": true,
            "label": "Question text supplied by the research team",
            "options": [
                { "value": "clue_id_one", "label": "Clue option one" },
                { "value": "clue_id_two", "label": "Clue option two" }
            ]
        }
    ]
}
```

Classification must contain the values `real` and `fake`. Confidence must use
the required 0–100 percentage range. Detection clues use checkboxes and allow
multiple selections. Each submitted answer records the assessment stage, video
ID, 1-based video position, `answer` value, confidence percentage, and configured
clue values.

## Browser checks

With Google Chrome installed, run:

```bash
node tests/phase5-learning-check.mjs
node tests/phase6-results-check.mjs
```

The scripts start temporary local server and Chrome processes. Together they
verify the assessment and learning flow, result calculations, submission
payload, complete session reset, responsive widths, and browser console errors.
