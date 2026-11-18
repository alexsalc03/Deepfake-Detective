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

async function waitFor(client, expression, label, timeout = 8000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
        if (await client.evaluate(`Boolean(${expression})`)) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`Timed out waiting for ${label}`);
}

async function completeDemographics(client) {
    await waitFor(client, "formReady", "demographics configuration");
    await client.evaluate(`
        (() => {
            const setValue = (selector, value, eventName = "input") => {
                const control = document.querySelector(selector);
                control.value = value;
                control.dispatchEvent(new Event(eventName, { bubbles: true }));
            };
            setValue("#demographic-age", "25");
            document.querySelector('input[name="demographic-gender"][value="Woman"]').click();
            setValue("#demographic-education_level", "Bachelor's degree", "change");
            document.querySelector('input[name="demographic-ai_content_familiarity"][value="Moderately familiar"]').click();
            document.querySelector('input[name="demographic-deepfake_experience"][value="Limited experience"]').click();
            document.querySelector("#consent-checkbox").click();
            document.querySelector("#start-experiment").click();
            participantSession.condition = 1;
            participantSession.videoSets = { pre: "A", post: "B" };
            renderAssessmentStage("pre");
            return true;
        })()
    `);
    await waitFor(
        client,
        "document.body.dataset.activeStage === 'pre-assessment'",
        "pre-assessment stage",
    );
}

async function submitAssessmentAnswer(client, classification, confidence) {
    await waitFor(
        client,
        "assessmentContentReady && !document.querySelector('#assessment-submit').disabled",
        "assessment answer controls",
    );
    await waitFor(
        client,
        "performance.now() - lastAssessmentSubmissionAt > 500",
        "assessment submission cooldown",
    );
    await client.evaluate(`
        (() => {
            document.querySelector(
                '#assessment-questions input[name="assessment-classification"][value="${classification}"]'
            ).click();
            const confidence = document.querySelector("#assessment-confidence");
            confidence.value = "${confidence}";
            confidence.dispatchEvent(new Event("input", { bubbles: true }));
            document.querySelector(
                '#assessment-questions input[name="assessment-clues"][value="facial_movements"]'
            ).click();
            document.querySelector("#assessment-submit").click();
            return true;
        })()
    `);
}

