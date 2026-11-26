# Deepfake Detective

Deepfake Detective is a lightweight, locally running web application for a
university research project. It will study whether interactive learning can
improve people's ability to recognize political deepfakes.

The repository currently contains the application interface, stage navigation,
the configurable demographic questionnaire and consent gate, the reusable
pre/post video assessment, the JSON-driven interactive learning stage, the
pre/post Results comparison, and verified result submission to Google Sheets
before Results are shown.

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
│   └── *.mp4 (8 assessment videos and 2 retained legacy Learning videos)
├── gsscript/
│   └── gsbackend.gs
├── tests/
│   ├── gsbackend-contract-check.mjs
│   ├── phase5-learning-check.mjs
│   ├── phase6-results-check.mjs
│   ├── phase7-live-submission-check.mjs
│   ├── phase10-submission-gate-check.mjs
│   └── submission-jsonp-check.mjs
├── .gitignore
└── README.md
```

- `index.html` is the application entry point.
- `css/` contains the application styles.
- `js/` contains the vanilla JavaScript application code.
- `data/` contains JSON content loaded by the application.
- `media/` contains the assessment videos plus two unused legacy Learning videos.
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
5. Submission
6. Results

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

Each round uses all four videos from its assigned set: two authentic and two
deepfake videos, with two featuring Donald Trump and two featuring Joe Biden.
Their order is shuffled once, stored in the participant session, and remains
stable without repeats.

Each assessment shows one configured video at a time. A submitted answer is
stored in the in-memory participant session and the assessment advances only
after the browser has loaded the current video's metadata and all required
responses are valid. A video loading error keeps submission disabled. The
progress label runs from Video 1 of 4 through Video 4 of 4. Leaving a video
pauses playback and releases its media source. The fourth Round-1 video moves
to Learning. Learning presents the approved introduction and five concepts in
a vertical text-only layout, followed by three quiz questions shown one at a
time. Each answer must be checked before the next question is available. After
all three answers are saved, Round-2 opens; its fourth video moves to Submission.

Participant state is held in the existing `participantSession` object in
`js/app.js`. It includes the participant ID, consent and demographic responses,
the assigned condition and video sets, the selected video IDs, assessment
progress by stage, and the submitted assessment answers. Learning state records
completed module IDs, checked quiz answers, and whether all modules are
complete. Nothing is persisted to localStorage; completed results are sent only
when the participant selects Submit Results.

The Submission stage prepares a JSON-serializable payload with the participant,
demographic, condition, assessment, learning, and calculated performance data.
Each round contributes four responses, for eight assessment responses per
participant. Submit Results sends that payload once to the configured Google
Apps Script Web App and then verifies the participant ID through its JSONP GET
endpoint. Verification retries do not resend the POST. If verification remains
inconclusive, **Check Submission Again** repeats only the verification using
the preserved participant ID and payload. The interface reports success only
after positive verification. Each JSONP attempt allows up to 12 seconds for
Apps Script startup and sheet lookup before it is treated as inconclusive.

The backend checks for the participant ID and performs both spreadsheet writes
while holding the Apps Script script lock. Repeated or concurrent requests with
the same participant ID return a successful duplicate acknowledgement without
adding another participant row or duplicate video-response rows.

The Results stage calculates correct classifications, accuracy, and average
confidence from the in-memory assessment answers and the labels in
`data/videos.json`. Results are not rendered or accessible until submission
verification succeeds. The final Results screen includes a thank-you message
and does not provide a New Participant button.

## Research content

The assessment uses eight local MP4 videos referenced from the configured
research dataset. Their metadata, set assignment, and `real`/`fake` labels live
in `data/videos.json` and must be reviewed by the research team before the data
is used for research conclusions. Learning no longer uses a video player. The
two `media/learning-trump_*.mp4` files are retained as unused assets and may be
removed later after repository review.

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

The current demographic section includes age, gender (Male/Female), a required
free-text nationality field that accepts multiple nationalities or “Prefer not
to say”, and education. Questionnaire responses are serialized by their stable
IDs, including `demographics.nationality`.

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
        "contentHeading": "Section heading",
        "clues": [
            { "id": "clue_id", "title": "Concept title", "text": "Approved explanation." }
        ]
    },
    {
        "id": "quiz_module_id",
        "type": "quiz",
        "title": "Quiz module title",
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
- A content module requires an introduction, section heading, and at least one
  concept. Learning modules contain no video configuration or player.
- Each quiz question requires exactly three options. `correctOptionId` must
  match one option ID, and feedback is shown only after submission.
- Quiz answers are stored by question ID in `learning.quizAnswers`; the current
  module records the three retained IDs `q1`, `q3`, and `q4`.
- An empty or invalid module list shows a configuration message and leaves
  Learning incomplete and blocked.

### Video configuration

`data/videos.json` is an array of eight assessment videos. IDs and local file
paths must be unique across the file so a video cannot appear in both rounds.
For each participant, the application shuffles and uses all four videos from
each assigned set.

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
- `set` must be `A` or `B`. The current study design uses four available
  videos in each set, balanced between two `real` and two `fake` labels and
  two Trump and two Biden videos. All four are shown to the participant.
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
node tests/phase10-submission-gate-check.mjs
node tests/submission-jsonp-check.mjs
node tests/gsbackend-contract-check.mjs
```

The scripts start temporary local server and Chrome processes. Together they
verify four-video rounds, stable balanced video selection, media cleanup,
three-question Learning completion, result calculations, submission
verification retries, idempotent backend writes, responsive widths, and
browser console errors.

## Google Sheets migration

The Apps Script participant mapping appends `Nationality` after the existing
`Payload JSON` column so historical columns do not move. If the Participants
sheet already contains submissions, manually set cell `AB1` to `Nationality`;
leave existing rows unchanged. The defensive `setup()` function will not alter
headers when data rows exist and will throw until this header is added. Do not
run `setup()` for this migration. After reviewing the local change, deploy a new
Apps Script Web App version so future submissions use the appended column.

The live submission check is opt-in because it sends one synthetic result to
the configured Google Sheet:

```bash
RUN_LIVE_SUBMISSION_TEST=1 node tests/phase7-live-submission-check.mjs
```

It verifies the production POST and JSONP confirmation flow without
intentionally logging the synthetic participant ID or payload.
