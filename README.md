# Deepfake Detective

Deepfake Detective is a lightweight, locally running web application for a
university research project. It will study whether interactive learning can
improve people's ability to recognize political deepfakes.

The repository currently contains the application interface, stage navigation,
the configurable demographic questionnaire and consent gate, the reusable
pre/post video assessment, the JSON-driven interactive learning stage, the
pre/post Results comparison, and verified result submission to Google Sheets.

## Technology stack

- HTML5
- CSS3
- Vanilla JavaScript
- JSON files for application content

The project uses no frontend frameworks, repository-hosted backend, database,
package dependencies, or build tools. Result submission uses a configured
external Google Apps Script Web App.

## Project structure

```text
deepfake-detective/
├── index.html
├── css/
│   └── style.css
├── js/
│   └── app.js
├── data/
│   ├── pre-questionnaire.json
│   ├── assessment.json
│   ├── videos.json
│   └── lessons.json
├── media/
│   └── *.mp4 (8 assessment videos and 2 learning videos)
├── gsscript/
│   └── gsbackend.gs
├── tests/
│   ├── gsbackend-contract-check.mjs
│   ├── phase5-learning-check.mjs
│   ├── phase6-results-check.mjs
│   └── phase7-live-submission-check.mjs
├── .gitignore
└── README.md
```

- `index.html` is the application entry point.
- `css/` contains the application styles.
- `js/` contains the vanilla JavaScript application code.
- `data/` contains JSON content loaded by the application.
- `media/` contains separate local videos for the assessments and Learning.
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
2. Round-1
3. Learning
4. Round-2
5. Results

The welcome stage loads the demographic questionnaire and consent statement
from `data/pre-questionnaire.json`. Required answers and explicit consent must be
provided before participation can continue to the Round-1. This opening
stage has three screens: Welcome and consent, About you, and AI experience and
attitudes. Back/Continue navigation preserves answers. Question `section` values
in the JSON are `demographics` (the default) or `ai`; the last screen starts the
experiment only after all answers and consent are validated.

Starting the experiment assigns the participant to one of two stable
conditions:

- Condition 1: Round-1 uses set A; Round-2 uses set B
- Condition 2: Round-1 uses set B; Round-2 uses set A

Each assessment shows one configured video at a time. A submitted answer is
stored in the in-memory participant session and the assessment advances only
after the browser has loaded the current video's metadata and all required
responses are valid. A video loading error keeps submission disabled. The last
Round-1 video moves to the Learning stage. Learning first presents the configured
authentic/deepfake comparison and five concepts, then shows four quiz questions
one at a time. Each answer must be checked before the next question is available.
After all four answers are saved, the final module opens Round-2; the last
Round-2 video moves to Results.

Participant state is held in the existing `participantSession` object in
`js/app.js`. It includes the participant ID, consent and demographic responses,
the assigned condition and video sets, assessment progress by stage, and the
submitted assessment answers. Learning state records completed module IDs,
checked quiz answers, and whether all modules are complete. Nothing is persisted
to localStorage; completed results are sent only when the participant selects
Submit Results.

The Results stage calculates correct classifications, accuracy, and average
confidence from the in-memory assessment answers and the labels in
`data/videos.json`. It prepares a JSON-serializable submission payload with the
participant, demographic, condition, assessment, learning, and calculated
performance data. Submit Results sends that payload to the configured Google
Apps Script Web App and then verifies the participant ID through its JSONP GET
endpoint. The interface reports success only after positive verification.
Failed or unconfirmed requests keep the participant session in memory and can
be retried. New Participant remains unavailable until verification succeeds.

## Research content

The assessment uses eight local MP4 videos referenced from the configured
research dataset. Their metadata, set assignment, and `real`/`fake` labels live
in `data/videos.json` and must be reviewed by the research team before the data
is used for research conclusions. The two Learning videos are configured only
in `data/lessons.json` and remain separate from the assessment sets.

