import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");

async function getAvailablePort() {
    return new Promise((resolvePort, reject) => {
        const server = createServer();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            server.close(() => resolvePort(port));
        });
    });
}

async function waitForHttp(url, timeout = 10000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // The local processes may still be starting.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }

    throw new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
    constructor(webSocketUrl) {
        this.webSocketUrl = webSocketUrl;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
    }

    async connect() {
        this.socket = new WebSocket(this.webSocketUrl);
        await new Promise((resolveOpen, reject) => {
            this.socket.addEventListener("open", resolveOpen, { once: true });
            this.socket.addEventListener("error", reject, { once: true });
        });
        this.socket.addEventListener("message", (event) => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const request = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (message.error) request.reject(new Error(message.error.message));
                else request.resolve(message.result);
                return;
            }
            (this.listeners.get(message.method) ?? []).forEach((handler) =>
                handler(message.params),
            );
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        this.socket.send(JSON.stringify({ id, method, params }));
        return new Promise((resolveRequest, rejectRequest) => {
            this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        });
    }

    on(method, handler) {
        const handlers = this.listeners.get(method) ?? [];
        handlers.push(handler);
        this.listeners.set(method, handlers);
    }

    async evaluate(expression) {
        const result = await this.send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
        });
        if (result.exceptionDetails) {
            throw new Error(
                result.exceptionDetails.exception?.description ??
                    result.exceptionDetails.text,
            );
        }
        return result.result.value;
    }

    close() {
        this.socket?.close();
    }
}

async function waitFor(client, expression, label, timeout = 10000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
        if (await client.evaluate(`Boolean(${expression})`)) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`Timed out waiting for ${label}`);
}

async function setViewport(client, width, height, mobile = false) {
    await client.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile,
    });
}

async function captureViewport(client, path) {
    const screenshot = await client.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
    });
    await writeFile(path, Buffer.from(screenshot.data, "base64"));
}

