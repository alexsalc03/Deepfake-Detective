// Deepfake Detective — Google Sheets Backend

const PARTICIPANTS_SHEET = "Participants";
const RESPONSES_SHEET = "VideoResponses";

const PARTICIPANT_HEADERS = [
  "Submitted At",
  "Participant ID",
  "Age",
  "Gender",
  "Education Level",
  "Political Leaning",
  "AI Sentiment",
  "Deepfake Exposure Frequency",
  "Deepfake Exposure Channels JSON",
  "Political Deepfake Exposure",
  "Condition",
  "Pre Video Set",
  "Post Video Set",
  "Completed Modules JSON",
  "Quiz Answers JSON",
  "Learning Complete",
  "Pre Correct",
  "Pre Total",
  "Pre Accuracy (%)",
  "Pre Avg Confidence (%)",
  "Post Correct",
  "Post Total",
  "Post Accuracy (%)",
  "Post Avg Confidence (%)",
  "Accuracy Difference (pp)",
  "Demographics JSON",
  "Payload JSON"
];

const RESPONSE_HEADERS = [
  "Participant ID",
  "Stage",
  "Video ID",
  "Correct Label",
  "Classification",
  "Is Correct",
  "Confidence (%)",
  "Selected Clues JSON"
];

// Initialize the spreadsheet and column headers.
function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error("Open Apps Script from the Google Sheet.");
  }

  PropertiesService.getScriptProperties().setProperty(
    "SPREADSHEET_ID",
    spreadsheet.getId()
  );

  const configurations = [
    [PARTICIPANTS_SHEET, PARTICIPANT_HEADERS],
    [RESPONSES_SHEET, RESPONSE_HEADERS]
  ];

  configurations.forEach(([name, headers]) => {
    const sheet = spreadsheet.getSheetByName(name);

    if (!sheet) {
      throw new Error("Missing sheet: " + name);
    }

    const currentHeaders = sheet
      .getRange(1, 1, 1, headers.length)
      .getValues()[0];

    const alreadyConfigured = headers.every(
      (header, index) => currentHeaders[index] === header
    );

    if (!alreadyConfigured && sheet.getLastRow() > 1) {
      throw new Error(
        "Remove existing test rows from " + name +
        " before changing its headers."
      );
    }

    if (!alreadyConfigured) {
      sheet.getRange(1, 1, 1, headers.length)
        .setValues([headers]);
    }
  });
}

// Open the configured spreadsheet.
function getSpreadsheet() {
  const id = PropertiesService
    .getScriptProperties()
    .getProperty("SPREADSHEET_ID");

  if (!id) {
    throw new Error("Run setup() first.");
  }

  return SpreadsheetApp.openById(id);
}

// Receive submissions from the application.
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Missing request body.");
    }

    const payload = JSON.parse(e.postData.contents);
    return jsonResponse(saveSubmission(payload));

  } catch (error) {
    return jsonResponse({
      success: false,
      error: error.message
    });
  }
}

// Prevent spreadsheet formulas in user-provided text.
function safeCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (
    typeof value === "string" &&
    /^\s*[=+\-@]/.test(value)
  ) {
    return "'" + value;
  }

  return value;
}