The application shows an unavailable/configuration message instead of
fabricating content when assessment or lesson files are empty or invalid.

`data/pre-questionnaire.json` uses this structure:

```json
{
    "consentStatement": "",
    "questions": [
        {
            "id": "unique_question_id",
            "label": "Question label",
            "type": "text | number | select | radio | checkbox | range",
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

`range` questions use integer `min`/`max` bounds and `minLabel`/`maxLabel`
endpoint labels. Their `options` are separate radio alternatives to the slider.
A required range question needs an explicit slider or radio selection. Responses
store the selected number or alternative text. Political leaning uses 1–7.

Questions can use `showIf: { "questionId": "parent_id", "values": ["answer"] }`
to appear only for matching radio or dropdown answers. Hidden conditional
questions are excluded from required validation and recorded responses.
The political deepfake follow-up appears after any selected exposure answer
except Never, including Unsure.

Checkbox questions may set `exclusiveOption` to an option that cannot be combined
with other answers (such as “I don’t remember”). Selecting it clears other choices,
and selecting another choice clears it.

### Learning configuration

`data/lessons.json` is an array. Array order defines the module sequence. The
current configuration uses a `content` module followed by a `quiz` module.

```json
[
    {
        "id": "content_module_id",
        "type": "content",
        "title": "Content module title",
        "introduction": "Approved introduction.",
        "comparisonVideos": {
            "real": { "label": "Authentic Video", "file": "media/real.mp4" },
            "fake": { "label": "Deepfake Video", "file": "media/fake.mp4" }
        },
        "comparisonNote": "Approved comparison note.",
        "contentHeading": "Section heading",
        "clues": [
            { "id": "clue_id", "title": "Concept title", "text": "Approved explanation." }
        ]
    },
    {
        "id": "quiz_module_id",
        "type": "quiz",
        "title": "Quiz module title",
        "contentHeading": "Section heading",
        "questions": [
            {
                "id": "q1",
                "question": "Question text",
                "correctOptionId": "a",
                "feedback": "Feedback shown after submission.",
                "options": [
                    { "id": "a", "text": "First answer" },
                    { "id": "b", "text": "Second answer" },
                    { "id": "c", "text": "Third answer" }
                ]
            }
        ]
    }
]
```

- Module, concept, question, and option IDs must be unique within their scope.
- A content module requires both local comparison video paths, a comparison
  note, and at least one concept. Only the selected video is loaded.
- Each quiz question requires exactly three options. `correctOptionId` must
  match one option ID, and feedback is shown only after submission.
- Quiz answers are stored by question ID in `learning.quizAnswers`; the current
  module records all four answers as `q1` through `q4`.
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
        "file": "media/video-file.mp4",
        "label": "real",
        "set": "A",
        "source": "Dataset citation"
    }
]
```

- `file` must be a local path, not an external URL.
- `label` must be `real` or `fake`.
- `set` must be `A` or `B`. The current study design uses four videos in each
  set, balanced between two `real` and two `fake` labels.
- `source` and `label` are available in the configuration but are not displayed
  during the assessment.
- `source` may be an empty string only while temporary test content is in use.

The current video mapping is:

- Set A: `t-01` (fake), `t-02` (real), `b-01` (fake), `b-02` (real)
- Set B: `t-03` (fake), `t-04` (real), `b-03` (fake), `b-04` (real)

The corresponding local MP4 paths and dataset citations are defined in
`data/videos.json`.

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
node tests/gsbackend-contract-check.mjs
```

The scripts start temporary local server and Chrome processes. Together they
verify the assessment and learning flow, result calculations, submission
payload, complete session reset, responsive widths, and browser console errors.

The live submission check is opt-in because it sends one synthetic result to
the configured Google Sheet:

```bash
RUN_LIVE_SUBMISSION_TEST=1 node tests/phase7-live-submission-check.mjs
```

It verifies the production POST and JSONP confirmation flow without
intentionally logging the synthetic participant ID or payload.
