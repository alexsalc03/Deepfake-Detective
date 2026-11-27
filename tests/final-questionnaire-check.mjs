import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const lessons = JSON.parse(
    await readFile(join(projectRoot, "data/lessons.json"), "utf8"),
);
const questionnaire = JSON.parse(
    await readFile(join(projectRoot, "data/pre-questionnaire.json"), "utf8"),
);

const quizQuestions = lessons.find(
    ({ id }) => id === "check-understanding",
).questions;
const q1 = quizQuestions.find(({ id }) => id === "q1");

assert.equal(quizQuestions.length, 3, "the quiz contains exactly three questions");
assert.deepEqual(
    quizQuestions.map(({ id }) => id),
    ["q1", "q3", "q4"],
    "the quiz keeps the required question order",
);
assert.deepEqual(
    q1,
    {
        id: "q1",
        question:
            "You have just watched a clip and you feel sure it is authentic. How much does that feeling tell you?",
        options: [
            {
                id: "a",
                text: "Not much on its own, because people feel just as sure when they are wrong",
            },
            {
                id: "b",
                text: "A lot, because nothing looked or sounded off while you were watching",
            },
            {
                id: "c",
                text: "It depends, because the feeling is reliable for video but not for audio",
            },
        ],
        correctOptionId: "a",
        feedback:
            "Confidence alone is not a reliable indicator of authenticity. People can feel equally certain even when their judgement is incorrect.",
    },
    "q1 matches the approved replacement content",
);

assert.deepEqual(
    quizQuestions.find(({ id }) => id === "q3"),
    {
        id: "q3",
        question: "Which of these tells you the least about whether a clip is real?",
        options: [
            {
                id: "a",
                text: "The voice sounds exactly like the politician",
            },
            {
                id: "b",
                text: "The lips match every single word being said",
            },
            {
                id: "c",
                text: "The emotion in the voice fits the words",
            },
        ],
        correctOptionId: "a",
        feedback:
            "AI can copy a voice almost perfectly, so a voice that sounds right doesn't prove much on its own.",
    },
    "q3 remains unchanged",
);
assert.deepEqual(
    quizQuestions.find(({ id }) => id === "q4"),
    {
        id: "q4",
        question:
            "A clip is heavily compressed and the face looks a bit pixelated. What should you conclude?",
        options: [
            {
                id: "a",
                text: "Probably fake, since AI often leaves pixelated marks like this",
            },
            {
                id: "b",
                text: "Probably real, since deepfakes are usually sharp and clean",
            },
            {
                id: "c",
                text: "Neither, since real and fake clips both get compressed",
            },
        ],
        correctOptionId: "c",
        feedback:
            "Judging by quality was right only about half the time, no better than guessing.",
    },
    "q4 remains unchanged",
);