async function completeLearning(client) {
    await waitFor(
        client,
        "document.body.dataset.activeStage === 'learning'",
        "learning stage",
    );
    await client.evaluate(
        "document.querySelector('#learning-continue').click(); true",
    );
    await waitFor(
        client,
        "document.querySelector('#learning-module-progress').textContent.includes('Module 2 of 2')",
        "second learning module",
    );
    await client.evaluate(`
        (() => {
            document.querySelector(
                '#learning-quiz input[name="learning-quiz-answer"][value="a"]'
            ).click();
            document.querySelector("#learning-check-answer").click();
            document.querySelector("#learning-continue").click();
            return true;
        })()
    `);
    await waitFor(
        client,
        "document.body.dataset.activeStage === 'post-assessment'",
        "post-assessment stage",
    );
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
    const chromeProfile = await mkdtemp(join(tmpdir(), "phase6-chrome-"));
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
            "google-chrome",
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

        await completeDemographics(client);
        await submitAssessmentAnswer(client, "real", 40);
        await waitFor(
            client,
            "participantSession.assessmentProgress.pre.videoIndex === 1",
            "second pre-assessment video",
        );
        await submitAssessmentAnswer(client, "real", 60);
        await completeLearning(client);
        await submitAssessmentAnswer(client, "fake", 80);
        await waitFor(
            client,
            "participantSession.assessmentProgress.post.videoIndex === 1",
            "second post-assessment video",
        );
        await submitAssessmentAnswer(client, "real", 100);
        await waitFor(
            client,
            "document.body.dataset.activeStage === 'results'",
            "results stage",
        );

        const results = await client.evaluate(`
            ({
                heading: document.querySelector("#results-title").textContent.trim(),
                preCorrect: document.querySelector("#pre-correct").textContent.trim(),
                preAccuracy: document.querySelector("#pre-accuracy").textContent.trim(),
                preConfidence: document.querySelector("#pre-confidence").textContent.trim(),
                postCorrect: document.querySelector("#post-correct").textContent.trim(),
                postAccuracy: document.querySelector("#post-accuracy").textContent.trim(),
                postConfidence: document.querySelector("#post-confidence").textContent.trim(),
                difference: document.querySelector("#accuracy-difference").textContent.trim(),
                confidenceComparison: document.querySelector("#confidence-comparison").textContent.trim(),
                submitDisabled: document.querySelector("#submit-results").disabled,
                resetExposed: document.querySelector("[data-reset-experiment]") !== null,
                backExposed: document.querySelector("#results-screen [data-previous-stage]") !== null
            })
        `);
        assert.deepEqual(results, {
            heading: "Study complete",
            preCorrect: "1/2",
            preAccuracy: "50%",
            preConfidence: "50%",
            postCorrect: "2/2",
            postAccuracy: "100%",
            postConfidence: "90%",
            difference: "+50 percentage points",
            confidenceComparison: "50% → 90%",
            submitDisabled: true,
            resetExposed: false,
            backExposed: false,
        });

        const payload = await client.evaluate("prepareSubmissionPayload()");
        assert.equal(payload.participantId.length > 0, true);
        assert.equal(payload.demographics.age, 25);
        assert.equal(payload.condition, 1);
        assert.deepEqual(payload.videoSets, { pre: "A", post: "B" });
        assert.deepEqual(payload.assessments.pre.responses[0], {
            videoId: "ex1",
            correctLabel: "real",
            classification: "real",
            confidence: 40,
            selectedClues: ["facial_movements"],
        });
        assert.deepEqual(payload.assessments.post.responses[0], {
            videoId: "ex3",
            correctLabel: "fake",
            classification: "fake",
            confidence: 80,
            selectedClues: ["facial_movements"],
        });
        assert.deepEqual(payload.learning, {
            completedModuleIds: ["placeholder-module-1", "placeholder-module-2"],
            quizAnswers: { "placeholder-module-2": "a" },
            isComplete: true,
        });
        assert.deepEqual(payload.performance, {
            pre: {
                correctClassifications: 1,
                totalClassifications: 2,
                accuracyPercent: 50,
                averageConfidencePercent: 50,
            },
            post: {
                correctClassifications: 2,
                totalClassifications: 2,
                accuracyPercent: 100,
                averageConfidencePercent: 90,
            },
            accuracyDifferencePercentagePoints: 50,
        });
        assert.doesNotThrow(() => JSON.parse(JSON.stringify(payload)));

        const missingMetrics = await client.evaluate(
            "calculatePerformanceMetrics('missing-stage')",
        );
        assert.deepEqual(missingMetrics, {
            correctClassifications: 0,
            totalClassifications: 0,
            accuracyPercent: null,
            averageConfidencePercent: null,
        });

        const fractionalMetrics = await client.evaluate(`
            (() => {
                const existingVideos = assessmentVideos;
                const existingAnswers = participantSession.assessmentAnswers;
                assessmentVideos = [
                    { id: "fraction-1", label: "real" },
                    { id: "fraction-2", label: "fake" },
                    { id: "fraction-3", label: "fake" }
                ];
                participantSession.assessmentAnswers = [
                    { stage: "pre", videoId: "fraction-1", answer: "real", confidence: 40 },
                    { stage: "pre", videoId: "fraction-2", answer: "real", confidence: 41 },
                    { stage: "pre", videoId: "fraction-3", answer: "real", confidence: 41 }
                ];
                try {
                    return calculatePerformanceMetrics("pre");
                } finally {
                    assessmentVideos = existingVideos;
                    participantSession.assessmentAnswers = existingAnswers;
                }
            })()
        `);
        assert.deepEqual(fractionalMetrics, {
            correctClassifications: 1,
            totalClassifications: 3,
            accuracyPercent: 33.3,
            averageConfidencePercent: 40.7,
        });

        const incompleteResponse = await client.evaluate(`
            (() => {
                const existingAnswers = participantSession.assessmentAnswers;
                participantSession.assessmentAnswers = [{
                    stage: "pre",
                    videoId: "ex1",
                    answer: "real"
                }];
                try {
                    return prepareSubmissionPayload().assessments.pre.responses[0];
                } finally {
                    participantSession.assessmentAnswers = existingAnswers;
                }
            })()
        `);
        assert.deepEqual(incompleteResponse, {
            videoId: "ex1",
            correctLabel: "real",
            classification: "real",
            confidence: null,
            selectedClues: [],
        });

        await setViewport(client, 1440, 1000);
        assert.equal(
            await client.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth",
            ),
            true,
            "desktop results do not overflow horizontally",
        );
        await captureViewport(client, "/tmp/phase6-results-desktop.png");
        await setViewport(client, 390, 844, true);
        assert.equal(
            await client.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth",
            ),
            true,
            "mobile results do not overflow horizontally",
        );
        await captureViewport(client, "/tmp/phase6-results-mobile.png");

        const oldParticipantId = payload.participantId;
        const resetState = await client.evaluate(`
            (() => {
                resetExperimentSession();
                return {
                    stage: document.body.dataset.activeStage,
                    session: participantSession,
                    consentChecked: document.querySelector("#consent-checkbox").checked,
                    ageValue: document.querySelector("#demographic-age").value,
                    oldParticipantId: ${JSON.stringify(oldParticipantId)}
                };
            })()
        `);
        assert.equal(resetState.stage, "welcome");
        assert.equal(resetState.session.participantId, null);
        assert.equal(resetState.session.consentProvided, false);
        assert.deepEqual(resetState.session.demographics, {});
        assert.equal(resetState.session.condition, null);
        assert.deepEqual(resetState.session.videoSets, { pre: null, post: null });
        assert.deepEqual(resetState.session.assessmentAnswers, []);
        assert.deepEqual(resetState.session.assessmentProgress, {
            pre: { videoIndex: 0 },
            post: { videoIndex: 0 },
        });
        assert.deepEqual(resetState.session.learning, {
            completedModuleIds: [],
            selectedQuizAnswers: {},
            isComplete: false,
        });
        assert.equal(resetState.consentChecked, false);
        assert.equal(resetState.ageValue, "");
        assert.equal(resetState.session.participantId === oldParticipantId, false);

        await completeDemographics(client);
        assert.notEqual(
            await client.evaluate("participantSession.participantId"),
            oldParticipantId,
            "a new session receives a new participant ID",
        );

        assert.deepEqual(consoleErrors, [], "no browser console errors");
        console.log("Phase 6 browser checks passed.");
        console.log("Screenshots: /tmp/phase6-results-desktop.png");
        console.log("Screenshots: /tmp/phase6-results-mobile.png");
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
