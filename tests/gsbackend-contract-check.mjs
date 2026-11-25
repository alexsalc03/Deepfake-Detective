import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const backendSource = await readFile(
    new URL("../gsscript/gsbackend.gs", import.meta.url),
    "utf8",
);

function createSheet() {
    const rows = [];

    return {
        rows,
        getLastRow() {
            return rows.length + 1;
        },
        getRange(row, column, rowCount, columnCount) {
            return {
                getValues() {
                    return Array.from({ length: rowCount }, (_, rowOffset) =>
                        Array.from(
                            { length: columnCount },
                            (_, columnOffset) =>
                                rows[row + rowOffset - 2]?.[
                                    column + columnOffset - 1
                                ] ?? "",
                        ),
                    );
                },
                setValues(values) {
                    values.forEach((value, index) => {
                        rows[row + index - 2] = [...value];
                    });
                },
                createTextFinder(searchText) {
                    let matchEntireCell = false;
                    return {
                        matchEntireCell(value) {
                            matchEntireCell = value;
                            return this;
                        },
                        findNext() {
                            const values = Array.from(
                                { length: rowCount },
                                (_, rowOffset) =>
                                    rows[row + rowOffset - 2]?.[column - 1] ?? "",
                            );
                            return values.some((value) =>
                                matchEntireCell
                                    ? value === searchText
                                    : String(value).includes(searchText),
                            )
                                ? {}
                                : null;
                        },
                    };
                },
            };
        },
        deleteRow(row) {
            rows.splice(row - 2, 1);
        },
    };
}

function loadBackend() {
    const participants = createSheet();
    const responses = createSheet();
    const spreadsheet = {
        getSheetByName(name) {
            if (name === "Participants") return participants;
            if (name === "VideoResponses") return responses;
            return null;
        },
    };
    const lock = {
        waitLock() {},
        releaseLock() {},
    };
    const context = {
        console,
        LockService: {
            getScriptLock: () => lock,
        },
        PropertiesService: {
            getScriptProperties: () => ({
                getProperty: () => "test-spreadsheet",
                setProperty() {},
            }),
        },
        SpreadsheetApp: {
            openById: () => spreadsheet,
            flush() {},
        },
        ContentService: {
            MimeType: { JSON: "json", JAVASCRIPT: "javascript" },
            createTextOutput: (content = "") => ({
                content,
                mimeType: null,
                setMimeType(mimeType) {
                    this.mimeType = mimeType;
                    return this;
                },
            }),
        },
    };

    vm.runInNewContext(
        `${backendSource}\nthis.__backend = { PARTICIPANT_HEADERS, saveSubmission, testSubmission, doGet };`,
        context,
    );

    return { ...context.__backend, participants, responses };
}

function currentPayload() {
    const response = (videoId, correctLabel) => ({
        videoId,
        correctLabel,
        classification: correctLabel,
        confidence: 75,
        selectedClues: ["general_impression"],
    });

    return {
        participantId: "CONTRACT_TEST",
        demographics: {
            age: 23,
            gender: "Woman",
            education_level: "University degree",
            political_leaning: 4,
            ai_sentiment: "Equally concerned and excited",
            deepfake_exposure_frequency: "Once",
            deepfake_exposure_channels: ["YouTube"],
            political_deepfake_exposure: "No",
        },
        condition: 1,
        videoSets: { pre: "A", post: "B" },
        assessments: {
            pre: {
                responses: [
                    response("t-01", "fake"),
                    response("t-02", "real"),
                    response("b-01", "fake"),
                    response("b-02", "real"),
                ],
            },
            post: {
                responses: [
                    response("t-03", "fake"),
                    response("t-04", "real"),
                    response("b-03", "fake"),
                    response("b-04", "real"),
                ],
            },
        },
        learning: {
            completedModuleIds: [
                "deepfake-clues",
                "check-understanding",
            ],
            quizAnswers: { q1: "c", q2: "b", q3: "a", q4: "c" },
            isComplete: true,
        },
        performance: {
            pre: {
                correctClassifications: 4,
                totalClassifications: 4,
                accuracyPercent: 100,
                averageConfidencePercent: 75,
            },
            post: {
                correctClassifications: 4,
                totalClassifications: 4,
                accuracyPercent: 100,
                averageConfidencePercent: 75,
            },
            accuracyDifferencePercentagePoints: 0,
        },
    };
}

