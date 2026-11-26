import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
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

async function waitFor(client, expression, label, timeout = 45000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
        if (await client.evaluate(`Boolean(${expression})`)) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
    throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
    if (process.env.RUN_LIVE_SUBMISSION_TEST !== "1") {
        console.log(
            "Live submission check skipped. Set RUN_LIVE_SUBMISSION_TEST=1 to send one synthetic result.",
        );
        return;
    }

    const serverPort = await getAvailablePort();
    const chromePort = await getAvailablePort();
    const chromeProfile = await mkdtemp(join(tmpdir(), "phase7-live-chrome-"));
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

        await client.evaluate(`
            (() => {
                participantSession.participantId = crypto.randomUUID();
                window.__liveTestParticipantId = participantSession.participantId;
                participantSession.consentProvided = true;
                participantSession.demographics = {
                    age: 25,
                    gender: "Female",
                    nationality: "Prefer not to say",
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
                    { stage: "pre", videoId: "t-01", videoPosition: 1, answer: "fake", confidence: 50, clues: ["general_impression"] },
                    { stage: "pre", videoId: "t-02", videoPosition: 2, answer: "real", confidence: 50, clues: ["general_impression"] },
                    { stage: "pre", videoId: "b-01", videoPosition: 3, answer: "fake", confidence: 50, clues: ["general_impression"] },
                    { stage: "pre", videoId: "b-02", videoPosition: 4, answer: "real", confidence: 50, clues: ["general_impression"] },
                    { stage: "post", videoId: "t-03", videoPosition: 1, answer: "fake", confidence: 50, clues: ["general_impression"] },
                    { stage: "post", videoId: "t-04", videoPosition: 2, answer: "real", confidence: 50, clues: ["general_impression"] },
                    { stage: "post", videoId: "b-03", videoPosition: 3, answer: "fake", confidence: 50, clues: ["general_impression"] },
                    { stage: "post", videoId: "b-04", videoPosition: 4, answer: "real", confidence: 50, clues: ["general_impression"] }
                ];
                participantSession.assessmentProgress = {
                    pre: { videoIndex: 4 },
                    post: { videoIndex: 4 }
                };
                participantSession.learning = {
                    completedModuleIds: ["deepfake-clues", "check-understanding"],
                    selectedQuizAnswers: { q1: "c", q3: "a", q4: "c" },
                    isComplete: true
                };
                showStage(4, false);
                document.querySelector("#submit-results").click();
                return true;
            })()
        `);

        await waitFor(
            client,
            `document.querySelector("#submission-status").textContent.trim() === "Your responses have been saved successfully."`,
            "live Google Sheets confirmation",
        );
        const result = await client.evaluate(`
            ({
                idMatches: participantSession.participantId === window.__liveTestParticipantId,
                submitHidden: document.querySelector("#submit-results").hidden,
                newParticipantPresent: document.querySelector("#new-participant") !== null
            })
        `);
        assert.equal(result.idMatches, true);
        assert.equal(result.submitHidden, true);
        assert.equal(result.newParticipantPresent, false);
        assert.equal(consoleErrors.length, 0, "no browser console errors");
        console.log("Phase 7 live Google Sheets submission check passed.");
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
