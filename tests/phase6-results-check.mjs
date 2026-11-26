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
            const clickNext = () => document.querySelector("#start-experiment").click();
            const require = (condition, message) => { if (!condition) throw new Error(message); };
            const ageConfirmation = document.querySelector("#age-confirmation-checkbox");
            require(ageConfirmation?.checkVisibility(), "18+ confirmation is visible");
            require(!ageConfirmation.checked, "18+ confirmation starts unchecked");
            require(ageConfirmation.required, "18+ confirmation is required");
            require(document.querySelector('label[for="age-confirmation-checkbox"]'),
                "18+ confirmation has an associated label");
            require(document.querySelector("#start-experiment").disabled,
                "Continue starts disabled");
            document.querySelector("#consent-checkbox").click();
            require(document.querySelector("#start-experiment").disabled,
                "Existing consent alone does not enable Continue");
            clickNext();
            require(introStep === 0, "Existing consent alone cannot proceed");
            ageConfirmation.click();
            require(!document.querySelector("#start-experiment").disabled,
                "All consent requirements enable Continue");
            clickNext();
            const genderOptions = [...document.querySelector("#demographic-gender").options]
                .slice(1)
                .map(({ value }) => value);
            const ageQuestion = demographicsConfig.questions.find(({ id }) => id === "age");
            const ageInput = document.querySelector("#demographic-age");
            require(ageInput.min === "18", "Age input starts at 18");
            require(ageInput.max === "100", "Age input preserves its upper limit");
            require(
                JSON.stringify(genderOptions) === JSON.stringify(["Male", "Female"]),
                "Gender renders only Male and Female"
            );
            require(
                document.querySelector("#demographic-nationality")?.type === "text",
                "Nationality uses the existing text-question architecture"
            );
            require(
                getQuestionElement("nationality").querySelector(".question-help").textContent.includes("Prefer not to say"),
                "Nationality provides a Prefer not to say response"
            );
            setValue("#demographic-age", "17");
            setValue("#demographic-gender", "Female", "change");
            setValue("#demographic-nationality", "Swiss and Italian");
            setValue("#demographic-education_level", "University degree", "change");
            const scale = document.querySelector('[data-demographic-id="political_leaning"] input[type="range"]');
            scale.value = "4";
            scale.dispatchEvent(new Event("input", { bubbles: true }));
            require(!validateQuestion(ageQuestion).valid,
                "Programmatically supplied ages below 18 are rejected");
            clickNext();
            require(introStep === 1, "An age below 18 prevents progression");
            require(
                getQuestionElement("age").querySelector(".field-error").textContent.includes("18"),
                "An invalid age displays the minimum age"
            );
            setValue("#demographic-age", "18");
            require(validateQuestion(ageQuestion).valid, "Age 18 is accepted");
            setValue("#demographic-age", "25");
            require(validateQuestion(ageQuestion).valid, "Adult ages above 18 are accepted");
            clickNext();
            document.querySelector('input[name="demographic-ai_sentiment"][value="Unsure"]').click();
            require(introStep === 2, "Continue reaches AI questionnaire");
            const configuredQuestions = demographicsConfig.questions;
            const channelConfig = configuredQuestions.find(q => q.id === "deepfake_exposure_channels");
            require(isConfiguredQuestion(channelConfig, configuredQuestions), "Current conditional config is valid");
            require(!isConfiguredQuestion({ ...channelConfig, exclusiveOption: "Missing option" }, configuredQuestions),
                "Unknown exclusive option is rejected");
            require(!isConfiguredQuestion({ ...channelConfig, type: "radio" }, configuredQuestions),
                "Exclusive option requires checkboxes");
            for (const showIf of [null, {}, { questionId: "missing", values: ["Once"] },
                { questionId: "deepfake_exposure_frequency", values: [] },
                { questionId: "deepfake_exposure_frequency", values: ["Invalid answer"] }]) {
                require(!isConfiguredQuestion({ ...channelConfig, showIf }, configuredQuestions),
                    "Malformed conditional configuration is rejected");
            }

            require(document.querySelectorAll('[data-demographic-id="political_leaning"] .question-help').length === 1,
                "Slider instruction is rendered once");
            const exposure = [...document.querySelectorAll('input[name="demographic-deepfake_exposure_frequency"]')];
            const channels = getQuestionElement("deepfake_exposure_channels");
            const political = getQuestionElement("political_deepfake_exposure");
            require(channels.hidden && political.hidden, "Follow-ups start hidden");
            exposure.find(input => input.value === "Once").click();
            require(!channels.hidden && !political.hidden, "Exposure reveals both follow-ups");
            const options = [...channels.querySelectorAll("input")];
            const instagram = options.find(input => input.value === "Instagram");
            const youtube = options.find(input => input.value === "YouTube");
            const unknown = options.find(input => input.value === "I don’t remember");
            instagram.click(); youtube.click(); unknown.click();
            require(unknown.checked && !instagram.checked && !youtube.checked,
                "Recall alternative clears platform selections");
            instagram.click();
            require(instagram.checked && !unknown.checked, "Platform clears recall alternative");
            unknown.checked = true;
            require(!validateQuestion(demographicsConfig.questions.find(q => q.id === "deepfake_exposure_channels")).valid,
                "Validation rejects contradictory selections");
            unknown.checked = false;
            political.querySelector('input[value="Yes"]').click();
            exposure.find(input => input.value === "Unsure").click();
            require(!channels.hidden && !political.hidden, "Unsure exposure keeps follow-ups visible");
            exposure.find(input => input.value === "Never").click();
            require(channels.hidden && political.hidden, "Never hides follow-ups");
            const responses = validateDemographics().responses;
            require(!("deepfake_exposure_channels" in responses) && !("political_deepfake_exposure" in responses),
                "Hidden follow-up answers are excluded");
            document.querySelector("#intro-back").click();
            require(introStep === 1 && document.querySelector("#demographic-age").value === "25",
                "Back preserves demographic answers");
            clickNext();

            document.querySelector('input[name="demographic-deepfake_exposure_frequency"][value="Never"]').click();
            clickNext();
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
    for (const [index, answer] of ["a", "a", "c"].entries()) {
        await waitFor(
            client,
            `document.querySelector("#learning-question-progress").textContent.includes("Question ${index + 1} of 3")`,
            `learning question ${index + 1}`,
        );
        await client.evaluate(`
            (() => {
                document.querySelector(
                    '#learning-quiz input[name="learning-quiz-answer"][value="${answer}"]'
                ).click();
                document.querySelector("#learning-check-answer").click();
                document.querySelector("#learning-continue").click();
                return true;
            })()
        `);
    }
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

        assert.deepEqual(
            await client.evaluate(`
                (() => ({
                    missingVideo: validateVideoConfig(
                        assessmentVideos.filter(({ id }) => id !== "b-01")
                    ).isValid,
                    unbalancedLabels: validateVideoConfig(
                        assessmentVideos.map((video) =>
                            video.id === "b-02" ? { ...video, label: "fake" } : video
                        )
                    ).isValid
                }))()
            `),
            { missingVideo: false, unbalancedLabels: false },
            "assessment configuration requires four videos and two labels of each kind per set",
        );

        const conditionAssignments = await client.evaluate(`
            (() => {
                const originalRandom = Math.random;
                participantSession.condition = null;
                participantSession.videoSets = { pre: null, post: null };
                Math.random = () => 0.1;
                assignParticipantCondition();
                const conditionOne = {
                    condition: participantSession.condition,
                    videoSets: { ...participantSession.videoSets }
                };
                participantSession.condition = null;
                participantSession.videoSets = { pre: null, post: null };
                Math.random = () => 0.9;
                assignParticipantCondition();
                const conditionTwo = {
                    condition: participantSession.condition,
                    videoSets: { ...participantSession.videoSets }
                };
                Math.random = originalRandom;
                participantSession.condition = null;
                participantSession.videoSets = { pre: null, post: null };
                return { conditionOne, conditionTwo };
            })()
        `);
        assert.deepEqual(conditionAssignments, {
            conditionOne: { condition: 1, videoSets: { pre: "A", post: "B" } },
            conditionTwo: { condition: 2, videoSets: { pre: "B", post: "A" } },
        });

        const selectionBehavior = await client.evaluate(`
            (() => {
                const originalRandom = Math.random;
                const runSelection = (randomValue) => {
                    participantSession.condition = null;
                    participantSession.videoSets = { pre: null, post: null };
                    Math.random = () => randomValue;
                    assignParticipantCondition();
                    const pre = getAssessmentVideos("pre").map(({ id, label }) => ({ id, label }));
                    const post = getAssessmentVideos("post").map(({ id, label }) => ({ id, label }));
                    return {
                        condition: participantSession.condition,
                        videoSets: { ...participantSession.videoSets },
                        pre,
                        post
                    };
                };
                const first = runSelection(0.1);
                const stable = getAssessmentVideos("pre").map(({ id }) => id);
                renderAssessmentStage("pre");
                const stableAfterRender = getAssessmentVideos("pre").map(({ id }) => id);
                const second = runSelection(0.9);
                Math.random = originalRandom;
                participantSession.condition = null;
                participantSession.videoSets = { pre: null, post: null };
                return {
                    first,
                    second,
                    stable,
                    stableAfterRender,
                    allSelectedVideoIds: [...new Set([
                        ...first.pre.map(({ id }) => id),
                        ...first.post.map(({ id }) => id),
                        ...second.pre.map(({ id }) => id),
                        ...second.post.map(({ id }) => id)
                    ])].sort()
                };
            })()
        `);
        for (const selection of [
            selectionBehavior.first,
            selectionBehavior.second,
        ]) {
            assert.equal(selection.pre.length, 4, "Round-1 selects four videos");
            assert.equal(selection.post.length, 4, "Round-2 selects four videos");
            assert.deepEqual(
                selection.pre.map(({ label }) => label).sort(),
                ["fake", "fake", "real", "real"],
                "Round-1 selects two authentic and two deepfake videos",
            );
            assert.deepEqual(
                selection.post.map(({ label }) => label).sort(),
                ["fake", "fake", "real", "real"],
                "Round-2 selects two authentic and two deepfake videos",
            );
            assert.deepEqual(
                selection.pre.map(({ id }) => id.slice(0, 1)).sort(),
                ["b", "b", "t", "t"],
                "Round-1 selects two Biden and two Trump videos",
            );
            assert.deepEqual(
                selection.post.map(({ id }) => id.slice(0, 1)).sort(),
                ["b", "b", "t", "t"],
                "Round-2 selects two Biden and two Trump videos",
            );
        }
        assert.notDeepEqual(
            selectionBehavior.first,
            selectionBehavior.second,
            "different simulated participants can receive different selections",
        );
        assert.deepEqual(
            selectionBehavior.stable,
            selectionBehavior.stableAfterRender,
            "a participant's selection remains stable across renders",
        );
        assert.equal(
            new Set([
                ...selectionBehavior.first.pre.map(({ id }) => id),
                ...selectionBehavior.first.post.map(({ id }) => id),
                ...selectionBehavior.second.pre.map(({ id }) => id),
                ...selectionBehavior.second.post.map(({ id }) => id),
            ]).size,
            8,
            "all eight configured videos are eligible for selection",
        );
        assert.deepEqual(
            selectionBehavior.allSelectedVideoIds,
            ["b-01", "b-02", "b-03", "b-04", "t-01", "t-02", "t-03", "t-04"],
            "selection covers every configured assessment video",
        );

        await completeDemographics(client);
        const assignedVideoCounts = await client.evaluate(`
            ({
                pre: getAssessmentVideos("pre").length,
                post: getAssessmentVideos("post").length
            })
        `);
        assert.deepEqual(
            assignedVideoCounts,
            { pre: 4, post: 4 },
            "each assigned assessment round has four selected videos",
        );

        const submitDisabledBeforeMetadata = await client.evaluate(`
            (() => {
                renderAssessmentStage("pre");
                return document.querySelector("#assessment-submit").disabled;
            })()
        `);
        assert.equal(
            submitDisabledBeforeMetadata,
            true,
            "submission remains disabled until video metadata loads",
        );

        const selectedAssessmentVideos = await client.evaluate(`
            ({
                pre: getAssessmentVideos("pre").map(({ id, label }) => ({ id, label })),
                post: getAssessmentVideos("post").map(({ id, label }) => ({ id, label }))
            })
        `);
        const oppositeLabel = (label) => (label === "real" ? "fake" : "real");
        const preAnswers = [
            [oppositeLabel(selectedAssessmentVideos.pre[0].label), 40],
            [selectedAssessmentVideos.pre[1].label, 50],
            [oppositeLabel(selectedAssessmentVideos.pre[2].label), 60],
            [selectedAssessmentVideos.pre[3].label, 70],
        ];
        const postAnswers = [
            [selectedAssessmentVideos.post[0].label, 70],
            [selectedAssessmentVideos.post[1].label, 80],
            [selectedAssessmentVideos.post[2].label, 90],
            [selectedAssessmentVideos.post[3].label, 100],
        ];

        for (const [classification, confidence] of preAnswers) {
            await submitAssessmentAnswer(client, classification, confidence);
        }
        await completeLearning(client);
        for (const [index, [classification, confidence]] of postAnswers.entries()) {
            if (index === postAnswers.length - 1) {
                await client.evaluate("document.querySelector('#assessment-video').play()");
            }
            await submitAssessmentAnswer(client, classification, confidence);
        }
        await waitFor(
            client,
            "document.body.dataset.activeStage === 'submission'",
            "submission stage",
        );
        assert.deepEqual(
            await client.evaluate(`
                (() => {
                    const video = document.querySelector("#assessment-video");
                    return {
                        paused: video.paused,
                        source: video.getAttribute("src"),
                        networkEmpty: video.networkState === HTMLMediaElement.NETWORK_EMPTY
                    };
                })()
            `),
            { paused: true, source: null, networkEmpty: true },
            "entering Submission stops playback and releases the assessment resource",
        );

        const submittingState = await client.evaluate(`
            (() => {
                window.__phase6Submission = {
                    fetchCalls: [],
                    verificationRequests: []
                };
                window.fetch = async (url, options) => {
                    window.__phase6Submission.fetchCalls.push({
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
                    window.__phase6Submission.verificationRequests.push({
                        participantId: requestUrl.searchParams.get("participantId"),
                        callbackName
                    });
                    setTimeout(
                        () => window[callbackName]?.({
                            participantId: participantSession.participantId,
                            saved: true
                        }),
                        0
                    );
                    return element;
                };
                document.querySelector("#submit-results").click();
                document.querySelector("#submit-results").click();
                return {
                    buttonText: document.querySelector("#submit-results").textContent.trim(),
                    buttonDisabled: document.querySelector("#submit-results").disabled,
                    status: document.querySelector("#submission-status").textContent.trim()
                };
            })()
        `);
        assert.deepEqual(submittingState, {
            buttonText: "Submitting...",
            buttonDisabled: true,
            status: "Submitting your responses...",
        });
        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "Your responses have been saved successfully."`,
            "verified submission before results",
        );
        await client.evaluate(
            'document.querySelector("#view-results").click(); true',
        );
        await waitFor(
            client,
            "document.body.dataset.activeStage === 'results'",
            "results stage after verification",
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
                newParticipantDisabled: document.querySelector("#new-participant")?.disabled ?? null,
                newParticipantInResults: document.querySelector("#results-screen #new-participant") !== null,
                thankYou: document.querySelector("#results-screen .results-intro p").textContent.trim().replace(/\\s+/g, " "),
                submissionStatusAriaLive: document.querySelector("#submission-status").getAttribute("aria-live"),
                submissionControlsInResults: document.querySelector("#results-screen #submit-results") !== null,
                backExposed: document.querySelector("#results-screen [data-previous-stage]") !== null
            })
        `);
        assert.deepEqual(results, {
            heading: "Study complete",
            preCorrect: "2/4",
            preAccuracy: "50%",
            preConfidence: "55%",
            postCorrect: "4/4",
            postAccuracy: "100%",
            postConfidence: "85%",
            difference: "+50 percentage points",
            confidenceComparison: "55% → 85%",
            newParticipantDisabled: null,
            newParticipantInResults: false,
            thankYou: "Thank you for participating. Your Round-1 and Round-2 performance are compared below.",
            submissionStatusAriaLive: "polite",
            submissionControlsInResults: false,
            backExposed: false,
        });

        const payload = await client.evaluate("prepareSubmissionPayload()");
        assert.equal(payload.participantId.length > 0, true);
        assert.equal(payload.demographics.age, 25);
        assert.equal(payload.demographics.gender, "Female");
        assert.equal(payload.demographics.nationality, "Swiss and Italian");
        assert.equal(payload.demographics.education_level, "University degree");
        assert.equal(payload.demographics.political_leaning, 4);
        assert.equal(payload.demographics.ai_sentiment, "Unsure");
        assert.equal(payload.demographics.deepfake_exposure_frequency, "Never");
        assert.equal(payload.condition, 1);
        assert.deepEqual(payload.videoSets, { pre: "A", post: "B" });
        assert.deepEqual(payload.assessments.pre.responses[0], {
            videoId: selectedAssessmentVideos.pre[0].id,
            correctLabel: selectedAssessmentVideos.pre[0].label,
            classification: oppositeLabel(selectedAssessmentVideos.pre[0].label),
            confidence: 40,
            selectedClues: ["facial_movements"],
        });
        assert.deepEqual(payload.assessments.post.responses[0], {
            videoId: selectedAssessmentVideos.post[0].id,
            correctLabel: selectedAssessmentVideos.post[0].label,
            classification: selectedAssessmentVideos.post[0].label,
            confidence: 70,
            selectedClues: ["facial_movements"],
        });
        assert.deepEqual(
            payload.assessments.pre.responses.map(({ videoId }) => videoId),
            selectedAssessmentVideos.pre.map(({ id }) => id),
        );
        assert.deepEqual(
            payload.assessments.post.responses.map(({ videoId }) => videoId),
            selectedAssessmentVideos.post.map(({ id }) => id),
        );
        assert.equal(
            payload.assessments.pre.responses.length,
            4,
            "the pre-assessment payload contains four responses",
        );
        assert.equal(
            payload.assessments.post.responses.length,
            4,
            "the post-assessment payload contains four responses",
        );
        assert.equal(
            payload.assessments.pre.responses.length +
                payload.assessments.post.responses.length,
            8,
            "the participant payload contains eight video responses",
        );
        assert.equal(
            new Set([
                ...payload.assessments.pre.responses.map(({ videoId }) => videoId),
                ...payload.assessments.post.responses.map(({ videoId }) => videoId),
            ]).size,
            8,
            "no assessment video repeats within a participant session",
        );
        assert.deepEqual(payload.learning, {
            completedModuleIds: ["deepfake-clues", "check-understanding"],
            quizAnswers: { q1: "a", q3: "a", q4: "c" },
            isComplete: true,
        });
        assert.deepEqual(payload.performance, {
            pre: {
                correctClassifications: 2,
                totalClassifications: 4,
                accuracyPercent: 50,
                averageConfidencePercent: 55,
            },
            post: {
                correctClassifications: 4,
                totalClassifications: 4,
                accuracyPercent: 100,
                averageConfidencePercent: 85,
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
                    videoId: "t-02",
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
            videoId: "t-02",
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
        const successfulSubmission = await client.evaluate(`
            ({
                fetchCallCount: window.__phase6Submission.fetchCalls.length,
                requestBody: window.__phase6Submission.fetchCalls[0]?.body,
                verificationRequestCount:
                    window.__phase6Submission.verificationRequests.length,
                verificationParticipantId:
                    window.__phase6Submission.verificationRequests[0]?.participantId,
                submitHidden: document.querySelector("#submit-results").hidden,
                viewResultsHidden: document.querySelector("#view-results").hidden
            })
        `);
        assert.deepEqual(successfulSubmission, {
            fetchCallCount: 1,
            requestBody: JSON.stringify(payload),
            verificationRequestCount: 1,
            verificationParticipantId: oldParticipantId,
            submitHidden: true,
            viewResultsHidden: false,
        });

        const boundedPost = await client.evaluate(`
            (async () => {
                let signalPresent = false;
                let aborted = false;
                window.fetch = (url, options) =>
                    new Promise((resolve, reject) => {
                        signalPresent = options?.signal instanceof AbortSignal;
                        options?.signal?.addEventListener("abort", () => {
                            aborted = true;
                            reject(new DOMException("Aborted", "AbortError"));
                        });
                        setTimeout(
                            () => reject(new TypeError("Synthetic fallback timeout")),
                            100,
                        );
                    });
                try {
                    await postSubmission("{}", 20);
                } catch {
                    // The bounded request must reject after it is aborted.
                }
                return { signalPresent, aborted };
            })()
        `);
        assert.deepEqual(boundedPost, {
            signalPresent: true,
            aborted: true,
        });

        const resetState = await client.evaluate(`
            (() => {
                resetExperimentSession();
                return {
                    stage: document.body.dataset.activeStage,
                    session: participantSession,
                    consentChecked: document.querySelector("#consent-checkbox").checked,
                    ageConfirmationChecked: document.querySelector("#age-confirmation-checkbox").checked,
                    ageValue: document.querySelector("#demographic-age").value,
                    submissionStatus: document.querySelector("#submission-status").textContent.trim(),
                    submitText: document.querySelector("#submit-results").textContent.trim(),
                    submitHidden: document.querySelector("#submit-results").hidden,
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
        assert.deepEqual(resetState.session.selectedVideoIds, {
            pre: [],
            post: [],
        });
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
        assert.equal(resetState.ageConfirmationChecked, false);
        assert.equal(resetState.ageValue, "");
        assert.equal(resetState.submissionStatus, "Your results have not been submitted.");
        assert.equal(resetState.submitText, "Submit Results");
        assert.equal(resetState.submitHidden, false);
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
