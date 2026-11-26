import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const participantId = "JSONP_TEST_PARTICIPANT";

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
            if ((await fetch(url)).ok) return;
        } catch {
            // The local process may still be starting.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }

    throw new Error(`Timed out waiting for ${url}`);
}

async function waitFor(client, expression, label, timeout = 10000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
        if (await client.evaluate(`Boolean(${expression})`)) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }

    throw new Error(`Timed out waiting for ${label}`);
}

function delay(milliseconds) {
    return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
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
        this.socket.addEventListener("message", ({ data }) => {
            const message = JSON.parse(data);

            if (message.id) {
                const request = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (message.error) {
                    request.reject(new Error(message.error.message));
                } else {
                    request.resolve(message.result);
                }
                return;
            }

            for (const handler of this.listeners.get(message.method) ?? []) {
                handler(message.params);
            }
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        this.socket.send(JSON.stringify({ id, method, params }));
        return new Promise((resolveRequest, rejectRequest) => {
            this.pending.set(id, {
                resolve: resolveRequest,
                reject: rejectRequest,
            });
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

async function run() {
    const serverPort = await getAvailablePort();
    const chromePort = await getAvailablePort();
    const chromeProfile = await mkdtemp(join(tmpdir(), "submission-jsonp-"));
    let server;
    let chrome;
    let client;
    const jsonpResponses = [];
    const interceptedRequests = [];

    const enqueueJsonp = (response) => {
        jsonpResponses.push(response);
    };

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
            client.send("Fetch.enable", {
                patterns: [
                    {
                        urlPattern: "*script.google.com/macros/s/*",
                        requestStage: "Request",
                    },
                ],
            }),
        ]);

        client.on("Fetch.requestPaused", async ({ requestId, request }) => {
            const url = new URL(request.url);
            const callback = url.searchParams.get("callback");
            interceptedRequests.push({
                method: request.method,
                participantId: url.searchParams.get("participantId"),
                callback,
            });

            const response = jsonpResponses.shift();
            if (!response) {
                throw new Error(`No JSONP response queued for ${request.url}`);
            }

            await delay(response.delayMilliseconds ?? 0);

            if (response.loadError) {
                await client.send("Fetch.failRequest", {
                    requestId,
                    errorReason: "Failed",
                });
                return;
            }

            const result = JSON.stringify(
                response.result ?? {
                    participantId,
                    saved: true,
                },
            );
            const source = response.lateCallback
                ? `
                    setTimeout(() => {
                        if (typeof ${callback} === "function") {
                            ${callback}(${result});
                        }
                    }, 250);
                `
                : response.captureCallback
                  ? `
                    window.__jsonpStaleCallback = ${callback};
                    ${callback}(${result});
                `
                : response.source ?? `${callback}(${result});`;
            const body = Buffer.from(source).toString("base64");
            try {
                await client.send("Fetch.fulfillRequest", {
                    requestId,
                    responseCode: 200,
                    responseHeaders: [
                        {
                            name: "Content-Type",
                            value: "text/javascript; charset=utf-8",
                        },
                    ],
                    body,
                });
            } catch {
                // A timed-out script can be removed before its response arrives.
            }
        });

        await client.send("Page.navigate", {
            url: `http://127.0.0.1:${serverPort}/`,
        });
        await waitFor(
            client,
            "document.readyState === 'complete' && typeof verifyParticipantSaved === 'function'",
            "application",
        );

        const verify = (timeoutMilliseconds = 12000) =>
            client.evaluate(`
                verifyParticipantSaved(
                    ${JSON.stringify(participantId)},
                    ${timeoutMilliseconds}
                )
                    .then(() => true)
                    .catch(() => false)
            `);

        enqueueJsonp({});
        assert.equal(
            await verify(),
            true,
            "a matching saved JSONP result is accepted",
        );

        enqueueJsonp({
            result: {
                participantId,
                saved: false,
            },
        });
        assert.equal(
            await verify(),
            false,
            "a saved false JSONP result remains unconfirmed",
        );

        enqueueJsonp({
            result: {
                participantId: "DIFFERENT_PARTICIPANT",
                saved: true,
            },
        });
        assert.equal(
            await verify(),
            false,
            "a saved result for a different participant is rejected",
        );

        enqueueJsonp({ loadError: true });
        assert.equal(
            await verify(),
            false,
            "a script loading error remains unconfirmed",
        );

        enqueueJsonp({ source: "void 0;" });
        assert.equal(
            await verify(50),
            false,
            "a script without a callback invocation times out",
        );

        const delayedStartedAt = Date.now();
        enqueueJsonp({ delayMilliseconds: 4250 });
        const delayedResult = await verify();
        const delayedElapsed = Date.now() - delayedStartedAt;
        assert.equal(
            delayedResult,
            true,
            "a saved JSONP response arriving after four seconds is accepted",
        );
        assert.equal(
            delayedElapsed >= 4250,
            true,
            "the delayed response test reaches the late response",
        );

        const lateCallbackRequestIndex = interceptedRequests.length;
        enqueueJsonp({ lateCallback: true });
        assert.equal(
            await verify(50),
            false,
            "a callback arriving after timeout does not confirm the old attempt",
        );
        enqueueJsonp({});
        assert.equal(
            await verify(),
            true,
            "a later successful JSONP request confirms after an earlier failure",
        );
        await delay(300);

        assert.equal(
            await client.evaluate(`
                document.querySelectorAll('script[src*="script.google.com"]').length
            `),
            0,
            "verification scripts are removed after settlement",
        );

        const callbacks = interceptedRequests.map(
            (request) => request.callback,
        );
        assert.equal(
            interceptedRequests.every(
                (request) =>
                    request.method === "GET" &&
                    request.participantId === participantId,
            ),
            true,
            "verification uses GET with the preserved participant ID",
        );
        assert.equal(
            callbacks.every((callback) =>
                /^[a-zA-Z_$][a-zA-Z0-9_$]{0,79}$/.test(callback),
            ),
            true,
            "every verification callback satisfies the backend contract",
        );
        assert.equal(
            new Set(callbacks).size,
            callbacks.length,
            "each verification attempt uses a unique callback",
        );
        assert.ok(
            lateCallbackRequestIndex > 0,
            "the late callback scenario followed earlier verification requests",
        );

        const uiRequestStart = interceptedRequests.length;
        enqueueJsonp({
            captureCallback: true,
            result: {
                participantId,
                saved: false,
            },
        });
        enqueueJsonp({ loadError: true });
        enqueueJsonp({
            result: {
                participantId,
                saved: false,
            },
        });

        await client.evaluate(`
            (() => {
                participantSession.participantId = ${JSON.stringify(participantId)};
                participantSession.consentProvided = true;
                participantSession.demographics = {
                    age: 30,
                    gender: "Female",
                    nationality: "Swiss",
                    education_level: "University degree",
                    political_leaning: 4,
                    ai_sentiment: "Unsure",
                    deepfake_exposure_frequency: "Never"
                };
                participantSession.condition = 1;
                participantSession.videoSets = { pre: "A", post: "B" };
                participantSession.selectedVideoIds = {
                    pre: ["t-01", "t-02", "b-01", "b-02"],
                    post: ["t-03", "t-04", "b-03", "b-04"]
                };
                participantSession.assessmentAnswers = [
                    { stage: "pre", videoId: "t-01", videoPosition: 1, answer: "fake", confidence: 40, clues: ["facial_movements"] },
                    { stage: "pre", videoId: "t-02", videoPosition: 2, answer: "real", confidence: 50, clues: ["facial_movements"] },
                    { stage: "pre", videoId: "b-01", videoPosition: 3, answer: "fake", confidence: 60, clues: ["facial_movements"] },
                    { stage: "pre", videoId: "b-02", videoPosition: 4, answer: "real", confidence: 70, clues: ["facial_movements"] },
                    { stage: "post", videoId: "t-03", videoPosition: 1, answer: "fake", confidence: 70, clues: ["facial_movements"] },
                    { stage: "post", videoId: "t-04", videoPosition: 2, answer: "real", confidence: 80, clues: ["facial_movements"] },
                    { stage: "post", videoId: "b-03", videoPosition: 3, answer: "fake", confidence: 90, clues: ["facial_movements"] },
                    { stage: "post", videoId: "b-04", videoPosition: 4, answer: "real", confidence: 100, clues: ["facial_movements"] }
                ];
                participantSession.assessmentProgress = {
                    pre: { videoIndex: 4 },
                    post: { videoIndex: 4 }
                };
                participantSession.learning = {
                    completedModuleIds: ["deepfake-clues", "check-understanding"],
                    selectedQuizAnswers: { q1: "a", q3: "a", q4: "c" },
                    isComplete: true
                };
                window.__jsonpSubmission = {
                    fetchCalls: [],
                    originalBody: null
                };
                window.fetch = async (url, options) => {
                    window.__jsonpSubmission.fetchCalls.push({
                        url: String(url),
                        method: options?.method,
                        body: options?.body
                    });
                    window.__jsonpSubmission.originalBody = options?.body;
                    return { type: "opaque" };
                };
                showStage(
                    stages.findIndex((stage) => stage.id === "submission"),
                    false
                );
                document.querySelector("#submit-results").click();
                document.querySelector("#submit-results").click();
                return true;
            })()
        `);

        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "We couldn't confirm that your responses were saved yet. Check again without resubmitting."`,
            "unconfirmed submission after JSONP failures",
        );
        const unconfirmedState = await client.evaluate(`
            ({
                fetchCallCount: window.__jsonpSubmission.fetchCalls.length,
                submitText: document.querySelector("#submit-results").textContent.trim(),
                viewResultsHidden: document.querySelector("#view-results").hidden,
                resultsHidden: document.querySelector("#results-screen").hidden,
                participantId: participantSession.participantId,
                answerCount: participantSession.assessmentAnswers.length,
                body: prepareSubmissionPayload()
            })
        `);
        assert.deepEqual(
            {
                fetchCallCount: unconfirmedState.fetchCallCount,
                submitText: unconfirmedState.submitText,
                viewResultsHidden: unconfirmedState.viewResultsHidden,
                resultsHidden: unconfirmedState.resultsHidden,
                participantId: unconfirmedState.participantId,
                answerCount: unconfirmedState.answerCount,
            },
            {
                fetchCallCount: 1,
                submitText: "Check Submission Again",
                viewResultsHidden: true,
                resultsHidden: true,
                participantId,
                answerCount: 8,
            },
            "unconfirmed verification keeps results locked after one POST",
        );
        assert.equal(
            JSON.stringify(unconfirmedState.body),
            await client.evaluate("window.__jsonpSubmission.originalBody"),
            "failed verification leaves the original participant payload unchanged",
        );

        const staleAfterFailure = await client.evaluate(`
            (() => {
                window.__jsonpStaleCallback?.({
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
        assert.deepEqual(
            staleAfterFailure,
            {
                state: "unconfirmed",
                status:
                    "We couldn't confirm that your responses were saved yet. Check again without resubmitting.",
                viewResultsHidden: true,
            },
            "a callback from an earlier verification attempt cannot alter state",
        );

        enqueueJsonp({});
        await client.evaluate(`
            (() => {
                document.querySelector("#submit-results").click();
                document.querySelector("#submit-results").click();
                return true;
            })()
        `);
        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "Your responses have been saved successfully."`,
            "confirmed submission after manual verification retry",
        );
        const confirmedState = await client.evaluate(`
            ({
                fetchCallCount: window.__jsonpSubmission.fetchCalls.length,
                submitHidden: document.querySelector("#submit-results").hidden,
                viewResultsDisabled: document.querySelector("#view-results").disabled,
                viewResultsHidden: document.querySelector("#view-results").hidden,
                state: submissionState,
                body: prepareSubmissionPayload()
            })
        `);
        assert.deepEqual(
            {
                fetchCallCount: confirmedState.fetchCallCount,
                submitHidden: confirmedState.submitHidden,
                viewResultsDisabled: confirmedState.viewResultsDisabled,
                viewResultsHidden: confirmedState.viewResultsHidden,
                state: confirmedState.state,
            },
            {
                fetchCallCount: 1,
                submitHidden: true,
                viewResultsDisabled: false,
                viewResultsHidden: false,
                state: "success",
            },
            "a later saved result unlocks View Results without another POST",
        );
        assert.equal(
            JSON.stringify(confirmedState.body),
            await client.evaluate("window.__jsonpSubmission.originalBody"),
            "manual verification retry preserves the participant payload",
        );

        const uiRequests = interceptedRequests.slice(uiRequestStart);
        assert.equal(
            uiRequests.every((request) => request.method === "GET"),
            true,
            "verification retries send GET requests only",
        );
        assert.equal(
            new Set(uiRequests.map((request) => request.callback)).size,
            uiRequests.length,
            "retried verification requests use fresh callbacks",
        );

        await client.evaluate(`
            (() => {
                document.querySelector("#view-results").click();
                return true;
            })()
        `);
        await waitFor(
            client,
            "document.body.dataset.activeStage === 'results'",
            "verified results stage",
        );
        assert.equal(
            await client.evaluate(
                "document.querySelector('#results-screen').hidden",
            ),
            false,
            "confirmed participants can view results",
        );

        console.log("Submission JSONP browser check passed.");
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
