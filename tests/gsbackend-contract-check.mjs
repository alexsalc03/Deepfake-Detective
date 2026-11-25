import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { Worker } from "node:worker_threads";

const backendSource = await readFile(
    new URL("../gsscript/gsbackend.gs", import.meta.url),
    "utf8",
);

function createSheet(onAccess = () => {}) {
    const rows = [];

    return {
        rows,
        getLastRow() {
            onAccess("getLastRow");
            return rows.length + 1;
        },
        getRange(row, column, rowCount, columnCount) {
            onAccess("getRange");
            return {
                getValues() {
                    onAccess("getValues");
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
                    onAccess("setValues");
                    values.forEach((value, index) => {
                        rows[row + index - 2] = [...value];
                    });
                    if (rows.failAfterNextWrite) {
                        rows.failAfterNextWrite = false;
                        throw new Error("Synthetic interrupted write");
                    }
                },
                createTextFinder(searchText) {
                    onAccess("createTextFinder");
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
            onAccess("deleteRow");
            rows.splice(row - 2, 1);
        },
    };
}

function loadBackend({ enforceLock = false } = {}) {
    const lockState = {
        held: false,
        acquisitions: 0,
        releases: 0,
        operations: [],
    };
    const assertLockHeld = (operation) => {
        if (enforceLock && !lockState.held) {
            throw new Error(`Spreadsheet operation outside lock: ${operation}`);
        }
        lockState.operations.push(operation);
    };
    const participants = createSheet((operation) =>
        assertLockHeld(`participants:${operation}`),
    );
    const responses = createSheet((operation) =>
        assertLockHeld(`responses:${operation}`),
    );
    const spreadsheet = {
        getSheetByName(name) {
            assertLockHeld("getSheetByName");
            if (name === "Participants") return participants;
            if (name === "VideoResponses") return responses;
            return null;
        },
    };
    const lock = {
        waitLock() {
            if (lockState.held) {
                throw new Error("Synthetic lock re-entry");
            }
            lockState.held = true;
            lockState.acquisitions += 1;
        },
        releaseLock() {
            lockState.held = false;
            lockState.releases += 1;
        },
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
            flush() {
                assertLockHeld("flush");
            },
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

    return {
        ...context.__backend,
        participants,
        responses,
        lockState,
    };
}

function runConcurrentDuplicateSubmission(payload) {
    const coordination = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 5);
    const stateBuffer = new SharedArrayBuffer(1024 * 1024);
    const sync = new Int32Array(coordination);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const initialBytes = encoder.encode(
        JSON.stringify({ participants: [], responses: [] }),
    );
    new Uint8Array(stateBuffer, 4, initialBytes.length).set(initialBytes);
    Atomics.store(sync, 4, initialBytes.length);

    const workerSource = `
        const { parentPort, workerData } = require("node:worker_threads");
        const vm = require("node:vm");
        const sync = new Int32Array(workerData.coordination);
        const stateBuffer = workerData.stateBuffer;
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        function readState() {
            const length = Atomics.load(sync, 4);
            return JSON.parse(
                decoder.decode(new Uint8Array(stateBuffer, 4, length))
            );
        }

        function writeState(state) {
            const bytes = encoder.encode(JSON.stringify(state));
            new Uint8Array(stateBuffer, 4, bytes.length).set(bytes);
            Atomics.store(sync, 4, bytes.length);
        }

        function createSheet(name) {
            return {
                getLastRow() {
                    return readState()[name].length + 1;
                },
                getRange(row, column, rowCount, columnCount) {
                    return {
                        getValues() {
                            const rows = readState()[name];
                            return Array.from(
                                { length: rowCount },
                                (_, rowOffset) =>
                                    Array.from(
                                        { length: columnCount },
                                        (_, columnOffset) =>
                                            rows[row + rowOffset - 2]?.[
                                                column + columnOffset - 1
                                            ] ?? ""
                                    )
                            );
                        },
                        setValues(values) {
                            const state = readState();
                            values.forEach((value, index) => {
                                state[name][row + index - 2] = [...value];
                            });
                            writeState(state);
                        }
                    };
                },
                deleteRow(row) {
                    const state = readState();
                    state[name].splice(row - 2, 1);
                    writeState(state);
                }
            };
        }

        const participants = createSheet("participants");
        const responses = createSheet("responses");
        const spreadsheet = {
            getSheetByName(name) {
                if (name === "Participants") return participants;
                if (name === "VideoResponses") return responses;
                return null;
            }
        };
        const lock = {
            waitLock() {
                while (
                    Atomics.compareExchange(sync, 0, 0, 1) !== 0
                ) {
                    Atomics.wait(sync, 0, 1);
                }
            },
            releaseLock() {
                Atomics.store(sync, 0, 0);
                Atomics.notify(sync, 0);
            }
        };
        const context = {
            console,
            LockService: {
                getScriptLock: () => lock
            },
            PropertiesService: {
                getScriptProperties: () => ({
                    getProperty: () => "test-spreadsheet",
                    setProperty() {}
                })
            },
            SpreadsheetApp: {
                openById: () => spreadsheet,
                flush() {}
            },
            ContentService: {
                MimeType: { JSON: "json", JAVASCRIPT: "javascript" },
                createTextOutput: (content = "") => ({
                    content,
                    mimeType: null,
                    setMimeType(mimeType) {
                        this.mimeType = mimeType;
                        return this;
                    }
                })
            }
        };

        vm.runInNewContext(
            workerData.backendSource +
                "\\nthis.__backend = { saveSubmission };",
            context
        );

        Atomics.add(sync, 1, 1);
        Atomics.notify(sync, 1);
        while (Atomics.load(sync, 2) === 0) {
            Atomics.wait(sync, 2, 0);
        }

        try {
            parentPort.postMessage({
                result: context.__backend.saveSubmission(workerData.payload)
            });
        } catch (error) {
            parentPort.postMessage({ error: error.message });
        } finally {
            Atomics.add(sync, 3, 1);
            Atomics.notify(sync, 3);
        }
    `;

    const workerData = {
        backendSource,
        payload,
        coordination,
        stateBuffer,
    };
    const workers = [
        new Worker(workerSource, { eval: true, workerData }),
        new Worker(workerSource, { eval: true, workerData }),
    ];
    const results = workers.map(
        (worker) =>
            new Promise((resolveResult, rejectResult) => {
                worker.once("message", resolveResult);
                worker.once("error", rejectResult);
            }),
    );

    while (Atomics.load(sync, 1) < 2) {
        Atomics.wait(sync, 1, Atomics.load(sync, 1), 1000);
    }
    Atomics.store(sync, 2, 1);
    Atomics.notify(sync, 2, 2);

    return Promise.all(results).then((workerResults) => {
        const length = Atomics.load(sync, 4);
        const state = JSON.parse(
            decoder.decode(new Uint8Array(stateBuffer, 4, length)),
        );
        return Promise.all(workers.map((worker) => worker.terminate())).then(
            () => ({
                workerResults,
                state,
            }),
        );
    });
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
                ],
            },
            post: {
                responses: [
                    response("t-03", "fake"),
                    response("t-04", "real"),
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
                correctClassifications: 2,
                totalClassifications: 2,
                accuracyPercent: 100,
                averageConfidencePercent: 75,
            },
            post: {
                correctClassifications: 2,
                totalClassifications: 2,
                accuracyPercent: 100,
                averageConfidencePercent: 75,
            },
            accuracyDifferencePercentagePoints: 0,
        },
    };
}

