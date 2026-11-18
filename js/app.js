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
const assessmentClues = document.querySelector("[data-assessment-clues]");
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

const participantSession = {
    participantId: null,
    consentProvided: false,
    demographics: {},
};

function showStage(stageIndex, moveFocus = true) {
    const stage = stages[stageIndex];
    const activeScreen = document.querySelector(`#${stage.screenId}`);

    currentStageIndex = stageIndex;
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
        assessmentClues.hidden = stage.assessmentMode !== "post";
        assessmentNextLabel.textContent = stage.nextLabel;
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
    formErrorSummary.hidden = true;
    showStage(1);
}

document.addEventListener("click", (event) => {
    const nextButton = event.target.closest("[data-next-stage]");
    const previousButton = event.target.closest("[data-previous-stage]");

    if (nextButton && currentStageIndex < stages.length - 1) {
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
