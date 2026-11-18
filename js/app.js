const stages = [
    {
        id: "welcome",
        screenId: "welcome-screen",
    },
    {
        id: "pre-assessment",
        screenId: "assessment-screen",
        assessmentMode: "pre",
        title: "Pre-Assessment",
        nextLabel: "Continue to Learning",
    },
    {
        id: "learning",
        screenId: "learning-screen",
    },
    {
        id: "post-assessment",
        screenId: "assessment-screen",
        assessmentMode: "post",
        title: "Post-Assessment",
        nextLabel: "View Results",
    },
    {
        id: "results",
        screenId: "results-screen",
    },
];

const screens = [...document.querySelectorAll("[data-screen]")];
const progressSteps = [...document.querySelectorAll("[data-stage-id]")];
const assessmentScreen = document.querySelector("#assessment-screen");
const assessmentTitle = document.querySelector("#assessment-title");
const assessmentForm = document.querySelector("#assessment-form");
const assessmentConfigStatus = document.querySelector(
    "#assessment-config-status",
);
const assessmentContent = document.querySelector("#assessment-content");
const assessmentQuestions = document.querySelector("#assessment-questions");
const assessmentVideo = document.querySelector("#assessment-video");
const assessmentVideoStatus = document.querySelector(
    "#assessment-video-status",
);
const assessmentVideoPosition = document.querySelector("[data-video-position]");
const assessmentProgressTrack = document.querySelector(
    "#assessment-progress-track",
);
const assessmentProgressFill = document.querySelector(
    "#assessment-progress-fill",
);
const assessmentErrorSummary = document.querySelector(
    "#assessment-error-summary",
);
const assessmentSubmitButton = document.querySelector("#assessment-submit");
const assessmentNextLabel = document.querySelector(
    "[data-assessment-next-label]",
);
const demographicsForm = document.querySelector("#demographics-form");
const demographicsQuestions = document.querySelector("#demographics-questions");
const demographicsConfigStatus = document.querySelector("#demographics-config-status");
const consentStatement = document.querySelector("#consent-statement");
const consentCheckbox = document.querySelector("#consent-checkbox");
const consentError = document.querySelector("#consent-error");
const formErrorSummary = document.querySelector("#form-error-summary");
const startExperimentButton = document.querySelector("#start-experiment");
const supportedQuestionTypes = new Set([
    "text",
    "number",
    "select",
    "radio",
    "checkbox",
]);

let currentStageIndex = 0;
let demographicsConfig = null;
let formReady = false;
let assessmentQuestionsConfig = null;
let assessmentVideos = [];
let assessmentContentReady = false;
let assessmentSubmitting = false;
let lastAssessmentSubmissionAt = -Infinity;

const participantSession = {
    participantId: null,
    consentProvided: false,
    demographics: {},
    condition: null,
    videoSets: {
        pre: null,
        post: null,
    },
    currentStage: null,
    assessmentAnswers: [],
    assessmentProgress: {
        pre: {
            videoIndex: 0,
        },
        post: {
            videoIndex: 0,
        },
    },
};

function showStage(stageIndex, moveFocus = true) {
    const stage = stages[stageIndex];
    const activeScreen = document.querySelector(`#${stage.screenId}`);

    currentStageIndex = stageIndex;
    participantSession.currentStage = stage.id;
    document.body.dataset.activeStage = stage.id;

    screens.forEach((screen) => {
        screen.hidden = screen !== activeScreen;
    });

    progressSteps.forEach((step, index) => {
        step.classList.toggle("is-complete", index < stageIndex);
        step.classList.toggle("is-current", index === stageIndex);

        if (index === stageIndex) {
            step.setAttribute("aria-current", "step");
        } else {
            step.removeAttribute("aria-current");
        }
    });

    if (stage.assessmentMode) {
        assessmentScreen.dataset.assessmentMode = stage.assessmentMode;
        assessmentTitle.textContent = stage.title;
        renderAssessmentStage(stage.assessmentMode);
    }

    document.title =
        stageIndex === 0
            ? "Deepfake Detective"
            : `${stage.title ?? activeScreen.querySelector("h2").textContent} | Deepfake Detective`;

    if (moveFocus) {
        const activeHeading = activeScreen.querySelector("h2");
        activeHeading.focus({ preventScroll: true });
    }
}

function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    if (text) {
        element.textContent = text;
    }
    return element;
}

function getQuestionControlId(questionId, optionIndex = null) {
    const suffix = optionIndex === null ? "" : `-${optionIndex}`;
    return `demographic-${questionId}${suffix}`;
}

