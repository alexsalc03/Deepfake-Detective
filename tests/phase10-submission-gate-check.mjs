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
                participantSession.selectedVideoIds = {
                    pre: ["t-01", "t-02"],
                    post: ["t-03", "t-04"]
                };
                participantSession.assessmentAnswers = [
                    { stage: "pre", videoId: "t-01", videoPosition: 1, answer: "fake", confidence: 40, clues: ["facial_movements"] },
                    { stage: "pre", videoId: "t-02", videoPosition: 2, answer: "fake", confidence: 50, clues: ["facial_movements"] },
                    { stage: "post", videoId: "t-03", videoPosition: 1, answer: "fake", confidence: 70, clues: ["facial_movements"] }
                ];
                participantSession.assessmentProgress = {
                    pre: { videoIndex: 2 },
                    post: { videoIndex: 1 }
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
            "second post-assessment video",
        );
        assert.equal(
            await client.evaluate(
                'document.querySelector("[data-video-position]").textContent.trim()',
            ),
            "Video 2 of 2",
            "Round-2 progress shows video 2 of 2",
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
            "submission stage after the second post-assessment video",
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
                    verificationResults: ["wrong", "false", "error"]
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
                    request.callback = window[callbackName];
                    window.__phase10.verificationRequests.push(request);
                    element.remove = () => {
                        request.removed = true;
                    };
                    setTimeout(() => {
                        const callback = window[callbackName];
                        if (!callback) {
                            return;
                        }
                        const result = window.__phase10.verificationResults.shift() ?? "error";
                        if (result === "success") {
                            callback({
                                participantId: participantSession.participantId,
                                saved: true
                            });
                        } else if (result === "wrong") {
                            callback({
                                participantId: "WRONG_PARTICIPANT",
                                saved: true
                            });
                        } else if (result === "false") {
                            callback({
                                participantId: participantSession.participantId,
                                saved: false
                            });
                        } else {
                            element.onerror?.(new Event("error"));
                        }
                    }, 50);
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
            `document.querySelector("#submission-status").textContent.trim() === "Checking that your responses were saved..."`,
            "automatic verification state",
        );
        assert.deepEqual(
            await client.evaluate(`
                ({
                    buttonText: document.querySelector("#submit-results").textContent.trim(),
                    buttonDisabled: document.querySelector("#submit-results").disabled,
                    loadingHidden: document.querySelector("#submission-loading").hidden
                })
            `),
            {
                buttonText: "Verifying Submission...",
                buttonDisabled: true,
                loadingHidden: false,
            },
            "automatic verification is visibly in progress",
        );

        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "We couldn't confirm that your responses were saved yet. Check again without resubmitting."`,
            "unconfirmed submission state",
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
        assert.equal(failedState.assessmentAnswerCount, 4);
        assert.equal(failedState.submitText, "Check Submission Again");
        assert.equal(failedState.submitDisabled, false);
        assert.equal(failedState.viewResultsHidden, true);
        assert.equal(failedState.resultsHidden, true);
        assert.equal(failedState.loadingHidden, true);
        assert.equal(failedState.sectionBusy, false);
        assert.equal(
            JSON.parse(failedState.fetchCalls[0].body).participantId,
            "PHASE10_TEST_PARTICIPANT",
        );
        assert.equal(
            JSON.parse(failedState.fetchCalls[0].body).assessments.pre.responses.length,
            2,
            "the original POST contains two Round-1 responses",
        );
        assert.equal(
            JSON.parse(failedState.fetchCalls[0].body).assessments.post.responses.length,
            2,
            "the original POST contains two Round-2 responses",
        );

        const retrySubmitting = await client.evaluate(`
            (() => {
                window.__phase10.verificationResults = ["success"];
                document.querySelector("#submit-results").click();
                document.querySelector("#submit-results").click();
                return {
                    buttonText: document.querySelector("#submit-results").textContent.trim(),
                    buttonDisabled: document.querySelector("#submit-results").disabled,
                    status: document.querySelector("#submission-status").textContent.trim()
                };
            })()
        `);
        assert.deepEqual(retrySubmitting, {
            buttonText: "Verifying Submission...",
            buttonDisabled: true,
            status: "Checking that your responses were saved...",
        });
        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "Your responses have been saved successfully."`,
            "verified manual retry",
        );

        const successState = await client.evaluate(`
            ({
                fetchCallCount: window.__phase10.fetchCalls.length,
                verificationRequestCount:
                    window.__phase10.verificationRequests.length,
                participantId: participantSession.participantId,
                submitHidden: document.querySelector("#submit-results").hidden,
                viewResultsText: document.querySelector("#view-results").textContent.trim(),
                viewResultsDisabled: document.querySelector("#view-results").disabled,
                viewResultsHidden: document.querySelector("#view-results").hidden,
                resultsHidden: document.querySelector("#results-screen").hidden,
                requestBody: JSON.stringify(prepareSubmissionPayload())
            })
        `);
        assert.deepEqual(successState, {
            fetchCallCount: 1,
            verificationRequestCount: 4,
            participantId: "PHASE10_TEST_PARTICIPANT",
            submitHidden: true,
            viewResultsText: "View Results",
            viewResultsDisabled: false,
            viewResultsHidden: false,
            resultsHidden: true,
            requestBody: failedState.fetchCalls[0].body,
        });

        const staleAfterSuccess = await client.evaluate(`
            (() => {
                window.__phase10.verificationRequests[0].callback?.({
                    participantId: participantSession.participantId,
                    saved: false
                });
                return {
                    state: submissionState,
                    status: document.querySelector("#submission-status").textContent.trim(),
                    viewResultsHidden: document.querySelector("#view-results").hidden
                };
            })()
        `);
        assert.deepEqual(staleAfterSuccess, {
            state: "success",
            status: "Your responses have been saved successfully.",
            viewResultsHidden: false,
        });

        const delayedVerificationState = await client.evaluate(`
            (() => {
                resetSubmissionState();
                window.__phase10.fetchCalls = [];
                window.__phase10.verificationRequests = [];
                window.__phase10.verificationResults = ["false", "success"];
                document.querySelector("#submit-results").click();
                return true;
            })()
        `);
        assert.equal(delayedVerificationState, true);
        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "Your responses have been saved successfully."`,
            "delayed verification success",
        );
        assert.deepEqual(
            await client.evaluate(`
                ({
                    fetchCallCount: window.__phase10.fetchCalls.length,
                    verificationRequestCount:
                        window.__phase10.verificationRequests.length,
                    participantId: participantSession.participantId,
                    body: window.__phase10.fetchCalls[0]?.body
                })
            `),
            {
                fetchCallCount: 1,
                verificationRequestCount: 2,
                participantId: "PHASE10_TEST_PARTICIPANT",
                body: failedState.fetchCalls[0].body,
            },
            "delayed verification retries only JSONP with the same payload",
        );

        const postTimeoutState = await client.evaluate(`
            (() => {
                resetSubmissionState();
                window.__phase10.fetchCalls = [];
                window.__phase10.verificationRequests = [];
                window.__phase10.verificationResults = ["success"];
                window.fetch = async (url, options) => {
                    window.__phase10.fetchCalls.push({
                        url: String(url),
                        body: options?.body
                    });
                    await new Promise((resolveDelay) =>
                        setTimeout(resolveDelay, 10)
                    );
                    throw new DOMException("Aborted", "AbortError");
                };
                document.querySelector("#submit-results").click();
                return true;
            })()
        `);
        assert.equal(postTimeoutState, true);
        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "Your responses have been saved successfully."`,
            "verification after POST timeout",
        );
        assert.deepEqual(
            await client.evaluate(`
                ({
                    fetchCallCount: window.__phase10.fetchCalls.length,
                    verificationRequestCount:
                        window.__phase10.verificationRequests.length,
                    body: window.__phase10.fetchCalls[0]?.body
                })
            `),
            {
                fetchCallCount: 1,
                verificationRequestCount: 1,
                body: failedState.fetchCalls[0].body,
            },
            "a timed-out POST is confirmed without a second POST",
        );

        const temporaryNetworkFailureState = await client.evaluate(`
            (() => {
                resetSubmissionState();
                window.__phase10.fetchCalls = [];
                window.__phase10.verificationRequests = [];
                window.__phase10.verificationResults = ["error", "error", "error"];
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
        assert.equal(temporaryNetworkFailureState, true);
        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "We couldn't confirm that your responses were saved yet. Check again without resubmitting."`,
            "network error unconfirmed state",
        );
        const networkErrorState = await client.evaluate(`
            ({
                fetchCallCount: window.__phase10.fetchCalls.length,
                verificationRequestCount:
                    window.__phase10.verificationRequests.length,
                participantId: participantSession.participantId,
                assessmentAnswerCount: participantSession.assessmentAnswers.length,
                submitText: document.querySelector("#submit-results").textContent.trim(),
                viewResultsHidden: document.querySelector("#view-results").hidden,
                resultsHidden: document.querySelector("#results-screen").hidden,
                body: window.__phase10.fetchCalls[0]?.body
            })
        `);
        assert.deepEqual(networkErrorState, {
            fetchCallCount: 1,
            verificationRequestCount: 3,
            participantId: "PHASE10_TEST_PARTICIPANT",
            assessmentAnswerCount: 4,
            submitText: "Check Submission Again",
            viewResultsHidden: true,
            resultsHidden: true,
            body: failedState.fetchCalls[0].body,
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

        const staleCallbackState = await client.evaluate(`
            (() => {
                const staleRequest = window.__phase10.verificationRequests[0];
                staleRequest.callback?.({
                    participantId: participantSession.participantId,
                    saved: true
                });
                return {
                    state: submissionState,
                    status: document.querySelector("#submission-status").textContent.trim(),
                    viewResultsHidden: document.querySelector("#view-results").hidden
                };
            })()
        `);
        assert.deepEqual(staleCallbackState, {
            state: "unconfirmed",
            status:
                "We couldn't confirm that your responses were saved yet. Check again without resubmitting.",
            viewResultsHidden: true,
        });

        await client.evaluate(`
            (() => {
                window.__phase10.verificationResults = ["success"];
                document.querySelector("#submit-results").click();
                return true;
            })()
        `);
        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "Your responses have been saved successfully."`,
            "verified recovery",
        );
        assert.equal(
            await client.evaluate("window.__phase10.fetchCalls.length"),
            1,
            "manual recovery uses verification only",
        );

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
                newParticipantInResults:
                    document.querySelector("#results-screen #new-participant") !== null
            })
        `);
        assert.deepEqual(resultsState, {
            heading: "Study complete",
            preAccuracy: "50%",
            postAccuracy: "100%",
            difference: "+50 percentage points",
            resultsHidden: false,
            submissionControlsInResults: false,
            newParticipantInResults: false,
        });
        await captureViewport(client, "/tmp/phase10-results-mobile.png");

        const resetState = await client.evaluate(`
            (() => {
                resetExperimentSession();
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