{
    const {
        PARTICIPANT_HEADERS,
        saveSubmission,
        participants,
        responses,
        lockState,
    } = loadBackend({ enforceLock: true });

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
    assert.equal(responses.rows.length, 4, "all four video responses are saved");
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
    assert.equal(responses.rows.length, 4, "duplicates do not add response rows");
    assert.equal(
        lockState.acquisitions,
        2,
        "each sequential submission acquires the script lock",
    );
    assert.equal(
        lockState.releases,
        2,
        "each sequential submission releases the script lock",
    );
    const responseWriteIndex = lockState.operations.indexOf(
        "responses:setValues",
    );
    const responseFlushIndex = lockState.operations.indexOf(
        "flush",
        responseWriteIndex,
    );
    const participantWriteIndex = lockState.operations.indexOf(
        "participants:setValues",
        responseFlushIndex,
    );
    assert.equal(
        responseWriteIndex >= 0 &&
            responseFlushIndex > responseWriteIndex &&
            participantWriteIndex > responseFlushIndex,
        true,
        "responses are flushed before the participant completion row is written",
    );

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

    const missingCallbackLookup = savedBackend.doGet({
        parameter: { participantId: "CONTRACT_TEST" },
    });
    assert.equal(
        missingCallbackLookup.content,
        "Invalid callback",
        "JSONP verification rejects a missing callback parameter",
    );

    const invalidCallbackLookup = savedBackend.doGet({
        parameter: {
            participantId: "CONTRACT_TEST",
            callback: "bad();alert(1)//",
        },
    });
    assert.equal(
        invalidCallbackLookup.content,
        "Invalid callback",
        "JSONP verification rejects executable callback code",
    );
}