{
    const { PARTICIPANT_HEADERS, saveSubmission, participants, responses } =
        loadBackend();

    const firstResult = saveSubmission(currentPayload());
    const duplicateResult = saveSubmission(currentPayload());

    assert.deepEqual(
        Array.from(PARTICIPANT_HEADERS.slice(5, 10)),
        [
            "Political Leaning",
            "AI Sentiment",
            "Deepfake Exposure Frequency",
            "Deepfake Exposure Channels JSON",
            "Political Deepfake Exposure",
        ],
        "participant headers match the current questionnaire",
    );
    assert.deepEqual(
        participants.rows[0].slice(5, 10),
        [
            4,
            "Equally concerned and excited",
            "Once",
            '["YouTube"]',
            "No",
        ],
        "current demographic answers are written to dedicated columns",
    );
    assert.equal(
        participants.rows[0].length,
        PARTICIPANT_HEADERS.length,
        "participant values align with their headers",
    );
    assert.equal(
        participants.rows[0][13],
        '["deepfake-clues","check-understanding"]',
        "both current learning modules are serialized",
    );
    assert.equal(
        participants.rows[0][14],
        '{"q1":"c","q2":"b","q3":"a","q4":"c"}',
        "all four quiz answers are serialized into the existing JSON column",
    );
    assert.equal(responses.rows.length, 8, "all eight video responses are saved");
    assert.deepEqual(
        { ...firstResult },
        { success: true, duplicate: false, participantId: "CONTRACT_TEST" },
        "the first submission is saved",
    );
    assert.deepEqual(
        { ...duplicateResult },
        { success: true, duplicate: true, participantId: "CONTRACT_TEST" },
        "duplicate participant submissions are acknowledged without extra rows",
    );
    assert.equal(participants.rows.length, 1, "duplicates do not add participant rows");
    assert.equal(responses.rows.length, 8, "duplicates do not add response rows");

    const { doGet } = loadBackend();
    const unsavedLookup = doGet({
        parameter: { participantId: "CONTRACT_TEST", callback: "verifyResult" },
    });
    assert.equal(
        unsavedLookup.content,
        'verifyResult({"participantId":"CONTRACT_TEST","saved":false});',
        "JSONP verification reports an unsaved participant without personal data",
    );

    const savedBackend = loadBackend();
    savedBackend.saveSubmission(currentPayload());
    const savedLookup = savedBackend.doGet({
        parameter: { participantId: "CONTRACT_TEST", callback: "verifyResult" },
    });
    assert.equal(
        savedLookup.content,
        'verifyResult({"participantId":"CONTRACT_TEST","saved":true});',
        "JSONP verification reports a saved participant",
    );
}

{
    const { testSubmission, participants, responses } = loadBackend();

    testSubmission();

    assert.deepEqual(
        responses.rows.map((row) => row[2]),
        ["t-01", "t-02", "b-01", "b-02", "t-03", "t-04", "b-03", "b-04"],
        "the manual Apps Script test uses the current video IDs",
    );
    assert.equal(
        participants.rows[0][13],
        '["deepfake-clues","check-understanding"]',
        "the manual Apps Script test uses the current module IDs",
    );
    assert.equal(
        participants.rows[0][14],
        '{"q1":"c","q2":"b","q3":"a","q4":"c"}',
        "the manual Apps Script test includes all four quiz answers",
    );
}

console.log("Google Sheets backend contract check passed.");