async function run() {
    const serverPort = await getAvailablePort();
    const chromePort = await getAvailablePort();
    const chromeProfile = await mkdtemp(join(tmpdir(), "phase10-chrome-"));
    const consoleErrors = [];
    let server;
    let chrome;
    let client;

    try {
        server = spawn(
            "python3",
            ["-m", "http.server", String(serverPort), "--bind", "127.0.0.1"],
            { cwd: projectRoot, stdio: "ignore" },
        );
        await waitForHttp(`http://127.0.0.1:${serverPort}/`);
        chrome = spawn(
            process.env.CHROME_BIN || "google-chrome",
            [
                "--headless=new",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-first-run",
                "--remote-allow-origins=*",
                `--remote-debugging-port=${chromePort}`,
                `--user-data-dir=${chromeProfile}`,
                "about:blank",
            ],
            { cwd: projectRoot, stdio: "ignore" },
        );
        await waitForHttp(`http://127.0.0.1:${chromePort}/json/version`);
        const targets = await (
            await fetch(`http://127.0.0.1:${chromePort}/json/list`)
        ).json();
        const pageTarget = targets.find((target) => target.type === "page");
        assert.ok(pageTarget?.webSocketDebuggerUrl, "Chrome page target exists");

        client = new CdpClient(pageTarget.webSocketDebuggerUrl);
        await client.connect();
        await Promise.all([
            client.send("Page.enable"),
            client.send("Runtime.enable"),
            client.send("Log.enable"),
        ]);
        client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
            consoleErrors.push(
                exceptionDetails.exception?.description ?? exceptionDetails.text,
            );
        });
        client.on("Runtime.consoleAPICalled", ({ type, args }) => {
            if (type === "error") {
                consoleErrors.push(
                    args.map((arg) => arg.value ?? arg.description).join(" "),
                );
            }
        });
        client.on("Log.entryAdded", ({ entry }) => {
            if (entry.level === "error") consoleErrors.push(entry.text);
        });

        await client.send("Page.navigate", {
            url: `http://127.0.0.1:${serverPort}/`,
        });
        await waitFor(
            client,
            "document.readyState === 'complete' && assessmentContentReady && learningContentReady",
            "application content",
        );

        const initialFlow = await client.evaluate(`
            ({
                stageIds: stages.map((stage) => stage.id),
                progressStepCount: document.querySelectorAll("[data-stage-id]").length,
                resultsHidden: document.querySelector("#results-screen").hidden
            })
        `);
        assert.deepEqual(initialFlow, {
            stageIds: [
                "welcome",
                "pre-assessment",
                "learning",
                "post-assessment",
                "submission",
                "results",
            ],
            progressStepCount: 6,
            resultsHidden: true,
        });

        await client.evaluate(`
            (() => {
                participantSession.participantId = "PHASE10_TEST_PARTICIPANT";
                participantSession.consentProvided = true;
                participantSession.demographics = {
                    age: 30,
                    gender: "Woman",
                    education_level: "University degree",
                    political_leaning: 4,
                    ai_sentiment: "Unsure",
                    deepfake_exposure_frequency: "Never"
                };
                participantSession.condition = 1;
                participantSession.videoSets = { pre: "A", post: "B" };
                participantSession.assessmentAnswers = [
                    { stage: "pre", videoId: "t-01", videoPosition: 1, answer: "fake", confidence: 40, clues: ["facial_movements"] },
                    { stage: "pre", videoId: "t-02", videoPosition: 2, answer: "real", confidence: 50, clues: ["facial_movements"] },
                    { stage: "pre", videoId: "b-01", videoPosition: 3, answer: "fake", confidence: 60, clues: ["facial_movements"] },
                    { stage: "pre", videoId: "b-02", videoPosition: 4, answer: "fake", confidence: 70, clues: ["facial_movements"] },
                    { stage: "post", videoId: "t-03", videoPosition: 1, answer: "fake", confidence: 70, clues: ["facial_movements"] },
                    { stage: "post", videoId: "t-04", videoPosition: 2, answer: "fake", confidence: 80, clues: ["facial_movements"] },
                    { stage: "post", videoId: "b-03", videoPosition: 3, answer: "fake", confidence: 90, clues: ["facial_movements"] }
                ];
                participantSession.assessmentProgress = {
                    pre: { videoIndex: 4 },
                    post: { videoIndex: 3 }
                };
                participantSession.learning = {
                    completedModuleIds: ["deepfake-clues", "check-understanding"],
                    selectedQuizAnswers: { q1: "a", q2: "b", q3: "a", q4: "c" },
                    isComplete: true
                };
                showStage(
                    stages.findIndex((stage) => stage.id === "post-assessment"),
                    false
                );
                return true;
            })()
        `);

        await waitFor(
            client,
            "assessmentContentReady && !document.querySelector('#assessment-submit').disabled",
            "final post-assessment video",
        );
        await client.evaluate(`
            (() => {
                document.querySelector(
                    '#assessment-questions input[name="assessment-classification"][value="real"]'
                ).click();
                const confidence = document.querySelector("#assessment-confidence");
                confidence.value = "100";
                confidence.dispatchEvent(new Event("input", { bubbles: true }));
                document.querySelector(
                    '#assessment-questions input[name="assessment-clues"][value="facial_movements"]'
                ).click();
                document.querySelector("#assessment-submit").click();
                return true;
            })()
        `);
        await waitFor(
            client,
            "document.body.dataset.activeStage === 'submission'",
            "submission stage after the fourth post-assessment video",
        );

        const readyState = await client.evaluate(`
            ({
                title: document.querySelector("#submission-title").textContent.trim(),
                description: document.querySelector("#submission-description").textContent.trim().replace(/\\s+/g, " "),
                submitText: document.querySelector("#submit-results").textContent.trim(),
                submitDisabled: document.querySelector("#submit-results").disabled,
                viewResultsHidden: document.querySelector("#view-results").hidden,
                resultsHidden: document.querySelector("#results-screen").hidden,
                resultsInDom: document.querySelector("#results-screen #submit-results") !== null,
                newParticipantInSubmission:
                    document.querySelector("#submission-screen #new-participant") !== null
            })
        `);
        assert.deepEqual(readyState, {
            title: "Experiment Complete",
            description:
                "You have completed all parts of the experiment. Please submit your responses to view your results.",
            submitText: "Submit Results",
            submitDisabled: false,
            viewResultsHidden: true,
            resultsHidden: true,
            resultsInDom: false,
            newParticipantInSubmission: false,
        });

        const bypassAttempt = await client.evaluate(`
            (() => {
                renderResults();
                const afterRenderResults = document.body.dataset.activeStage;
                showStage(
                    stages.findIndex((stage) => stage.id === "results"),
                    false
                );
                document.querySelector("#view-results").click();
                return {
                    afterRenderResults,
                    stage: document.body.dataset.activeStage,
                    resultsHidden: document.querySelector("#results-screen").hidden
                };
            })()
        `);
        assert.deepEqual(bypassAttempt, {
            afterRenderResults: "submission",
            stage: "submission",
            resultsHidden: true,
        });

        await setViewport(client, 1440, 1000);
        assert.equal(
            await client.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth",
            ),
            true,
            "desktop submission does not overflow horizontally",
        );
        await captureViewport(client, "/tmp/phase10-submission-desktop.png");
        await setViewport(client, 390, 844, true);
        assert.equal(
            await client.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth",
            ),
            true,
            "mobile submission does not overflow horizontally",
        );
        await captureViewport(client, "/tmp/phase10-submission-mobile.png");

        const submittingState = await client.evaluate(`
            (() => {
                window.__phase10 = {
                    fetchCalls: [],
                    verificationRequests: [],
                    verificationMode: "failure"
                };
                window.fetch = async (url, options) => {
                    window.__phase10.fetchCalls.push({
                        url: String(url),
                        method: options?.method,
                        body: options?.body
                    });
                    return { type: "opaque" };
                };
                const appendChild = document.head.appendChild.bind(document.head);
                document.head.appendChild = (element) => {
                    if (element.tagName !== "SCRIPT") {
                        return appendChild(element);
                    }
                    const requestUrl = new URL(element.src);
                    const callbackName = requestUrl.searchParams.get("callback");
                    const request = {
                        participantId: requestUrl.searchParams.get("participantId"),
                        callbackName,
                        removed: false
                    };
                    window.__phase10.verificationRequests.push(request);
                    element.remove = () => {
                        request.removed = true;
                    };
                    setTimeout(() => {
                        if (window.__phase10.verificationMode === "success") {
                            window[callbackName]?.({
                                participantId: participantSession.participantId,
                                saved: true
                            });
                        } else if (window.__phase10.verificationRequests.length === 1) {
                            window[callbackName]?.({
                                participantId: "WRONG_PARTICIPANT",
                                saved: true
                            });
                        } else if (window.__phase10.verificationRequests.length === 2) {
                            window[callbackName]?.({
                                participantId: participantSession.participantId,
                                saved: false
                            });
                        } else {
                            element.onerror?.(new Event("error"));
                        }
                    }, 0);
                    return element;
                };
                document.querySelector("#submit-results").click();
                document.querySelector("#submit-results").click();
                return {
                    buttonText: document.querySelector("#submit-results").textContent.trim(),
                    buttonDisabled: document.querySelector("#submit-results").disabled,
                    status: document.querySelector("#submission-status").textContent.trim(),
                    loadingHidden: document.querySelector("#submission-loading").hidden,
                    sectionBusy: document.querySelector("#submission-screen").getAttribute("aria-busy")
                };
            })()
        `);
        assert.deepEqual(submittingState, {
            buttonText: "Submitting...",
            buttonDisabled: true,
            status: "Submitting your responses...",
            loadingHidden: false,
            sectionBusy: "true",
        });

        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "We couldn't confirm that your responses were saved. Please try again."`,
            "failed submission state",
        );
        const failedState = await client.evaluate(`
            (() => ({
                fetchCalls: window.__phase10.fetchCalls,
                verificationRequests: window.__phase10.verificationRequests,
                participantId: participantSession.participantId,
                assessmentAnswerCount: participantSession.assessmentAnswers.length,
                submitText: document.querySelector("#submit-results").textContent.trim(),
                submitDisabled: document.querySelector("#submit-results").disabled,
                viewResultsHidden: document.querySelector("#view-results").hidden,
                resultsHidden: document.querySelector("#results-screen").hidden,
                status: document.querySelector("#submission-status").textContent.trim(),
                loadingHidden: document.querySelector("#submission-loading").hidden,
                sectionBusy:
                    document.querySelector("#submission-screen").getAttribute("aria-busy") === "true"
            }))()
        `);
        assert.equal(failedState.fetchCalls.length, 1);
        assert.equal(failedState.verificationRequests.length, 3);
        assert.equal(
            failedState.verificationRequests.every(
                ({ participantId }) => participantId === "PHASE10_TEST_PARTICIPANT",
            ),
            true,
        );
        assert.equal(
            failedState.verificationRequests.every(
                ({ removed }) => removed,
            ),
            true,
        );
        assert.equal(
            new Set(
                failedState.verificationRequests.map(
                    ({ callbackName }) => callbackName,
                ),
            ).size,
            3,
        );
        assert.equal(failedState.participantId, "PHASE10_TEST_PARTICIPANT");
        assert.equal(failedState.assessmentAnswerCount, 8);
        assert.equal(failedState.submitText, "Retry Submission");
        assert.equal(failedState.submitDisabled, false);
        assert.equal(failedState.viewResultsHidden, true);
        assert.equal(failedState.resultsHidden, true);
        assert.equal(failedState.loadingHidden, true);
        assert.equal(failedState.sectionBusy, false);
        assert.equal(
            JSON.parse(failedState.fetchCalls[0].body).participantId,
            "PHASE10_TEST_PARTICIPANT",
        );

        await client.evaluate(`
            (() => {
                resetSubmissionState();
                window.__phase10.fetchCalls = [];
                window.__phase10.verificationRequests = [];
                window.fetch = async (url, options) => {
                    window.__phase10.fetchCalls.push({
                        url: String(url),
                        body: options?.body
                    });
                    throw new TypeError("Synthetic network failure");
                };
                document.querySelector("#submit-results").click();
                return true;
            })()
        `);
        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "We couldn't confirm that your responses were saved. Please try again."`,
            "network error submission state",
        );
        const networkErrorState = await client.evaluate(`
            ({
                fetchCallCount: window.__phase10.fetchCalls.length,
                verificationRequestCount:
                    window.__phase10.verificationRequests.length,
                participantId: participantSession.participantId,
                assessmentAnswerCount: participantSession.assessmentAnswers.length,
                viewResultsHidden: document.querySelector("#view-results").hidden,
                resultsHidden: document.querySelector("#results-screen").hidden
            })
        `);
        assert.deepEqual(networkErrorState, {
            fetchCallCount: 1,
            verificationRequestCount: 3,
            participantId: "PHASE10_TEST_PARTICIPANT",
            assessmentAnswerCount: 8,
            viewResultsHidden: true,
            resultsHidden: true,
        });

        const timeoutCleanup = await client.evaluate(`
            (async () => {
                const requestIndex = window.__phase10.verificationRequests.length;
                let rejected = false;
                try {
                    await verifyParticipantSaved("PHASE10_TEST_PARTICIPANT", 20);
                } catch {
                    rejected = true;
                }
                const callbackName = window.__phase10.verificationRequests[
                    requestIndex
                ].callbackName;
                return {
                    rejected,
                    callbackRemoved: typeof window[callbackName] === "undefined"
                };
            })()
        `);
        assert.deepEqual(timeoutCleanup, {
            rejected: true,
            callbackRemoved: true,
        });

        const retrySubmitting = await client.evaluate(`
            (() => {
                window.__phase10.verificationMode = "success";
                document.querySelector("#submit-results").click();
                return {
                    buttonText: document.querySelector("#submit-results").textContent.trim(),
                    buttonDisabled: document.querySelector("#submit-results").disabled,
                    status: document.querySelector("#submission-status").textContent.trim()
                };
            })()
        `);
        assert.deepEqual(retrySubmitting, {
            buttonText: "Submitting...",
            buttonDisabled: true,
            status: "Submitting your responses...",
        });
        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "Your responses have been saved successfully."`,
            "verified retry",
        );

        const successState = await client.evaluate(`
            ({
                fetchCallCount: window.__phase10.fetchCalls.length,
                verificationRequestCount: window.__phase10.verificationRequests.length,
                participantId: participantSession.participantId,
                submitHidden: document.querySelector("#submit-results").hidden,
                viewResultsText: document.querySelector("#view-results").textContent.trim(),
                viewResultsDisabled: document.querySelector("#view-results").disabled,
                viewResultsHidden: document.querySelector("#view-results").hidden,
                resultsHidden: document.querySelector("#results-screen").hidden
            })
        `);
        assert.deepEqual(successState, {
            fetchCallCount: 1,
            verificationRequestCount: 5,
            participantId: "PHASE10_TEST_PARTICIPANT",
            submitHidden: true,
            viewResultsText: "View Results",
            viewResultsDisabled: false,
            viewResultsHidden: false,
            resultsHidden: true,
        });

        await client.evaluate(
            'document.querySelector("#view-results").click(); true',
        );
        await waitFor(
            client,
            "document.body.dataset.activeStage === 'results'",
            "verified results stage",
        );
        const resultsState = await client.evaluate(`
            ({
                heading: document.querySelector("#results-title").textContent.trim(),
                preAccuracy: document.querySelector("#pre-accuracy").textContent.trim(),
                postAccuracy: document.querySelector("#post-accuracy").textContent.trim(),
                difference: document.querySelector("#accuracy-difference").textContent.trim(),
                resultsHidden: document.querySelector("#results-screen").hidden,
                submissionControlsInResults:
                    document.querySelector("#results-screen #submit-results") !== null ||
                    document.querySelector("#results-screen #submission-status") !== null,
                newParticipantDisabled: document.querySelector("#new-participant").disabled
            })
        `);
        assert.deepEqual(resultsState, {
            heading: "Study complete",
            preAccuracy: "75%",
            postAccuracy: "75%",
            difference: "0 percentage points",
            resultsHidden: false,
            submissionControlsInResults: false,
            newParticipantDisabled: false,
        });
        await captureViewport(client, "/tmp/phase10-results-mobile.png");

        const resetState = await client.evaluate(`
            (() => {
                document.querySelector("#new-participant").click();
                const resetStage = document.body.dataset.activeStage;
                const resetParticipantId = participantSession.participantId;
                showStage(
                    stages.findIndex((stage) => stage.id === "results"),
                    false
                );
                return {
                    resetStage,
                    resetParticipantId,
                    bypassStage: document.body.dataset.activeStage,
                    resultsHidden: document.querySelector("#results-screen").hidden,
                    submissionStatus: document.querySelector("#submission-status").textContent.trim()
                };
            })()
        `);
        assert.deepEqual(resetState, {
            resetStage: "welcome",
            resetParticipantId: null,
            bypassStage: "submission",
            resultsHidden: true,
            submissionStatus: "Your results have not been submitted.",
        });

        assert.deepEqual(consoleErrors, [], "no browser console errors");
        console.log("Phase 10 browser checks passed.");
        console.log("Screenshots: /tmp/phase10-submission-desktop.png");
        console.log("Screenshots: /tmp/phase10-submission-mobile.png");
        console.log("Screenshots: /tmp/phase10-results-mobile.png");
    } finally {
        client?.close();
        chrome?.kill("SIGTERM");
        server?.kill("SIGTERM");
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