{
    const {
        saveSubmission,
        participants,
        responses,
        lockState,
    } = loadBackend({ enforceLock: true });
    const payload = currentPayload();

    responses.rows.push([
        payload.participantId,
        "pre",
        "t-01",
        "fake",
        "fake",
        true,
        75,
        '["general_impression"]',
    ]);

    const recoveredResult = saveSubmission(payload);

    assert.equal(recoveredResult.duplicate, false);
    assert.equal(
        responses.rows.length,
        4,
        "retry replaces incomplete video rows for the same participant",
    );
    assert.equal(
        participants.rows.length,
        1,
        "retry creates the missing participant row exactly once",
    );

    const interruptedPayload = {
        ...payload,
        participantId: "INTERRUPTED_TEST",
    };
    responses.rows.failAfterNextWrite = true;

    assert.throws(
        () => saveSubmission(interruptedPayload),
        /Synthetic interrupted write/,
        "a partial response write fails before the participant row is saved",
    );
    assert.equal(
        participants.rows.some(
            (row) => row[1] === interruptedPayload.participantId,
        ),
        false,
        "an interrupted write does not mark the participant complete",
    );

    const retryResult = saveSubmission(interruptedPayload);

    assert.equal(retryResult.duplicate, false);
    assert.equal(
        participants.rows.filter(
            (row) => row[1] === interruptedPayload.participantId,
        ).length,
        1,
        "a retry after interruption stores one participant row",
    );
    assert.equal(
        responses.rows.filter(
            (row) => row[0] === interruptedPayload.participantId,
        ).length,
        4,
        "a retry after interruption stores four video-response rows",
    );
    assert.equal(
        lockState.held,
        false,
        "the script lock is released after successful and failed writes",
    );
}

{
    const payload = {
        ...currentPayload(),
        participantId: "CONCURRENT_TEST",
    };
    const { workerResults, state } =
        await runConcurrentDuplicateSubmission(payload);
    const successfulResults = workerResults.map(({ result, error }) => {
        assert.equal(error, undefined, "concurrent submission completes");
        return result;
    });

    assert.deepEqual(
        successfulResults.map(({ duplicate }) => duplicate).sort(),
        [false, true],
        "one concurrent submission saves and the other is acknowledged as a duplicate",
    );
    assert.equal(
        state.participants.length,
        1,
        "concurrent duplicates create one participant row",
    );
    assert.equal(
        state.responses.length,
        4,
        "concurrent duplicates create four video-response rows",
    );
    assert.equal(
        state.participants[0][1],
        payload.participantId,
        "the saved participant keeps the submitted ID",
    );
}

{
    const { testSubmission, participants, responses } = loadBackend();

    testSubmission();

    assert.deepEqual(
        responses.rows.map((row) => row[2]),
        ["t-01", "t-02", "t-03", "t-04"],
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
