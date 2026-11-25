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
            if (response.ok) {
                return response;
            }
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

                if (message.error) {
                    request.reject(new Error(message.error.message));
                } else {
                    request.resolve(message.result);
                }
                return;
            }

            const handlers = this.listeners.get(message.method) ?? [];
            handlers.forEach((handler) => handler(message.params));
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

async function waitFor(client, expression, label, timeout = 8000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
        if (await client.evaluate(`Boolean(${expression})`)) {
            return;
        }
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
            document.querySelector("#consent-checkbox").click();
            clickNext();
            setValue("#demographic-age", "25");
            setValue("#demographic-gender", "Woman", "change");
            setValue("#demographic-education_level", "University degree", "change");
            const scale = document.querySelector('[data-demographic-id="political_leaning"] input[type="range"]');
            scale.value = "4";
            scale.dispatchEvent(new Event("input", { bubbles: true }));
            clickNext();
            document.querySelector('input[name="demographic-ai_sentiment"][value="Unsure"]').click();
            document.querySelector('input[name="demographic-deepfake_exposure_frequency"][value="Never"]').click();
            clickNext();
            return true;
        })()
    `);

    await waitFor(
        client,
        "document.body.dataset.activeStage === 'pre-assessment'",
        "pre-assessment stage",
    );
}

async function completePreAssessment(client) {
    await waitFor(
        client,
        "assessmentContentReady && participantSession.condition !== null",
        "assessment content",
    );

    const videoCount = await client.evaluate(
        'getAssessmentVideos("pre").length',
    );
    assert.equal(videoCount, 4, "the assigned pre-assessment set has four videos");

    for (let index = 0; index < videoCount; index += 1) {
        await waitFor(
            client,
            "!document.querySelector('#assessment-submit').disabled",
            `assessment video ${index + 1}`,
        );
        await waitFor(
            client,
            "performance.now() - lastAssessmentSubmissionAt > 500",
            `assessment submission cooldown ${index + 1}`,
        );

        await client.evaluate(`
            (() => {
                document.querySelector(
                    '#assessment-questions input[name="assessment-classification"]'
                ).click();
                const confidence = document.querySelector("#assessment-confidence");
                confidence.value = "50";
                confidence.dataset.touched = "true";
                confidence.dispatchEvent(new Event("input", { bubbles: true }));
                document.querySelector(
                    '#assessment-questions input[name="assessment-clues"]'
                ).click();
                document.querySelector("#assessment-submit").click();
                return true;
            })()
        `);

        if (index < videoCount - 1) {
            await waitFor(
                client,
                `participantSession.assessmentProgress.pre.videoIndex === ${index + 1}`,
                `pre-assessment video ${index + 2}`,
            );
        }
    }

    await waitFor(
        client,
        "document.body.dataset.activeStage === 'learning'",
        "Learning stage after the pre-assessment",
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
    const chromeProfile = await mkdtemp(join(tmpdir(), "phase5-chrome-"));
    const consoleErrors = [];
    let server;
    let chrome;
    let client;

    try {
        server = spawn(
            "python3",
            ["-m", "http.server", String(serverPort), "--bind", "127.0.0.1"],
            {
                cwd: projectRoot,
                stdio: "ignore",
            },
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
            {
                cwd: projectRoot,
                stdio: "ignore",
            },
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
            if (entry.level === "error") {
                consoleErrors.push(entry.text);
            }
        });

        await client.send("Page.navigate", {
            url: `http://127.0.0.1:${serverPort}/`,
        });
        await waitFor(
            client,
            "document.readyState === 'complete' && document.querySelector('#demographics-form')",
            "application load",
        );

        await completeDemographics(client);
        await completePreAssessment(client);

        const contentModule = await client.evaluate(`
            (() => ({
                progress: document.querySelector("#learning-module-progress").textContent.trim(),
                title: document.querySelector("#learning-module-title").textContent.trim(),
                introduction: document.querySelector("#learning-module-content").textContent.trim(),
                heading: document.querySelector("#learning-content-heading")?.textContent.trim() ?? "",
                clueCount: document.querySelectorAll(".learning-clue").length,
                clueNumbers: [...document.querySelectorAll(".learning-clue-number")].map(
                    (element) => element.textContent.trim()
                ),
                clueTitles: [...document.querySelectorAll(".learning-clue-title")].map(
                    (element) => element.textContent.trim()
                ),
                note: document.querySelector("#learning-comparison-note")?.textContent.trim() ?? "",
                playerCount: document.querySelectorAll("#learning-media video").length,
                source: document.querySelector("#learning-media-video").getAttribute("src"),
                controls: document.querySelector("#learning-media-video").controls,
                autoplay: document.querySelector("#learning-media-video").autoplay,
                preload: document.querySelector("#learning-media-video").preload,
                buttonLabels: [...document.querySelectorAll("[data-learning-video]")].map(
                    (button) => button.textContent.trim()
                ),
                selectedVideo: document.querySelector("[data-learning-video].is-selected")?.dataset.learningVideo ?? null,
                quizHidden: document.querySelector("#learning-quiz").hidden,
                continueDisabled: document.querySelector("#learning-continue").disabled
            }))()
        `);
        assert.deepEqual(contentModule, {
            progress: "Module 1 of 2",
            title: "How people detect deepfakes, and where do they go wrong?",
            introduction:
                "Next you will watch more clips of politicians, some authentic and some AI-generated. Here is what research shows about which cues help and which mislead.",
            heading: "Part 1: Five things to know",
            clueCount: 5,
            clueNumbers: ["01", "02", "03", "04", "05"],
            clueTitles: [
                "Confidence is not a reliable signal",
                "Focus on the mouth",
                "Voice can be supporting evidence",
                "Disregard image quality",
                "Verify the source",
            ],
            note:
                "These videos are similar but not identical. A difference between them is not, by itself, evidence of manipulation.",
            playerCount: 1,
            source: "media/learning-trump_real.mp4",
            controls: true,
            autoplay: false,
            preload: "metadata",
            buttonLabels: ["Authentic Video", "Deepfake Video"],
            selectedVideo: "real",
            quizHidden: true,
            continueDisabled: false,
        });
        await waitFor(
            client,
            "document.querySelector('#learning-media-video').readyState >= 1",
            "authentic learning video metadata",
            15000,
        );
        assert.equal(
            await client.evaluate(
                "document.querySelector('#learning-screen [data-next-stage]') === null",
            ),
            true,
            "Learning has no development stage-jump control",
        );

        await setViewport(client, 1440, 1000);
        assert.equal(
            await client.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth",
            ),
            true,
            "desktop layout does not overflow horizontally",
        );
        await captureViewport(client, "/tmp/phase5-learning-desktop.png");

        await setViewport(client, 390, 844, true);
        assert.equal(
            await client.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth",
            ),
            true,
            "mobile layout does not overflow horizontally",
        );
        await captureViewport(client, "/tmp/phase5-learning-mobile.png");

        await client.evaluate(`
            (async () => {
                const video = document.querySelector("#learning-media-video");
                await video.play();
                document.querySelector('[data-learning-video="fake"]').click();
                return true;
            })()
        `);
        await waitFor(
            client,
            `document.querySelector("#learning-media-video").readyState >= 1 &&
             document.querySelector("#learning-media-video").getAttribute("src") === "media/learning-trump_fake.mp4"`,
            "deepfake learning video metadata",
            15000,
        );
        assert.deepEqual(
            await client.evaluate(`
                (() => {
                    const video = document.querySelector("#learning-media-video");
                    return {
                        paused: video.paused,
                        currentTime: video.currentTime,
                        selected: document.querySelector("[data-learning-video].is-selected").dataset.learningVideo,
                        pressed: document.querySelector('[data-learning-video="fake"]').getAttribute("aria-pressed")
                    };
                })()
            `),
            { paused: true, currentTime: 0, selected: "fake", pressed: "true" },
            "switching pauses, resets, and selects the configured video",
        );
        await client.evaluate(
            `document.querySelector('[data-learning-video="real"]').click(); true`,
        );
        await waitFor(
            client,
            `document.querySelector("#learning-media-video").readyState >= 1 &&
             document.querySelector("#learning-media-video").getAttribute("src") === "media/learning-trump_real.mp4"`,
            "return to authentic learning video",
            15000,
        );
        await client.evaluate(`
            (() => {
                const video = document.querySelector("#learning-media-video");
                video.dispatchEvent(new Event("error"));
                return true;
            })()
        `);
        assert.equal(
            await client.evaluate(
                "!document.querySelector('#learning-media-status').hidden",
            ),
            true,
            "learning video errors are communicated",
        );

        await client.evaluate(
            `(() => {
                const video = document.querySelector("#learning-media-video");
                document.querySelector("#learning-continue").click();
                return video.paused;
            })()`,
        );
        await waitFor(
            client,
            "document.querySelector('#learning-module-progress').textContent.includes('Module 2 of 2')",
            "second module",
        );
        assert.equal(
            await client.evaluate(
                "document.querySelector('#learning-module-title').textContent",
            ),
            "Check your understanding",
        );
        assert.equal(
            await client.evaluate(
                "participantSession.learning.completedModuleIds.length === 1 && !participantSession.learning.isComplete",
            ),
            true,
            "only the continued module is marked complete",
        );
        await setViewport(client, 1440, 1000);
        assert.equal(
            await client.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth",
            ),
            true,
            "desktop quiz layout does not overflow horizontally",
        );
        await captureViewport(client, "/tmp/phase5-learning-quiz-desktop.png");
        await setViewport(client, 390, 844, true);
        assert.equal(
            await client.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth",
            ),
            true,
            "mobile quiz layout does not overflow horizontally",
        );
        await captureViewport(client, "/tmp/phase5-learning-quiz-mobile.png");

        assert.deepEqual(
            await client.evaluate(`
                (() => ({
                    progress: document.querySelector("#learning-question-progress").textContent.trim(),
                    question: document.querySelector(".learning-question legend").textContent.trim(),
                    options: document.querySelectorAll('#learning-quiz input[name="learning-quiz-answer"]').length,
                    feedbackHidden: document.querySelector("#learning-feedback").hidden,
                    checkDisabled: document.querySelector("#learning-check-answer").disabled,
                    continueDisabled: document.querySelector("#learning-continue").disabled
                }))()
            `),
            {
                progress: "Question 1 of 4",
                question: "Which of these best describes the mistakes people made in the study?",
                options: 3,
                feedbackHidden: true,
                checkDisabled: true,
                continueDisabled: true,
            },
            "the first quiz question starts unanswered and cannot be skipped",
        );

        const quizSelections = ["a", "b", "a", "c"];
        const expectedFeedback = [
            "People felt just as confident when they were wrong, so feeling sure doesn't tell you much.",
            "Blur doesn't tell you anything either way. The mouth and the way things are said are much better clues.",
            "AI can copy a voice almost perfectly, so a voice that sounds right doesn't prove much on its own.",
            "Judging by quality was right only about half the time, no better than guessing.",
        ];

        for (let questionIndex = 0; questionIndex < 4; questionIndex += 1) {
            assert.equal(
                await client.evaluate(
                    "document.querySelectorAll('#learning-quiz input[name=\"learning-quiz-answer\"]').length",
                ),
                3,
                `question ${questionIndex + 1} has three options`,
            );
            await client.evaluate(`
                (() => {
                    document.querySelector(
                        '#learning-quiz input[name="learning-quiz-answer"][value="${quizSelections[questionIndex]}"]'
                    ).click();
                    return document.querySelector("#learning-check-answer").disabled;
                })()
            `);
            assert.equal(
                await client.evaluate(
                    "document.querySelector('#learning-check-answer').disabled",
                ),
                false,
                "selecting an option enables Check Answer",
            );
            assert.equal(
                await client.evaluate(
                    "document.querySelector('#learning-feedback').hidden",
                ),
                true,
                "feedback remains hidden before submission",
            );
            await client.evaluate(
                "document.querySelector('#learning-check-answer').click(); true",
            );
            await waitFor(
                client,
                "!document.querySelector('#learning-feedback').hidden",
                `question ${questionIndex + 1} feedback`,
            );
            assert.deepEqual(
                await client.evaluate(`
                    (() => ({
                        result: document.querySelector("#learning-feedback-result").textContent.trim(),
                        feedback: document.querySelector("#learning-explanation").textContent.trim(),
                        locked: [...document.querySelectorAll('#learning-quiz input[name="learning-quiz-answer"]')].every(
                            (input) => input.disabled
                        ),
                        saved: participantSession.learning.selectedQuizAnswers.q${questionIndex + 1},
                        continueDisabled: document.querySelector("#learning-continue").disabled
                    }))()
                `),
                {
                    result: questionIndex === 0 ? "Incorrect" : "Correct",
                    feedback: expectedFeedback[questionIndex],
                    locked: true,
                    saved: quizSelections[questionIndex],
                    continueDisabled: false,
                },
                `question ${questionIndex + 1} is saved, locked, and explained`,
            );
            await client.evaluate(
                "document.querySelector('#learning-continue').click(); true",
            );
            if (questionIndex < 3) {
                await waitFor(
                    client,
                    `document.querySelector("#learning-question-progress").textContent.includes("Question ${questionIndex + 2} of 4")`,
                    `question ${questionIndex + 2}`,
                );
            }
        }
        await waitFor(
            client,
            "document.body.dataset.activeStage === 'post-assessment'",
            "post-assessment after Learning",
        );
        assert.equal(
            await client.evaluate(
                "participantSession.learning.isComplete && participantSession.learning.completedModuleIds.length === 2",
            ),
            true,
        );
        assert.equal(
            await client.evaluate(
                "Object.keys(participantSession.learning.selectedQuizAnswers).length === 4",
            ),
            true,
        );
        assert.equal(
            await client.evaluate(
                `JSON.stringify(participantSession.learning.selectedQuizAnswers) === JSON.stringify({ q1: "a", q2: "b", q3: "a", q4: "c" })`,
            ),
            true,
            "the selected quiz answer is recorded",
        );

        await client.evaluate(`
            (() => {
                participantSession.learning = {
                    completedModuleIds: [],
                    selectedQuizAnswers: {},
                    isComplete: false
                };
                initialiseLearningContent([]);
                showStage(2, false);
                return true;
            })()
        `);
        assert.equal(
            await client.evaluate(
                "!document.querySelector('#learning-config-status').hidden",
            ),
            true,
            "empty configuration is explained",
        );
        assert.equal(
            await client.evaluate(
                "document.querySelector('#learning-stage-content').hidden",
            ),
            true,
            "empty configuration cannot continue",
        );
        assert.equal(
            await client.evaluate("participantSession.learning.isComplete"),
            false,
            "empty configuration does not complete Learning",
        );

        await client.evaluate(`
            (() => {
                initialiseLearningContent([
                    {
                        id: "invalid-module",
                        type: "content",
                        title: "",
                        introduction: "",
                        comparisonVideos: {},
                        comparisonNote: "",
                        contentHeading: "",
                        clues: []
                    }
                ]);
                showStage(2, false);
                return true;
            })()
        `);
        assert.equal(
            await client.evaluate(
                "!document.querySelector('#learning-config-status').hidden && document.querySelector('#learning-config-status').classList.contains('is-error')",
            ),
            true,
            "invalid configuration is explained",
        );
        assert.equal(
            await client.evaluate(
                "document.querySelector('#learning-stage-content').hidden",
            ),
            true,
            "invalid configuration cannot continue",
        );

        assert.deepEqual(consoleErrors, [], "no browser console errors");
        console.log("Phase 5 browser checks passed.");
        console.log("Screenshots: /tmp/phase5-learning-desktop.png");
        console.log("Screenshots: /tmp/phase5-learning-mobile.png");
        console.log("Screenshots: /tmp/phase5-learning-quiz-desktop.png");
        console.log("Screenshots: /tmp/phase5-learning-quiz-mobile.png");
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