function getQuestionElement(questionId) {
    return [...demographicsQuestions.children].find(
        (element) => element.dataset.demographicId === questionId,
    );
}

function setQuestionError(questionElement, message) {
    const errorElement = questionElement.querySelector(".field-error");
    const controls = questionElement.querySelectorAll("input, select");

    errorElement.textContent = message;
    errorElement.hidden = !message;

    if (message) {
        questionElement.setAttribute("aria-invalid", "true");
    } else {
        questionElement.removeAttribute("aria-invalid");
    }

    controls.forEach((control) => {
        if (message) {
            control.setAttribute("aria-invalid", "true");
        } else {
            control.removeAttribute("aria-invalid");
        }
    });
}

function clearQuestionError(questionElement) {
    if (questionElement) {
        setQuestionError(questionElement, "");
    }
}

function clearConsentError() {
    consentError.hidden = true;
    consentCheckbox.removeAttribute("aria-invalid");
}

function createChoiceQuestion(question) {
    const fieldset = createElement("fieldset", "form-question");
    fieldset.dataset.demographicQuestion = "";
    fieldset.dataset.demographicId = question.id;
    fieldset.setAttribute("aria-describedby", `${getQuestionControlId(question.id)}-error`);

    const legend = createElement("legend", "question-label", question.label);
    const choices = createElement("div", "choice-list");
    const error = createElement("p", "field-error");
    error.id = `${getQuestionControlId(question.id)}-error`;
    error.setAttribute("role", "alert");
    error.hidden = true;

    question.options.forEach((option, index) => {
        const input = document.createElement("input");
        input.id = getQuestionControlId(question.id, index);
        input.name = getQuestionControlId(question.id);
        input.type = question.type;
        input.value = option;
        input.required = Boolean(question.required);
        input.setAttribute(
            "aria-describedby",
            `${getQuestionControlId(question.id)}-error`,
        );

        const label = createElement("label", "choice-option");
        label.htmlFor = input.id;
        label.append(input, createElement("span", "", option));
        choices.append(label);
    });

    fieldset.append(legend, choices, error);
    return fieldset;
}

function createSingleControlQuestion(question) {
    const container = createElement("div", "form-question");
    container.dataset.demographicQuestion = "";
    container.dataset.demographicId = question.id;

    const label = createElement("label", "question-label", question.label);
    label.htmlFor = getQuestionControlId(question.id);

    let control;
    if (question.type === "select") {
        control = document.createElement("select");
        control.append(new Option("Select an answer", ""));
        question.options.forEach((option) => control.append(new Option(option, option)));
    } else {
        control = document.createElement("input");
        control.type = question.type;
        control.className = "text-control";
        if (question.type === "number") {
            control.step = "1";
            if (Number.isFinite(question.min)) {
                control.min = String(question.min);
            }
            if (Number.isFinite(question.max)) {
                control.max = String(question.max);
            }
        }
    }

    if (question.type === "select") {
        control.className = "text-control";
    }

    control.id = getQuestionControlId(question.id);
    control.name = getQuestionControlId(question.id);
    control.required = Boolean(question.required);
    control.setAttribute("aria-describedby", `${control.id}-error`);

    const error = createElement("p", "field-error");
    error.id = `${control.id}-error`;
    error.setAttribute("role", "alert");
    error.hidden = true;

    container.append(label, control, error);
    return container;
}

function renderQuestion(question) {
    return question.type === "radio" || question.type === "checkbox"
        ? createChoiceQuestion(question)
        : createSingleControlQuestion(question);
}