const gender = questionnaire.questions.find(({ id }) => id === "gender");
assert.deepEqual(
    gender.options,
    ["Male", "Female", "Non-binary", "Prefer not to answer"],
    "gender uses the approved labels",
);

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
            if (response.ok) return response;
        } catch {
            // Local processes may still be starting.
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
    const chromeProfile = await mkdtemp(
        join(tmpdir(), "final-questionnaire-chrome-"),
    );
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
            "document.readyState === 'complete' && formReady",
            "questionnaire configuration",
        );

        const nationalityData = await client.evaluate(`
            fetch("data/nationalities.json")
                .then((response) => {
                    if (!response.ok) throw new Error("Nationality list did not load");
                    return response.json();
                })
        `);
        assert.ok(
            nationalityData.length === 251,
            "the local nationality list keeps all 251 options",
        );
        assert.equal(
            new Set(nationalityData).size,
            nationalityData.length,
            "nationality options are unique",
        );
        for (const requiredOption of [
            "Italy",
            "Switzerland",
            "Germany",
            "France",
            "Prefer not to answer",
            "Stateless",
        ]) {
            assert.ok(
                nationalityData.includes(requiredOption),
                `${requiredOption} is available`,
            );
        }

        await setViewport(client, 1440, 1000);
        await client.evaluate(`
            (() => {
                document.querySelector("#consent-checkbox").click();
                document.querySelector("#age-confirmation-checkbox").click();
                document.querySelector("#start-experiment").click();
                return true;
            })()
        `);

        const touchSelection = await client.evaluate(`
            (() => {
                const input = document.querySelector("#demographic-nationality");
                input.focus();
                input.dispatchEvent(new FocusEvent("focus"));
                const option = document.querySelector('#demographic-nationality-listbox [role="option"]');
                const touch = (y) => new Touch({ identifier: 1, target: option, clientX: 20, clientY: y });
                const fire = (type, touches) => option.dispatchEvent(new TouchEvent(type, {
                    bubbles: true, cancelable: true, touches,
                }));
                fire("touchstart", [touch(20)]);
                fire("touchmove", [touch(60)]);
                fire("touchend", []);
                const scrollDidNotSelect = !input.dataset.selectedNationality;
                fire("touchstart", [touch(20)]);
                input.dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
                fire("touchend", []);
                const tapSelected = input.value === option.textContent &&
                    input.dataset.selectedNationality === option.textContent;
                input.value = "";
                delete input.dataset.selectedNationality;
                return { scrollDidNotSelect, tapSelected };
            })()
        `);
        assert.deepEqual(touchSelection, { scrollDidNotSelect: true, tapSelected: true });

        const desktopState = await client.evaluate(`
            (() => {
                const primary = document.querySelector("#demographic-nationality");
                document.querySelector("#demographic-age").focus();
                primary.focus();
                primary.dispatchEvent(new FocusEvent("focus"));
                return {
                    stage: document.body.dataset.activeStage,
                    introStep,
                    activeElementId: document.activeElement?.id,
                    primaryHidden: primary.closest("[hidden]") !== null,
                    primaryDisabled: primary.disabled,
                    genderOptions: [
                        ...document.querySelector("#demographic-gender").options
                    ].slice(1).map(({ value }) => value),
                    primaryRole: primary.getAttribute("role"),
                    primaryExpanded: primary.getAttribute("aria-expanded"),
                    nationalityInputCount: document.querySelectorAll(
                        '[data-demographic-id="nationality"] input[type="text"]'
                    ).length,
                    nationalityComboboxCount: document.querySelectorAll(
                        '[data-demographic-id="nationality"] .nationality-combobox'
                    ).length,
                    additionalControlAbsent:
                        document.querySelector(
                            "#demographic-nationality-additional"
                        ) === null,
                    additionalLabelAbsent: ![
                        ...document.querySelectorAll(
                            '[data-demographic-id="nationality"] label'
                        )
                    ].some(({ textContent }) =>
                        /additional nationality/i.test(textContent)
                    ),
                    secondaryNationalityCopyAbsent:
                        !/(?:second|another|additional) nationality/i.test(
                            getQuestionElement("nationality").textContent
                        ),
                    listVisible: !document.querySelector(
                        "#demographic-nationality-listbox"
                    ).hidden,
                    listboxRole: document.querySelector(
                        "#demographic-nationality-listbox"
                    ).getAttribute("role"),
                    optionCount: document.querySelectorAll(
                        '#demographic-nationality-listbox [role="option"]'
                    ).length
                };
            })()
        `);
        assert.deepEqual(desktopState, {
            stage: "welcome",
            introStep: 1,
            activeElementId: "demographic-nationality",
            primaryHidden: false,
            primaryDisabled: false,
            genderOptions: [
                "Male",
                "Female",
                "Non-binary",
                "Prefer not to answer",
            ],
            primaryRole: "combobox",
            primaryExpanded: "true",
            nationalityInputCount: 1,
            nationalityComboboxCount: 1,
            additionalControlAbsent: true,
            additionalLabelAbsent: true,
            secondaryNationalityCopyAbsent: true,
            listVisible: true,
            listboxRole: "listbox",
            optionCount: nationalityData.length,
        });
        await captureViewport(
            client,
            "/tmp/final-questionnaire-desktop.png",
        );

        const filteredOptions = await client.evaluate(`
            (() => {
                const input = document.querySelector("#demographic-nationality");
                input.value = "It";
                input.dispatchEvent(new InputEvent("input", { bubbles: true }));
                return [
                    ...document.querySelectorAll(
                        '#demographic-nationality-listbox [role="option"]'
                    )
                ].map(({ textContent }) => textContent);
            })()
        `);
        assert.equal(
            filteredOptions[0],
            "Italy",
            "typing It prioritizes the beginning-of-name match Italy",
        );
        assert.ok(
            filteredOptions.length < nationalityData.length,
            "filtering removes most non-matching countries",
        );
        assert.equal(
            filteredOptions.every((option) =>
                option.toLocaleLowerCase().includes("it"),
            ),
            true,
            "filtered suggestions are case-insensitive partial matches",
        );

        const accentFilteredOptions = await client.evaluate(`
            (() => {
                const input = document.querySelector("#demographic-nationality");
                input.value = "cote";
                input.dispatchEvent(new InputEvent("input", { bubbles: true }));
                return [
                    ...document.querySelectorAll(
                        '#demographic-nationality-listbox [role="option"]'
                    )
                ].map(({ textContent }) => textContent);
            })()
        `);
        assert.deepEqual(
            accentFilteredOptions,
            ["Côte d’Ivoire"],
            "filtering ignores accents and letter case",
        );

        await setViewport(client, 390, 844, true);
        const mobileSelection = await client.evaluate(`
            (() => {
                const input = document.querySelector("#demographic-nationality");
                input.value = "It";
                input.dispatchEvent(new InputEvent("input", { bubbles: true }));
                input.focus();
                input.dispatchEvent(new KeyboardEvent("keydown", {
                    key: "ArrowDown",
                    bubbles: true
                }));
                input.dispatchEvent(new KeyboardEvent("keydown", {
                    key: "Enter",
                    bubbles: true
                }));
                return {
                    value: input.value,
                    selected: input.dataset.selectedNationality,
                    expanded: input.getAttribute("aria-expanded"),
                    noHorizontalOverflow:
                        document.documentElement.scrollWidth <= window.innerWidth
                };
            })()
        `);
        assert.deepEqual(
            mobileSelection,
            {
                value: "Italy",
                selected: "Italy",
                expanded: "false",
                noHorizontalOverflow: true,
            },
            "keyboard selection works on mobile without horizontal overflow",
        );

        const mouseSelection = await client.evaluate(`
            (() => {
                const input = document.querySelector("#demographic-nationality");
                input.focus();
                input.value = "Swi";
                input.dispatchEvent(new InputEvent("input", { bubbles: true }));
                const option = [
                    ...document.querySelectorAll(
                        '#demographic-nationality-listbox [role="option"]'
                    )
                ].find(({ textContent }) => textContent === "Switzerland");
                option.click();
                return {
                    value: input.value,
                    selected: input.dataset.selectedNationality,
                    expanded: input.getAttribute("aria-expanded"),
                    noHorizontalOverflow:
                        document.documentElement.scrollWidth <= window.innerWidth
                };
            })()
        `);
        assert.deepEqual(
            mouseSelection,
            {
                value: "Switzerland",
                selected: "Switzerland",
                expanded: "false",
                noHorizontalOverflow: true,
            },
            "pointer selection works on mobile",
        );
        await captureViewport(
            client,
            "/tmp/final-questionnaire-mobile.png",
        );

        const invalidEntryState = await client.evaluate(`
            (() => {
                const setValue = (selector, value, eventName = "input") => {
                    const control = document.querySelector(selector);
                    control.value = value;
                    control.dispatchEvent(new Event(eventName, { bubbles: true }));
                };
                setValue("#demographic-age", "25");
                setValue("#demographic-gender", "Non-binary", "change");
                setValue("#demographic-education_level", "University degree", "change");
                const scale = document.querySelector(
                    '[data-demographic-id="political_leaning"] input[type="range"]'
                );
                scale.value = "4";
                scale.dispatchEvent(new Event("input", { bubbles: true }));
                const nationality = document.querySelector(
                    "#demographic-nationality"
                );
                nationality.value = "Atlantis";
                nationality.dispatchEvent(new InputEvent("input", { bubbles: true }));
                document.querySelector("#start-experiment").click();
                return {
                    introStep,
                    error: getQuestionElement("nationality")
                        .querySelector(".field-error").textContent
                };
            })()
        `);
        assert.equal(
            invalidEntryState.introStep,
            1,
            "arbitrary nationality text cannot continue",
        );
        assert.match(
            invalidEntryState.error,
            /select a nationality from the list/i,
            "arbitrary nationality text is rejected with guidance",
        );

        const preferenceState = await client.evaluate(`
            (() => {
                const selectOption = (inputSelector, query, optionText) => {
                    const input = document.querySelector(inputSelector);
                    input.focus();
                    input.value = query;
                    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
                    const option = [
                        ...document.querySelectorAll(
                            \`#\${input.getAttribute("aria-controls")} [role="option"]\`
                        )
                    ].find(({ textContent }) => textContent === optionText);
                    option.click();
                    return input;
                };
                selectOption(
                    "#demographic-nationality",
                    "Prefer",
                    "Prefer not to answer"
                );
                document.querySelector("#start-experiment").click();
                return {
                    introStep,
                    primary: document.querySelector(
                        "#demographic-nationality"
                    ).dataset.selectedNationality
                };
            })()
        `);
        assert.deepEqual(
            preferenceState,
            {
                introStep: 2,
                primary: "Prefer not to answer",
            },
            "the opt-out nationality is accepted on its own",
        );

        await client.evaluate(`
            (() => {
                document.querySelector("#intro-back").click();
                const selectOption = (inputSelector, query, optionText) => {
                    const input = document.querySelector(inputSelector);
                    input.focus();
                    input.value = query;
                    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
                    const option = [
                        ...document.querySelectorAll(
                            \`#\${input.getAttribute("aria-controls")} [role="option"]\`
                        )
                    ].find(({ textContent }) => textContent === optionText);
                    option.click();
                };
                selectOption("#demographic-nationality", "It", "Italy");
                document.querySelector("#start-experiment").click();
                document.querySelector(
                    'input[name="demographic-ai_sentiment"][value="Unsure"]'
                ).click();
                document.querySelector(
                    'input[name="demographic-deepfake_exposure_frequency"][value="Never"]'
                ).click();
                document.querySelector("#start-experiment").click();
                return true;
            })()
        `);
        await waitFor(
            client,
            "document.body.dataset.activeStage === 'pre-assessment'",
            "pre-assessment after demographics",
        );

        const storedPayload = await client.evaluate(`
            (() => {
                const payload = prepareSubmissionPayload();
                return {
                    nationality: participantSession.demographics.nationality,
                    payloadNationality: payload.demographics.nationality,
                    nationalityKeys: Object.keys(payload.demographics).filter(
                        (key) => /nationality/i.test(key)
                    ),
                    nationalityType: typeof payload.demographics.nationality,
                    gender: participantSession.demographics.gender,
                    payloadGender: payload.demographics.gender
                };
            })()
        `);
        assert.deepEqual(
            storedPayload,
            {
                nationality: "Italy",
                payloadNationality: "Italy",
                nationalityKeys: ["nationality"],
                nationalityType: "string",
                gender: "Non-binary",
                payloadGender: "Non-binary",
            },
            "the submission payload contains exactly one nationality string",
        );

        const genderValidation = await client.evaluate(`
            (() => {
                const question = demographicsConfig.questions.find(
                    ({ id }) => id === "gender"
                );
                const control = document.querySelector("#demographic-gender");
                const originalValue = control.value;
                const results = question.options.map((option) => {
                    control.value = option;
                    return { option, valid: validateQuestion(question).valid };
                });
                control.value = originalValue;
                return results;
            })()
        `);
        assert.deepEqual(
            genderValidation,
            [
                { option: "Male", valid: true },
                { option: "Female", valid: true },
                { option: "Non-binary", valid: true },
                { option: "Prefer not to answer", valid: true },
            ],
            "frontend validation accepts each approved gender option",
        );
        assert.deepEqual(consoleErrors, [], "no browser console errors");
        console.log("Final questionnaire browser checks passed.");
        console.log("Screenshots: /tmp/final-questionnaire-desktop.png");
        console.log("Screenshots: /tmp/final-questionnaire-mobile.png");
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