// Save an entire participant submission.
function saveSubmission(payload) {
  const participantId = payload && payload.participantId;

  if (
    typeof participantId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(participantId)
  ) {
    throw new Error("Invalid participant ID.");
  }

  const demographics = payload.demographics;
  const assessments = payload.assessments;
  const learning = payload.learning;
  const performance = payload.performance;
  const videoSets = payload.videoSets;

  if (
    !demographics ||
    !assessments ||
    !learning ||
    !performance ||
    !videoSets ||
    !performance.pre ||
    !performance.post ||
    !Array.isArray(assessments.pre?.responses) ||
    !Array.isArray(assessments.post?.responses) ||
    !Array.isArray(learning.completedModuleIds) ||
    !learning.quizAnswers ||
    (payload.condition !== 1 && payload.condition !== 2) ||
    !["A", "B"].includes(videoSets.pre) ||
    !["A", "B"].includes(videoSets.post) ||
    videoSets.pre === videoSets.post ||
    learning.isComplete !== true
  ) {
    throw new Error("Invalid or incomplete submission.");
  }

  const pre = performance.pre;
  const post = performance.post;

  // Prepare the participant row.
  const participantRow = [
    new Date(),
    participantId,
    safeCell(demographics.age),
    safeCell(demographics.gender),
    safeCell(demographics.education_level),
    safeCell(demographics.political_leaning),
    safeCell(demographics.ai_sentiment),
    safeCell(demographics.deepfake_exposure_frequency),
    demographics.deepfake_exposure_channels === undefined
      ? ""
      : JSON.stringify(demographics.deepfake_exposure_channels),
    safeCell(demographics.political_deepfake_exposure),
    payload.condition,
    videoSets.pre,
    videoSets.post,
    JSON.stringify(learning.completedModuleIds),
    JSON.stringify(learning.quizAnswers),
    learning.isComplete,
    pre.correctClassifications,
    pre.totalClassifications,
    pre.accuracyPercent,
    pre.averageConfidencePercent,
    post.correctClassifications,
    post.totalClassifications,
    post.accuracyPercent,
    post.averageConfidencePercent,
    performance.accuracyDifferencePercentagePoints,
    JSON.stringify(demographics),
    JSON.stringify(payload)
  ].map(safeCell);

  // Prepare one row for every assessed video.
  const videoRows = ["pre", "post"].flatMap(stage => {
    return assessments[stage].responses.map(response => {
      if (
        !response.videoId ||
        !["real", "fake"].includes(response.correctLabel) ||
        !["real", "fake"].includes(response.classification) ||
        !Array.isArray(response.selectedClues)
      ) {
        throw new Error("Invalid video response.");
      }

      return [
        participantId,
        stage,
        safeCell(response.videoId),
        response.correctLabel,
        response.classification,
        response.classification === response.correctLabel,
        response.confidence,
        JSON.stringify(response.selectedClues)
      ];
    });
  });

  if (videoRows.length === 0) {
    throw new Error("No video responses provided.");
  }

  // Prevent concurrent submissions from interfering.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const spreadsheet = getSpreadsheet();

    const participants = spreadsheet.getSheetByName(
      PARTICIPANTS_SHEET
    );

    const responses = spreadsheet.getSheetByName(
      RESPONSES_SHEET
    );

    if (!participants || !responses) {
      throw new Error("Required sheets not found.");
    }

    // Check whether this participant was already saved.
    const participantCount = participants.getLastRow();

    if (participantCount > 1) {
      const existingIds = participants
        .getRange(2, 2, participantCount - 1, 1)
        .getValues()
        .flat();

      if (existingIds.includes(participantId)) {
        return {
          success: true,
          duplicate: true,
          participantId
        };
      }
    }

    // Remove any incomplete video rows left by an earlier
    // failed submission of this participant.
    const responseCount = responses.getLastRow();

    if (responseCount > 1) {
      const responseIds = responses
        .getRange(2, 1, responseCount - 1, 1)
        .getValues()
        .flat();

      for (let i = responseIds.length - 1; i >= 0; i--) {
        if (responseIds[i] === participantId) {
          responses.deleteRow(i + 2);
        }
      }
    }

    // Save video responses first.
    responses
      .getRange(
        responses.getLastRow() + 1,
        1,
        videoRows.length,
        RESPONSE_HEADERS.length
      )
      .setValues(videoRows);

    SpreadsheetApp.flush();

    // Save participant last, marking submission completion.
    participants
      .getRange(
        participants.getLastRow() + 1,
        1,
        1,
        PARTICIPANT_HEADERS.length
      )
      .setValues([participantRow]);

    SpreadsheetApp.flush();

    return {
      success: true,
      duplicate: false,
      participantId
    };

  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
function testSubmission() {
  const payload = {
    participantId: "TEST_" + Date.now(),

    demographics: {
      age: 23,
      gender: "Woman",
      education_level: "University degree",
      political_leaning: 4,
      ai_sentiment: "Equally concerned and excited",
      deepfake_exposure_frequency: "Once",
      deepfake_exposure_channels: ["YouTube"],
      political_deepfake_exposure: "No"
    },

    condition: 1,
    videoSets: {
      pre: "A",
      post: "B"
    },

    assessments: {
      pre: {
        responses: [
          {
            videoId: "t-01",
            correctLabel: "fake",
            classification: "fake",
            confidence: 75,
            selectedClues: ["general_impression"]
          },
          {
            videoId: "t-02",
            correctLabel: "real",
            classification: "real",
            confidence: 75,
            selectedClues: ["general_impression"]
          },
          {
            videoId: "b-01",
            correctLabel: "fake",
            classification: "fake",
            confidence: 75,
            selectedClues: ["general_impression"]
          },
          {
            videoId: "b-02",
            correctLabel: "real",
            classification: "real",
            confidence: 75,
            selectedClues: ["general_impression"]
          }
        ]
      },
      post: {
        responses: [
          {
            videoId: "t-03",
            correctLabel: "fake",
            classification: "fake",
            confidence: 75,
            selectedClues: ["general_impression"]
          },
          {
            videoId: "t-04",
            correctLabel: "real",
            classification: "real",
            confidence: 75,
            selectedClues: ["general_impression"]
          },
          {
            videoId: "b-03",
            correctLabel: "fake",
            classification: "fake",
            confidence: 75,
            selectedClues: ["general_impression"]
          },
          {
            videoId: "b-04",
            correctLabel: "real",
            classification: "real",
            confidence: 75,
            selectedClues: ["general_impression"]
          }
        ]
      }
    },

    learning: {
      completedModuleIds: [
        "deepfake-clues",
        "check-understanding"
      ],
      quizAnswers: {
        q1: "c",
        q2: "b",
        q3: "a",
        q4: "c"
      },
      isComplete: true
    },

    performance: {
      pre: {
        correctClassifications: 4,
        totalClassifications: 4,
        accuracyPercent: 100,
        averageConfidencePercent: 75
      },
      post: {
        correctClassifications: 4,
        totalClassifications: 4,
        accuracyPercent: 100,
        averageConfidencePercent: 75
      },
      accuracyDifferencePercentagePoints: 0
    }
  };

  console.log("First submission:");
  console.log(saveSubmission(payload));

  console.log("Duplicate submission:");
  console.log(saveSubmission(payload));
}

// Check whether a participant's results were saved.
// Returns only the submission status, never personal data.

function doGet(e) {
  const params = e.parameter || {};

  const participantId = params.participantId || "";
  const callback = params.callback || "";

  // Allow only simple, safe JavaScript callback names.
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]{0,79}$/.test(callback)) {
    return ContentService.createTextOutput(
      "Invalid callback"
    );
  }

  let saved = false;

  if (/^[a-zA-Z0-9_-]{1,100}$/.test(participantId)) {
    const sheet = getSpreadsheet()
      .getSheetByName(PARTICIPANTS_SHEET);

    if (!sheet) {
      throw new Error("Participants sheet not found.");
    }

    const lastRow = sheet.getLastRow();

    if (lastRow > 1) {
      const match = sheet
        .getRange(2, 2, lastRow - 1, 1)
        .createTextFinder(participantId)
        .matchEntireCell(true)
        .findNext();

      saved = match !== null;
    }
  }

  const result = {
    participantId: participantId,
    saved: saved
  };

  return ContentService
    .createTextOutput(
      callback + "(" + JSON.stringify(result) + ");"
    )
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