function isConfiguredQuestion(question) {
    const hasValidIdentity =
        question &&
        typeof question.id === "string" &&
        question.id.trim() &&
        typeof question.label === "string" &&
        question.label.trim() &&
        supportedQuestionTypes.has(question.type);
    const needsOptions = ["select", "radio", "checkbox"].includes(question?.type);
    const hasValidOptions =
        !needsOptions ||
        (Array.isArray(question.options) &&
            question.options.length > 0 &&
            question.options.every(
                (option) => typeof option === "string" && option.trim(),
            ));
    const hasValidNumberRange =
        question?.type !== "number" ||
        ((question.min === undefined || Number.isFinite(question.min)) &&
            (question.max === undefined || Number.isFinite(question.max)) &&
            (!Number.isFinite(question.min) ||
                !Number.isFinite(question.max) ||
                question.min <= question.max));

    return Boolean(hasValidIdentity && hasValidOptions && hasValidNumberRange);
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function isConfiguredAssessmentOption(option) {
    return (
        isRecord(option) &&
        isNonEmptyString(option.value) &&
        isNonEmptyString(option.label)
    );
}

function validateAssessmentConfig(config) {
    if (!isRecord(config) || !Array.isArray(config.questions)) {
        return {
            isValid: false,
            message:
                "Assessment content is not validly configured. The assessment is unavailable until the research team provides question content.",
        };
    }

    if (config.questions.length === 0) {
        return {
            isValid: false,
            message:
                "Assessment content is not configured. The assessment is unavailable until the research team provides question content.",
        };
    }

    const supportedTypes = new Set(["classification", "confidence", "clues"]);
    const seenIds = new Set();
    const seenTypes = new Set();

    for (const question of config.questions) {
        if (
            !isRecord(question) ||
            !isNonEmptyString(question.id) ||
            !isNonEmptyString(question.label) ||
            question.required !== true ||
            !supportedTypes.has(question.type) ||
            seenIds.has(question.id) ||
            seenTypes.has(question.type)
        ) {
            return {
                isValid: false,
                message:
                    "Assessment content is not validly configured. Each required question must have a unique ID, type, and label.",
            };
        }

        seenIds.add(question.id);
        seenTypes.add(question.type);

        if (question.type === "classification") {
            const optionValues = Array.isArray(question.options)
                ? question.options
                      .filter(isConfiguredAssessmentOption)
                      .map((option) => option.value)
                : [];

            if (
                !Array.isArray(question.options) ||
                question.options.length !== 2 ||
                question.options.some(
                    (option) => !isConfiguredAssessmentOption(option),
                ) ||
                new Set(optionValues).size !== 2 ||
                !optionValues.includes("real") ||
                !optionValues.includes("fake")
            ) {
                return {
                    isValid: false,
                    message:
                        'Assessment content is not validly configured. Classification requires exactly two options with values "real" and "fake".',
                };
            }
        }

        if (question.type === "confidence") {
            const step = question.step ?? 1;
            if (
                question.min !== 0 ||
                question.max !== 100 ||
                !Number.isFinite(step) ||
                step <= 0 ||
                step > 50
            ) {
                return {
                    isValid: false,
                    message:
                        "Assessment content is not validly configured. Confidence must use a slider from 0 to 100 with a positive step.",
                };
            }
        }

        if (question.type === "clues") {
            const optionValues = Array.isArray(question.options)
                ? question.options
                      .filter(isConfiguredAssessmentOption)
                      .map((option) => option.value)
                : [];

            if (
                !Array.isArray(question.options) ||
                question.options.length === 0 ||
                question.options.some(
                    (option) => !isConfiguredAssessmentOption(option),
                ) ||
                new Set(optionValues).size !== question.options.length
            ) {
                return {
                    isValid: false,
                    message:
                        "Assessment content is not validly configured. Detection clues require uniquely valued options.",
                };
            }
        }
    }

    if (
        seenTypes.size !== 3 ||
        !seenTypes.has("classification") ||
        !seenTypes.has("confidence") ||
        !seenTypes.has("clues")
    ) {
        return {
            isValid: false,
            message:
                "Assessment content is not validly configured. Classification, confidence, and detection clue questions are required.",
        };
    }

    return { isValid: true, message: "" };
}

function validateVideoConfig(config) {
    if (!Array.isArray(config)) {
        return {
            isValid: false,
            message:
                "Video content is not validly configured. The assessment is unavailable until the research team provides video files.",
        };
    }

    if (config.length === 0) {
        return {
            isValid: false,
            message:
                "Video content is not configured. The assessment is unavailable until the research team provides video files.",
        };
    }

    const ids = new Set();
    const files = new Set();
    const sets = new Set();

    for (const video of config) {
        const file = isRecord(video) ? video.file?.trim() : "";
        const isLocalFile =
            file &&
            !file.startsWith("//") &&
            !/^[a-z][a-z\d+.-]*:/i.test(file);

        if (
            !isRecord(video) ||
            !isNonEmptyString(video.id) ||
            !isNonEmptyString(video.file) ||
            typeof video.source !== "string" ||
            !["real", "fake"].includes(video.label) ||
            !["A", "B"].includes(video.set) ||
            ids.has(video.id) ||
            files.has(file) ||
            !isLocalFile
        ) {
            return {
                isValid: false,
                message:
                    "Video content is not validly configured. Each video needs a unique ID, local file, real or fake label, set A or B, and source field.",
            };
        }

        ids.add(video.id);
        files.add(file);
        sets.add(video.set);
    }

    if (!sets.has("A") || !sets.has("B")) {
        return {
            isValid: false,
            message:
                "Video content is not validly configured. Both assessment sets A and B require at least one video.",
        };
    }

    return { isValid: true, message: "" };
}

function assignParticipantCondition() {
    if (participantSession.condition !== null) {
        return;
    }

    participantSession.condition = Math.random() < 0.5 ? 1 : 2;
    participantSession.videoSets =
        participantSession.condition === 1
            ? { pre: "A", post: "B" }
            : { pre: "B", post: "A" };
}

function setParticipationUnavailable(message, isError = false) {
    formReady = false;
    demographicsConfigStatus.textContent = message;
    demographicsConfigStatus.hidden = false;
    demographicsConfigStatus.classList.toggle("is-error", isError);
    consentCheckbox.disabled = true;
    consentCheckbox.checked = false;
    startExperimentButton.disabled = true;
}

function setConsentContent(statement) {
    const hasStatement = typeof statement === "string" && statement.trim();

    consentStatement.textContent = hasStatement
        ? statement
        : "Consent statement is not configured. Participation is unavailable until the research team provides approved consent text.";
    consentStatement.classList.toggle("is-placeholder", !hasStatement);

    return Boolean(hasStatement);
}

function initialiseDemographics(config) {
    const questions = Array.isArray(config)
        ? config
        : Array.isArray(config?.questions)
          ? config.questions
          : null;
    const consentText =
        !Array.isArray(config) && typeof config?.consentStatement === "string"
            ? config.consentStatement
            : "";

    demographicsQuestions.replaceChildren();
    clearConsentError();
    formErrorSummary.hidden = true;
    consentCheckbox.checked = false;

    if (questions === null || !questions.every(isConfiguredQuestion)) {
        setParticipationUnavailable(
            "Questionnaire content is not validly configured. Participation is unavailable.",
            true,
        );
        setConsentContent(consentText);
        return;
    }

    const hasConsentStatement = setConsentContent(consentText);
    demographicsConfig = { questions, consentStatement: consentText };

    if (questions.length === 0) {
        setParticipationUnavailable(
            "The questionnaire is not configured. Participation is unavailable until the research team provides demographic questions.",
        );
        return;
    }

    questions.forEach((question) => {
        demographicsQuestions.append(renderQuestion(question));
    });

    demographicsConfigStatus.hidden = true;
    formReady = questions.length > 0 && hasConsentStatement;
    consentCheckbox.disabled = !formReady;
    startExperimentButton.disabled = !formReady;
}

function validateQuestion(question) {
    const questionElement = getQuestionElement(question.id);

    if (question.type === "checkbox") {
        const checkedInputs = [
            ...questionElement.querySelectorAll(
                'input[type="checkbox"]:checked',
            ),
        ];
        const values = checkedInputs.map((input) => input.value);
        const hasInvalidValue = values.some(
            (value) => !question.options.includes(value),
        );

        if (!values.length && question.required) {
            return {
                valid: false,
                message: "Select at least one option.",
                value: values,
            };
        }

        if (hasInvalidValue) {
            return {
                valid: false,
                message: "Select options only from the list.",
                value: values,
            };
        }

        return { valid: true, message: "", value: values };
    }

    if (question.type === "radio") {
        const selectedInput = questionElement.querySelector(
            'input[type="radio"]:checked',
        );
        const value = selectedInput?.value ?? "";

        if (!value && question.required) {
            return { valid: false, message: "Select an option.", value };
        }

        if (value && !question.options.includes(value)) {
            return {
                valid: false,
                message: "Select an option from the list.",
                value,
            };
        }

        return { valid: true, message: "", value };
    }

    const control = questionElement.querySelector("input, select");
    const rawValue = control.value.trim();

    if (rawValue === "" && question.required) {
        return {
            valid: false,
            message: question.type === "number" ? "Enter a number." : "Enter an answer.",
            value: "",
        };
    }

    if (question.type === "number" && rawValue) {
        const numberValue = Number(rawValue);
        if (control.validity.badInput || !Number.isFinite(numberValue)) {
            return {
                valid: false,
                message: "Enter a valid number.",
                value: rawValue,
            };
        }

        const hasMinimum = Number.isFinite(question.min);
        const hasMaximum = Number.isFinite(question.max);
        if (
            hasMinimum &&
            hasMaximum &&
            (numberValue < question.min || numberValue > question.max)
        ) {
            return {
                valid: false,
                message: `Enter a number from ${question.min} to ${question.max}.`,
                value: numberValue,
            };
        }
        if (hasMinimum && numberValue < question.min) {
            return {
                valid: false,
                message: `Enter a number of at least ${question.min}.`,
                value: numberValue,
            };
        }
        if (hasMaximum && numberValue > question.max) {
            return {
                valid: false,
                message: `Enter a number no greater than ${question.max}.`,
                value: numberValue,
            };
        }

        return { valid: true, message: "", value: numberValue };
    }

    if (
        question.type === "select" &&
        rawValue &&
        !question.options.includes(rawValue)
    ) {
        return {
            valid: false,
            message: "Select an option from the list.",
            value: rawValue,
        };
    }

    return { valid: true, message: "", value: rawValue };
}

function validateDemographics() {
    const responses = {};
    let firstInvalidElement = null;

    demographicsConfig.questions.forEach((question) => {
        const result = validateQuestion(question);
        const questionElement = getQuestionElement(question.id);

        setQuestionError(questionElement, result.message);
        responses[question.id] = result.value;

        if (!result.valid && !firstInvalidElement) {
            firstInvalidElement = questionElement;
        }
    });

    const consentIsValid = consentCheckbox.checked;
    consentError.hidden = consentIsValid;

    if (consentIsValid) {
        consentCheckbox.removeAttribute("aria-invalid");
    } else {
        consentCheckbox.setAttribute("aria-invalid", "true");
    }

    return {
        isValid: !firstInvalidElement && consentIsValid,
        responses,
        firstInvalidElement,
    };
}

function setAssessmentUnavailable(message, isError = false) {
    assessmentContentReady = false;
    assessmentQuestionsConfig = null;
    assessmentVideos = [];
    assessmentQuestions.replaceChildren();
    assessmentContent.hidden = true;
    assessmentSubmitButton.disabled = true;
    assessmentSubmitButton.hidden = true;
    assessmentErrorSummary.hidden = true;
    assessmentVideoStatus.hidden = true;
    assessmentVideo.pause();
    assessmentVideo.removeAttribute("src");
    assessmentVideo.load();
    assessmentConfigStatus.textContent = message;
    assessmentConfigStatus.hidden = false;
    assessmentConfigStatus.classList.toggle("is-error", isError);
}

function initialiseAssessmentContent(videoConfig, questionConfig) {
    const videoValidation = validateVideoConfig(videoConfig);
    if (!videoValidation.isValid) {
        setAssessmentUnavailable(videoValidation.message, true);
        return;
    }

    const questionValidation = validateAssessmentConfig(questionConfig);
    if (!questionValidation.isValid) {
        setAssessmentUnavailable(questionValidation.message, true);
        return;
    }

    assessmentVideos = videoConfig.map((video) => ({
        ...video,
        id: video.id.trim(),
        file: video.file.trim(),
    }));
    assessmentQuestionsConfig = questionConfig;
    assessmentContentReady = true;
    assessmentConfigStatus.hidden = true;
    assessmentConfigStatus.classList.remove("is-error");

    const currentStage = stages[currentStageIndex];
    if (currentStage.assessmentMode) {
        renderAssessmentStage(currentStage.assessmentMode);
    }
}

async function loadAssessmentContent() {
    try {
        const [videoResponse, questionResponse] = await Promise.all([
            fetch("data/videos.json"),
            fetch("data/assessment.json"),
        ]);

        if (!videoResponse.ok || !questionResponse.ok) {
            throw new Error("Assessment content request failed");
        }

        const [videoConfig, questionConfig] = await Promise.all([
            videoResponse.json(),
            questionResponse.json(),
        ]);
        initialiseAssessmentContent(videoConfig, questionConfig);
    } catch {
        setAssessmentUnavailable(
            "Assessment content could not be loaded. The assessment is unavailable until the content files can be read.",
            true,
        );
    }
}

function getAssessmentMode() {
    return stages[currentStageIndex].assessmentMode ?? null;
}

function getAssessmentVideos(mode) {
    const assignedSet = participantSession.videoSets[mode];
    return assessmentVideos.filter((video) => video.set === assignedSet);
}

function getAssessmentQuestionElement(type) {
    return [...assessmentQuestions.children].find(
        (element) => element.dataset.assessmentType === type,
    );
}

function setAssessmentQuestionError(questionElement, message) {
    const error = questionElement.querySelector(".field-error");
    const controls = questionElement.querySelectorAll("input");

    error.textContent = message;
    error.hidden = !message;

    if (message) {
        questionElement.setAttribute("aria-invalid", "true");
    } else {
        questionElement.removeAttribute("aria-invalid");
    }

    controls.forEach((control) => {
        if (message) {
            control.setAttribute("aria-invalid", "true");
        } else {
            control.removeAttribute("aria-invalid");
        }
    });
}

function createAssessmentFieldset(question) {
    const fieldset = createElement(
        "fieldset",
        "assessment-question assessment-fieldset",
    );
    const errorId = `assessment-${question.type}-error`;
    const legend = createElement(
        "legend",
        "assessment-question-label",
        question.label,
    );
    const error = createElement("p", "field-error");

    fieldset.dataset.assessmentType = question.type;
    fieldset.dataset.assessmentId = question.id;
    fieldset.setAttribute("aria-describedby", errorId);
    error.id = errorId;
    error.setAttribute("role", "alert");
    error.hidden = true;
    fieldset.append(legend);

    return { fieldset, error };
}

function createClassificationQuestion(question) {
    const { fieldset, error } = createAssessmentFieldset(question);
    const options = createElement("div", "classification-options");

    question.options.forEach((option, index) => {
        const input = document.createElement("input");
        const label = createElement("label", "classification-option");
        const text = createElement("span", "", option.label);

        input.id = `assessment-classification-${index}`;
        input.name = "assessment-classification";
        input.type = "radio";
        input.value = option.value;
        input.required = true;
        input.setAttribute("aria-describedby", error.id);

        label.htmlFor = input.id;
        label.append(input, text);
        options.append(label);
    });

    fieldset.append(options, error);
    return fieldset;
}

function updateConfidenceDisplay(range) {
    const output = document.querySelector("#assessment-confidence-value");
    const hasSelection = range.dataset.touched === "true";
    const valueText = hasSelection
        ? `${range.value}%`
        : "Choose a confidence level";

    output.textContent = valueText;
    output.classList.toggle("is-unselected", !hasSelection);
    range.setAttribute(
        "aria-valuetext",
        hasSelection ? `${range.value} percent` : "No confidence selected",
    );
}

function createConfidenceQuestion(question) {
    const { fieldset, error } = createAssessmentFieldset(question);
    const control = createElement("div", "confidence-control");
    const output = document.createElement("output");
    const range = document.createElement("input");
    const labels = createElement("div", "confidence-range-labels");

    output.id = "assessment-confidence-value";
    output.className = "confidence-value is-unselected";
    output.htmlFor = "assessment-confidence";
    output.textContent = "Choose a confidence level";

    range.id = "assessment-confidence";
    range.name = "assessment-confidence";
    range.type = "range";
    range.className = "confidence-range";
    range.min = String(question.min);
    range.max = String(question.max);
    range.step = String(question.step ?? 1);
    range.value = String(question.min);
    range.required = true;
    range.dataset.touched = "false";
    range.setAttribute("aria-describedby", error.id);
    range.setAttribute("aria-valuetext", "No confidence selected");

    labels.append(
        createElement("span", "", `${question.min}%`),
        createElement("span", "", `${question.max}%`),
    );
    control.append(output, range, labels);
    fieldset.append(control, error);
    return fieldset;
}

function createCluesQuestion(question) {
    const { fieldset, error } = createAssessmentFieldset(question);
    const choices = createElement("div", "choice-list");

    question.options.forEach((option, index) => {
        const input = document.createElement("input");
        const label = createElement("label", "choice-option");

        input.id = `assessment-clue-${index}`;
        input.name = "assessment-clues";
        input.type = "checkbox";
        input.value = option.value;
        input.setAttribute("aria-describedby", error.id);

        label.htmlFor = input.id;
        label.append(input, createElement("span", "", option.label));
        choices.append(label);
    });

    fieldset.append(choices, error);
    return fieldset;
}

function renderAssessmentQuestions() {
    assessmentQuestions.replaceChildren();

    assessmentQuestionsConfig.questions.forEach((question) => {
        if (question.type === "classification") {
            assessmentQuestions.append(createClassificationQuestion(question));
        } else if (question.type === "confidence") {
            assessmentQuestions.append(createConfidenceQuestion(question));
        } else {
            assessmentQuestions.append(createCluesQuestion(question));
        }
    });
}

function renderAssessmentStage(mode) {
    const progress = participantSession.assessmentProgress[mode];
    const videos = getAssessmentVideos(mode);
    const currentVideo = videos[progress.videoIndex];

    assessmentErrorSummary.hidden = true;
    assessmentSubmitButton.disabled = true;
    assessmentVideoStatus.hidden = true;

    if (!assessmentContentReady) {
        assessmentContent.hidden = true;
        assessmentSubmitButton.hidden = true;
        return;
    }

    if (!participantSession.condition) {
        assessmentContent.hidden = true;
        assessmentSubmitButton.hidden = true;
        assessmentConfigStatus.textContent =
            "The assessment session has not started. Complete the welcome stage before continuing.";
        assessmentConfigStatus.hidden = false;
        assessmentConfigStatus.classList.add("is-error");
        return;
    }

    if (!currentVideo) {
        assessmentContent.hidden = true;
        assessmentSubmitButton.hidden = true;
        assessmentConfigStatus.textContent =
            "This assessment section is complete. Use Back to return to the previous stage.";
        assessmentConfigStatus.hidden = false;
        assessmentConfigStatus.classList.remove("is-error");
        return;
    }

    assessmentConfigStatus.hidden = true;
    assessmentContent.hidden = false;
    assessmentSubmitButton.hidden = false;
    assessmentSubmitButton.disabled = false;
    assessmentVideoPosition.textContent = `Video ${progress.videoIndex + 1} of ${videos.length}`;
    assessmentProgressTrack.setAttribute("aria-valuemax", String(videos.length));
    assessmentProgressTrack.setAttribute(
        "aria-valuenow",
        String(progress.videoIndex + 1),
    );
    assessmentProgressFill.style.width = `${
        ((progress.videoIndex + 1) / videos.length) * 100
    }%`;

    renderAssessmentQuestions();

    assessmentVideoStatus.hidden = true;
    assessmentVideo.dataset.failed = "false";
    assessmentVideo.style.removeProperty("aspect-ratio");
    assessmentVideo.src = currentVideo.file;
    assessmentVideo.load();

    assessmentNextLabel.textContent =
        progress.videoIndex === videos.length - 1
            ? stages[currentStageIndex].nextLabel
            : "Submit and Continue";
}

function validateAssessmentAnswers() {
    const answers = {
        answer: "",
        confidence: null,
        clues: [],
    };
    let firstInvalidElement = null;

    assessmentQuestionsConfig.questions.forEach((question) => {
        const questionElement = getAssessmentQuestionElement(question.type);
        let message = "";

        if (question.type === "classification") {
            const selected = questionElement.querySelector(
                'input[type="radio"]:checked',
            );
            const allowedValues = question.options.map((option) => option.value);
            answers.answer = selected?.value ?? "";

            if (!selected) {
                message = "Select a classification.";
            } else if (!allowedValues.includes(selected.value)) {
                message = "Select a configured classification.";
            }
        }

        if (question.type === "confidence") {
            const range = questionElement.querySelector('input[type="range"]');
            const value = Number(range.value);
            const hasSelection = range.dataset.touched === "true";

            if (!hasSelection) {
                message = "Choose a confidence level.";
            } else if (
                !Number.isFinite(value) ||
                value < question.min ||
                value > question.max
            ) {
                message = "Choose a confidence level within the available range.";
            } else {
                answers.confidence = value;
            }
        }

        if (question.type === "clues") {
            const selectedOptions = [
                ...questionElement.querySelectorAll(
                    'input[type="checkbox"]:checked',
                ),
            ];
            const allowedValues = question.options.map((option) => option.value);
            answers.clues = selectedOptions.map((input) => input.value);

            if (!selectedOptions.length) {
                message = "Select at least one clue.";
            } else if (
                answers.clues.some((value) => !allowedValues.includes(value))
            ) {
                message = "Select clues only from the configured list.";
            }
        }

        setAssessmentQuestionError(questionElement, message);

        if (message && !firstInvalidElement) {
            firstInvalidElement = questionElement;
        }
    });

    return {
        isValid: !firstInvalidElement,
        answers,
        firstInvalidElement,
    };
}

function handleAssessmentSubmit(event) {
    event.preventDefault();

    const mode = getAssessmentMode();
    if (
        assessmentSubmitting ||
        !mode ||
        !assessmentContentReady ||
        !participantSession.condition ||
        performance.now() - lastAssessmentSubmissionAt < 500
    ) {
        return;
    }

    const videos = getAssessmentVideos(mode);
    const progress = participantSession.assessmentProgress[mode];
    const currentVideo = videos[progress.videoIndex];

    if (!currentVideo) {
        return;
    }

    assessmentSubmitting = true;
    assessmentSubmitButton.disabled = true;

    if (assessmentVideo.dataset.failed === "true") {
        assessmentVideoStatus.hidden = false;
        assessmentSubmitting = false;
        return;
    }

    const validation = validateAssessmentAnswers();
    if (!validation.isValid) {
        assessmentErrorSummary.textContent =
            "Please answer each highlighted question before continuing.";
        assessmentErrorSummary.hidden = false;
        assessmentSubmitButton.disabled = false;
        assessmentSubmitting = false;
        validation.firstInvalidElement.querySelector("input").focus();
        return;
    }

    participantSession.assessmentAnswers.push({
        stage: mode,
        videoId: currentVideo.id,
        videoPosition: progress.videoIndex + 1,
        answer: validation.answers.answer,
        confidence: validation.answers.confidence,
        clues: validation.answers.clues,
    });
    lastAssessmentSubmissionAt = performance.now();
    progress.videoIndex += 1;
    assessmentSubmitting = false;

    if (progress.videoIndex >= videos.length) {
        showStage(currentStageIndex + 1);
        return;
    }

    renderAssessmentStage(mode);
}

function generateParticipantId() {
    return crypto.randomUUID();
}

function handleDemographicsSubmit(event) {
    event.preventDefault();

    if (participantSession.participantId) {
        showStage(1);
        return;
    }

    if (!formReady || !demographicsConfig) {
        formErrorSummary.textContent =
            "Participation is unavailable until the questionnaire is fully configured.";
        formErrorSummary.hidden = false;
        return;
    }

    const validation = validateDemographics();
    if (!validation.isValid) {
        formErrorSummary.textContent =
            "Please correct the highlighted fields and confirm consent before continuing.";
        formErrorSummary.hidden = false;

        const focusTarget =
            validation.firstInvalidElement?.querySelector("input, select") ??
            consentCheckbox;
        focusTarget.focus();
        return;
    }

    participantSession.participantId = generateParticipantId();
    participantSession.consentProvided = true;
    participantSession.demographics = validation.responses;
    assignParticipantCondition();
    formErrorSummary.hidden = true;
    showStage(1);
}

document.addEventListener("click", (event) => {
    const nextButton = event.target.closest("[data-next-stage]");
    const previousButton = event.target.closest("[data-previous-stage]");

    if (nextButton && currentStageIndex < stages.length - 1) {
        if (getAssessmentMode()) {
            return;
        }
        showStage(currentStageIndex + 1);
    }

    if (previousButton && currentStageIndex > 0) {
        showStage(currentStageIndex - 1);
    }
});

demographicsForm.addEventListener("submit", handleDemographicsSubmit);

demographicsForm.addEventListener("input", (event) => {
    clearQuestionError(event.target.closest("[data-demographic-question]"));
    formErrorSummary.hidden = true;
});

demographicsForm.addEventListener("change", (event) => {
    clearQuestionError(event.target.closest("[data-demographic-question]"));
    if (event.target === consentCheckbox) {
        clearConsentError();
    }
    formErrorSummary.hidden = true;
});

assessmentForm.addEventListener("submit", handleAssessmentSubmit);

assessmentForm.addEventListener("input", (event) => {
    const questionElement = event.target.closest("[data-assessment-type]");

    if (event.target.matches('input[type="range"]')) {
        event.target.dataset.touched = "true";
        updateConfidenceDisplay(event.target);
    }

    if (questionElement) {
        setAssessmentQuestionError(questionElement, "");
        assessmentErrorSummary.hidden = true;
    }
});

assessmentForm.addEventListener("change", (event) => {
    const questionElement = event.target.closest("[data-assessment-type]");
    if (questionElement) {
        setAssessmentQuestionError(questionElement, "");
        assessmentErrorSummary.hidden = true;
    }
});

assessmentVideo.addEventListener("loadedmetadata", () => {
    if (assessmentVideo.videoWidth && assessmentVideo.videoHeight) {
        assessmentVideo.style.aspectRatio = `${assessmentVideo.videoWidth} / ${assessmentVideo.videoHeight}`;
    }

    assessmentVideo.dataset.failed = "false";
    assessmentVideoStatus.hidden = true;

    if (getAssessmentMode() && assessmentContentReady && !assessmentContent.hidden) {
        assessmentSubmitButton.disabled = false;
    }
});

assessmentVideo.addEventListener("error", () => {
    assessmentVideo.dataset.failed = "true";
    assessmentVideoStatus.hidden = false;
    assessmentSubmitButton.disabled = true;
});

async function loadDemographics() {
    try {
        const response = await fetch("data/demographics.json");
        if (!response.ok) {
            throw new Error("Questionnaire request failed");
        }

        const config = await response.json();
        initialiseDemographics(config);
    } catch {
        setParticipationUnavailable(
            "Questionnaire content could not be loaded. Participation is unavailable.",
            true,
        );
        setConsentContent("");
    }
}

showStage(0, false);
loadDemographics();
loadAssessmentContent();
