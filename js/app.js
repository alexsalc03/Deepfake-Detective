const stages = [
    {
        id: "welcome",
        screenId: "welcome-screen",
    },
    {
        id: "pre-assessment",
        screenId: "assessment-screen",
        assessmentMode: "pre",
        title: "Round-1",
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
        title: "Round-2",
        nextLabel: "Continue to Submission",
    },
    {
        id: "submission",
        screenId: "submission-screen",
    },
    {
        id: "results",
        screenId: "results-screen",
    },
];

const submissionEndpoint =
    "https://script.google.com/macros/s/AKfycbwdisKpuSpKqWfSp8NrXfl48oPQ3LTxofn6kJzF3KznLjaSqs3GwQFVqQceikYjMsqw2g/exec";
const submissionVerificationAttempts = 3;
const submissionVerificationDelayMilliseconds = 750;
// Apps Script can take several seconds to cold-start and query the sheet.
const submissionVerificationTimeoutMilliseconds = 12000;
const submissionPostTimeoutMilliseconds = 10000;

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
const ageConfirmationCheckbox = document.querySelector(
    "#age-confirmation-checkbox",
);
const ageConfirmationError = document.querySelector(
    "#age-confirmation-error",
);
const formErrorSummary = document.querySelector("#form-error-summary");
const startExperimentButton = document.querySelector("#start-experiment");
const learningConfigStatus = document.querySelector("#learning-config-status");
const learningStageContent = document.querySelector("#learning-stage-content");
const learningModuleProgress = document.querySelector("#learning-module-progress");
const learningModuleProgressTrack = document.querySelector(
    "#learning-module-progress-track",
);
const learningModuleProgressFill = document.querySelector(
    "#learning-module-progress-fill",
);
const learningModuleTitle = document.querySelector("#learning-module-title");
const learningModuleContent = document.querySelector(
    "#learning-module-content",
);
const learningConcepts = document.querySelector("#learning-concepts");
const learningContentHeading = document.querySelector(
    "#learning-content-heading",
);
const learningClues = document.querySelector("#learning-clues");
const learningQuiz = document.querySelector("#learning-quiz");
const learningQuizControls = document.querySelector("#learning-quiz-controls");
const learningQuizError = document.querySelector("#learning-quiz-error");
const learningFeedback = document.querySelector("#learning-feedback");
const learningFeedbackResult = document.querySelector(
    "#learning-feedback-result",
);
const learningCorrectAnswer = document.querySelector(
    "#learning-correct-answer",
);
const learningExplanation = document.querySelector("#learning-explanation");
const learningCheckAnswer = document.querySelector("#learning-check-answer");
const learningContinue = document.querySelector("#learning-continue");
const preCorrect = document.querySelector("#pre-correct");
const preAccuracy = document.querySelector("#pre-accuracy");
const preConfidence = document.querySelector("#pre-confidence");
const postCorrect = document.querySelector("#post-correct");
const postAccuracy = document.querySelector("#post-accuracy");
const postConfidence = document.querySelector("#post-confidence");
const accuracyDifference = document.querySelector("#accuracy-difference");
const confidenceComparison = document.querySelector("#confidence-comparison");
const submissionStatus = document.querySelector("#submission-status");
const submissionScreen = document.querySelector("#submission-screen");
const submissionLoading = document.querySelector("#submission-loading");
const submitResultsButton = document.querySelector("#submit-results");
const viewResultsButton = document.querySelector("#view-results");
const supportedQuestionTypes = new Set([
    "text",
    "number",
    "select",
    "nationality",
    "radio",
    "checkbox",
    "range",
]);

let currentStageIndex = 0;
let introStep = 0;
let demographicsConfig = null;
let nationalityOptions = [];
let formReady = false;
let assessmentQuestionsConfig = null;
let assessmentVideos = [];
let assessmentContentReady = false;
let assessmentSubmitting = false;
let lastAssessmentSubmissionAt = -Infinity;
let learningModules = [];
let learningContentReady = false;
let learningQuizSubmitted = false;
let currentLearningQuestionIndex = 0;
let submissionState = "idle";
let pendingSubmissionParticipantId = null;
let pendingSubmissionBody = null;

const participantSession = {
    participantId: null,
    consentProvided: false,
    demographics: {},
    condition: null,
    videoSets: {
        pre: null,
        post: null,
    },
    selectedVideoIds: {
        pre: [],
        post: [],
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
    learning: {
        completedModuleIds: [],
        selectedQuizAnswers: {},
        isComplete: false,
    },
};

function clearMediaElement(mediaElement) {
    mediaElement.pause();
    mediaElement.removeAttribute("src");
    mediaElement.load();
}

function showStage(stageIndex, moveFocus = true) {
    const previousStage = stages[currentStageIndex];
    if (previousStage?.assessmentMode) {
        clearMediaElement(assessmentVideo);
    }

    let stage = stages[stageIndex];
    if (
        stage?.id === "results" &&
        (submissionState !== "success" || !participantSession.participantId)
    ) {
        stageIndex = stages.findIndex((candidate) => candidate.id === "submission");
        stage = stages[stageIndex];
    }
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

    if (stage.id === "learning") {
        renderLearningStage();
    }

    if (stage.id === "submission") {
        renderSubmissionStage();
    }

    if (stage.id === "results") {
        renderResults();
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

function isQuestionApplicable(question) {
    if (!question.showIf) return true;
    const parent = getQuestionElement(question.showIf.questionId);
    const selected = parent?.querySelector('input:checked, select');
    return question.showIf.values.includes(selected?.value);
}

function updateStartExperimentButtonState() {
    startExperimentButton.disabled =
        !formReady ||
        !consentCheckbox.checked ||
        !ageConfirmationCheckbox.checked;
}

function showIntroStep(step, moveFocus = true) {
    introStep = step;
    document.querySelector("#welcome-introduction").hidden = step !== 0;
    document.querySelector("#welcome-consent").hidden = step !== 0;
    document.querySelector("#questionnaire-section").hidden = step === 0;
    document.querySelector("#intro-back").hidden = step === 0;
    document.querySelector("#intro-progress").textContent = `Step ${step + 1} of 3`;
    startExperimentButton.textContent = step === 2 ? "Start Experiment" : "Continue";
    updateStartExperimentButtonState();
    const heading = document.querySelector("#demographics-heading");
    heading.textContent = step === 2 ? "AI experience and attitudes" : "About you";
    demographicsConfig?.questions.forEach((question) => {
        const section = question.section ?? "demographics";
        const element = getQuestionElement(question.id);
        element.hidden = !isQuestionApplicable(question) || step === 0 ||
            section !== (step === 1 ? "demographics" : "ai");
        const subsection = demographicsQuestions.querySelector(`[data-question-heading="${question.id}"]`);
        if (subsection) subsection.hidden = element.hidden;
        const description = demographicsQuestions.querySelector(`[data-subsection-description="${question.id}"]`);
        if (description) description.hidden = element.hidden;
    });
    formErrorSummary.hidden = true;
    if (moveFocus) {
        (step === 0 ? document.querySelector("#welcome-title") : heading).focus();
    }
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
    ageConfirmationError.hidden = true;
    ageConfirmationCheckbox.removeAttribute("aria-invalid");
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
        input.required = question.type === "radio" && Boolean(question.required);
        if (question.type === "checkbox" && question.exclusiveOption) {
            input.addEventListener("change", () => {
                if (!input.checked) return;
                choices.querySelectorAll("input").forEach((other) => {
                    if (other !== input && (input.value === question.exclusiveOption ||
                        other.value === question.exclusiveOption)) other.checked = false;
                });
            });
        }
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
    if (question.helpText) {
        const help = createElement("p", "question-help", question.helpText);
        legend.after(help);
    }
    return fieldset;
}

function normaliseNationalitySearch(value) {
    return String(value)
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase();
}

function getNationalityMatches(query) {
    const normalisedQuery = normaliseNationalitySearch(query.trim());
    if (!normalisedQuery) {
        return [...nationalityOptions];
    }

    return nationalityOptions
        .filter((option) =>
            normaliseNationalitySearch(option).includes(normalisedQuery),
        )
        .sort((first, second) => {
            const firstStartsWith = normaliseNationalitySearch(first).startsWith(
                normalisedQuery,
            );
            const secondStartsWith = normaliseNationalitySearch(
                second,
            ).startsWith(normalisedQuery);

            if (firstStartsWith !== secondStartsWith) {
                return firstStartsWith ? -1 : 1;
            }
            return first.localeCompare(second, "en");
        });
}

function createNationalityCombobox({
    controlId,
    describedBy,
    required,
}) {
    const wrapper = createElement("div", "nationality-combobox");
    const input = document.createElement("input");
    const listbox = document.createElement("ul");
    let currentOptions = [];
    let activeOptionIndex = -1;

    input.id = controlId;
    input.name = controlId;
    input.type = "text";
    input.className = "text-control nationality-input";
    input.required = required;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-haspopup", "listbox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", `${controlId}-listbox`);
    input.setAttribute("aria-describedby", describedBy);

    listbox.id = `${controlId}-listbox`;
    listbox.className = "nationality-options";
    listbox.setAttribute("role", "listbox");
    listbox.hidden = true;

    function closeSuggestions() {
        listbox.hidden = true;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        activeOptionIndex = -1;
    }

    function setActiveOption(index) {
        const optionElements = [
            ...listbox.querySelectorAll('[role="option"]'),
        ];
        if (!optionElements.length) {
            activeOptionIndex = -1;
            input.removeAttribute("aria-activedescendant");
            return;
        }

        activeOptionIndex = (index + optionElements.length) % optionElements.length;
        optionElements.forEach((option, optionIndex) => {
            const isActive = optionIndex === activeOptionIndex;
            option.classList.toggle("is-active", isActive);
            option.setAttribute("aria-selected", String(isActive));
        });
        input.setAttribute(
            "aria-activedescendant",
            optionElements[activeOptionIndex].id,
        );
        optionElements[activeOptionIndex].scrollIntoView({
            block: "nearest",
        });
    }

    function selectNationality(value) {
        input.value = value;
        input.dataset.selectedNationality = value;
        closeSuggestions();
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function renderSuggestions() {
        currentOptions = getNationalityMatches(input.value);
        activeOptionIndex = -1;
        listbox.replaceChildren();

        currentOptions.forEach((nationality, index) => {
            const option = createElement(
                "li",
                "nationality-option",
                nationality,
            );
            option.id = `${controlId}-option-${index}`;
            option.setAttribute("role", "option");
            option.setAttribute("aria-selected", "false");
            option.addEventListener("pointerdown", (event) => {
                event.preventDefault();
            });
            option.addEventListener("click", () => {
                selectNationality(nationality);
            });
            listbox.append(option);
        });

        if (!currentOptions.length) {
            const empty = createElement(
                "li",
                "nationality-empty",
                "No matching nationalities.",
            );
            empty.setAttribute("role", "status");
            listbox.append(empty);
        }

        listbox.hidden = false;
        input.setAttribute("aria-expanded", "true");
        input.removeAttribute("aria-activedescendant");
    }

    input.addEventListener("focus", () => {
        if (!input.disabled) {
            renderSuggestions();
        }
    });

    input.addEventListener("click", () => {
        if (!input.disabled && listbox.hidden) {
            renderSuggestions();
        }
    });

    input.addEventListener("input", () => {
        renderSuggestions();
    });

    input.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (listbox.hidden) {
                renderSuggestions();
            }
            const count = listbox.querySelectorAll('[role="option"]').length;
            if (!count) return;
            setActiveOption(
                activeOptionIndex === -1
                    ? event.key === "ArrowDown"
                        ? 0
                        : count - 1
                    : activeOptionIndex +
                          (event.key === "ArrowDown" ? 1 : -1),
            );
            return;
        }

        if (event.key === "Enter" && activeOptionIndex >= 0) {
            event.preventDefault();
            selectNationality(currentOptions[activeOptionIndex]);
            return;
        }

        if (event.key === "Escape") {
            closeSuggestions();
        }
    });

    input.addEventListener("blur", closeSuggestions);
    wrapper.append(input, listbox);

    demographicsForm.addEventListener("reset", () => {
        input.value = "";
        delete input.dataset.selectedNationality;
        closeSuggestions();
    });

    return wrapper;
}

function createNationalityQuestion(question) {
    const container = createElement("div", "form-question");
    container.dataset.demographicQuestion = "";
    container.dataset.demographicId = question.id;

    const label = createElement("label", "question-label", question.label);
    label.htmlFor = getQuestionControlId(question.id);

    const help = createElement("p", "question-help", question.helpText);
    help.id = `${getQuestionControlId(question.id)}-help`;

    const error = createElement("p", "field-error");
    error.id = `${getQuestionControlId(question.id)}-error`;
    error.setAttribute("role", "alert");
    error.hidden = true;

    const describedBy = `${help.id} ${error.id}`;
    const control = createNationalityCombobox({
        controlId: getQuestionControlId(question.id),
        describedBy,
        required: Boolean(question.required),
    });
    container.append(label, help, control);
    container.append(error);
    return container;
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

    const error = createElement("p", "field-error");
    error.id = `${control.id}-error`;
    error.setAttribute("role", "alert");
    error.hidden = true;

    const describedBy = [];
    container.append(label);
    if (question.helpText) {
        const help = createElement("p", "question-help", question.helpText);
        help.id = `${control.id}-help`;
        describedBy.push(help.id);
        container.append(help);
    }
    describedBy.push(error.id);
    control.setAttribute("aria-describedby", describedBy.join(" "));
    container.append(control, error);
    return container;
}

function createRangeQuestion(question) {
    const fieldset = createChoiceQuestion({ ...question, type: "radio" });
    fieldset.classList.add("range-question");
    const legend = fieldset.querySelector("legend");
    legend.id = `${getQuestionControlId(question.id)}-label`;
    const range = document.createElement("input");
    range.type = "range";
    range.className = "confidence-range";
    range.min = question.min;
    range.max = question.max;
    range.step = "1";
    range.defaultValue = String(Math.floor((question.min + question.max) / 2));
    range.dataset.touched = "false";
    range.setAttribute("aria-labelledby", legend.id);
    range.setAttribute("aria-describedby", `${getQuestionControlId(question.id)}-error`);
    range.id = `${getQuestionControlId(question.id)}-scale`;
    const labels = createElement("div", "political-scale-labels");
    labels.append(
        createElement("span", "", question.minLabel),
        createElement("span", "", question.maxLabel),
    );
    if (question.midpointLabel) {
        labels.firstElementChild.after(
            createElement("span", "", question.midpointLabel),
        );
    }
    const ticks = createElement("div", "political-scale-ticks");
    ticks.setAttribute("aria-hidden", "true");
    for (let value = question.min; value <= question.max; value++) {
        ticks.append(createElement("span", "", String(value)));
    }
    const scale = createElement("div", "political-scale");
    scale.append(labels, range, ticks);
    range.classList.add("political-scale-input");
    function resetRange() {
        scale.classList.remove("has-alternative");
        range.dataset.touched = "false";
        range.setAttribute("aria-valuetext", "No value selected");
    }
    function selectRange() {
        scale.classList.remove("has-alternative");
        fieldset.querySelectorAll('input[type="radio"]').forEach((radio) => {
            radio.checked = false;
        });
        range.dataset.touched = "true";
        range.setAttribute("aria-valuetext", `${range.value} of ${question.max}, ${question.minLabel} to ${question.maxLabel}`);
        clearQuestionError(fieldset);
        formErrorSummary.hidden = true;
    }
    range.addEventListener("input", selectRange);
    range.addEventListener("pointerup", selectRange);
    fieldset.querySelectorAll('input[type="radio"]').forEach((radio) => {
        radio.required = false;
        radio.addEventListener("change", () => {
            resetRange();
            scale.classList.toggle("has-alternative", radio.checked);
        });
    });
    demographicsForm.addEventListener("reset", resetRange);
    legend.after(scale);
    const error = fieldset.querySelector(".field-error");
    scale.after(error);
    const help = fieldset.querySelector(".question-help");
    if (help) {
        help.id = `${range.id}-help`;
        legend.after(help);
        range.setAttribute("aria-describedby", `${help.id} ${getQuestionControlId(question.id)}-error`);
    }
    resetRange();
    return fieldset;
}

function renderQuestion(question) {
    if (question.type === "range") return createRangeQuestion(question);
    if (question.type === "nationality") {
        return createNationalityQuestion(question);
    }
    return question.type === "radio" || question.type === "checkbox"
        ? createChoiceQuestion(question)
        : createSingleControlQuestion(question);
}

function isConfiguredQuestion(question, questions) {
    const hasValidIdentity =
        question &&
        typeof question.id === "string" &&
        question.id.trim() &&
        typeof question.label === "string" &&
        question.label.trim() &&
        supportedQuestionTypes.has(question.type);
    const needsOptions = ["select", "radio", "checkbox", "range"].includes(question?.type);
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

    const hasValidRange = question?.type !== "range" || (
        Number.isInteger(question.min) && Number.isInteger(question.max) &&
        question.min < question.max &&
        [question.minLabel, question.maxLabel].every(
            (label) => typeof label === "string" && label.trim(),
        )
    );
    const hasValidExclusiveOption = question?.exclusiveOption === undefined || (
        question.type === "checkbox" && hasValidOptions &&
        question.options.includes(question.exclusiveOption)
    );
    const hasValidNationalitySettings =
        question?.type !== "nationality" || nationalityOptions.length > 0;
    let hasValidCondition = question?.showIf === undefined;
    if (isRecord(question?.showIf)) {
        const parent = questions.find((item) => item?.id === question.showIf.questionId);
        hasValidCondition = parent && parent !== question &&
            ["radio", "select"].includes(parent.type) &&
            Array.isArray(parent.options) &&
            Array.isArray(question.showIf.values) && question.showIf.values.length > 0 &&
            question.showIf.values.every((value) => parent.options.includes(value));
    }
    return Boolean(hasValidIdentity && hasValidOptions && hasValidNumberRange &&
        hasValidRange && hasValidExclusiveOption &&
        hasValidNationalitySettings && hasValidCondition);
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function validateLearningConfig(config) {
    if (!Array.isArray(config)) {
        return {
            isValid: false,
            message:
                "Learning content is not validly configured. The learning stage is unavailable until the research team provides a module list.",
        };
    }

    if (config.length === 0) {
        return {
            isValid: false,
            message:
                "Learning content is not configured. The learning stage is unavailable until the research team provides modules.",
        };
    }

    const seenModuleIds = new Set();
    const modules = [];

    for (const module of config) {
        if (
            !isRecord(module) ||
            !isNonEmptyString(module.id) ||
            !isNonEmptyString(module.title) ||
            !["content", "quiz"].includes(module.type) ||
            seenModuleIds.has(module.id.trim())
        ) {
            return {
                isValid: false,
                message:
                    "Learning content is not validly configured. Each module needs a unique ID, supported type, and title.",
            };
        }

        const normalisedModule = {
            id: module.id.trim(),
            type: module.type,
            title: module.title.trim(),
        };

        if (module.type === "content") {
            const clueIds = Array.isArray(module.clues)
                ? module.clues.map((clue) => clue?.id?.trim())
                : [];
            const hasValidClues =
                Array.isArray(module.clues) &&
                module.clues.length > 0 &&
                module.clues.every(
                    (clue) =>
                        isRecord(clue) &&
                        isNonEmptyString(clue.id) &&
                        isNonEmptyString(clue.title) &&
                        isNonEmptyString(clue.text),
                ) &&
                new Set(clueIds).size === clueIds.length;

            if (
                !isNonEmptyString(module.introduction) ||
                !isNonEmptyString(module.contentHeading) ||
                !hasValidClues
            ) {
                return {
                    isValid: false,
                    message:
                        "Learning content is not validly configured. Content modules need an introduction, a heading, and uniquely identified concepts.",
                };
            }

            normalisedModule.introduction = module.introduction.trim();
            normalisedModule.contentHeading = module.contentHeading.trim();
            normalisedModule.clues = module.clues.map((clue) => ({
                id: clue.id.trim(),
                title: clue.title.trim(),
                text: clue.text.trim(),
            }));
        } else {
            const questionIds = Array.isArray(module.questions)
                ? module.questions.map((question) => question?.id?.trim())
                : [];
            const hasValidQuestions =
                Array.isArray(module.questions) &&
                module.questions.length > 0 &&
                module.questions.every((question) => {
                    if (
                        !isRecord(question) ||
                        !isNonEmptyString(question.id) ||
                        !isNonEmptyString(question.question) ||
                        !isNonEmptyString(question.feedback) ||
                        !Array.isArray(question.options) ||
                        question.options.length !== 3
                    ) {
                        return false;
                    }

                    const optionIds = question.options.map((option) =>
                        option?.id?.trim(),
                    );
                    return (
                        question.options.every(
                            (option) =>
                                isRecord(option) &&
                                isNonEmptyString(option.id) &&
                                isNonEmptyString(option.text),
                        ) &&
                        new Set(optionIds).size === optionIds.length &&
                        isNonEmptyString(question.correctOptionId) &&
                        optionIds.includes(question.correctOptionId.trim())
                    );
                }) &&
                new Set(questionIds).size === questionIds.length;

            if (!hasValidQuestions) {
                return {
                    isValid: false,
                    message:
                        "Learning quiz content is not validly configured. Quiz modules need uniquely identified questions with three options, a matching correct answer, and feedback.",
                };
            }

            normalisedModule.questions = module.questions.map((question) => ({
                id: question.id.trim(),
                question: question.question.trim(),
                options: question.options.map((option) => ({
                    id: option.id.trim(),
                    text: option.text.trim(),
                })),
                correctOptionId: question.correctOptionId.trim(),
                feedback: question.feedback.trim(),
            }));
        }

        seenModuleIds.add(normalisedModule.id);
        modules.push(normalisedModule);
    }

    return {
        isValid: true,
        modules,
        message: "",
    };
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
    }

    for (const assignedSet of ["A", "B"]) {
        const videosInSet = config.filter((video) => video.set === assignedSet);
        const realCount = videosInSet.filter(
            (video) => video.label === "real",
        ).length;
        const fakeCount = videosInSet.filter(
            (video) => video.label === "fake",
        ).length;

        if (videosInSet.length !== 4 || realCount !== 2 || fakeCount !== 2) {
            return {
                isValid: false,
                message:
                    "Video content is not validly configured. Assessment sets A and B each require exactly four videos: two real and two fake.",
            };
        }
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
    selectAssessmentVideos();
}

function selectAssessmentVideosForSet(assignedSet) {
    const selected = assessmentVideos.filter(
        (video) => video.set === assignedSet,
    );

    for (let index = selected.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [selected[index], selected[randomIndex]] = [
            selected[randomIndex],
            selected[index],
        ];
    }

    return selected.map((video) => video.id);
}

function selectAssessmentVideos() {
    if (!assessmentContentReady || participantSession.condition === null) {
        return;
    }

    participantSession.selectedVideoIds = {
        pre: selectAssessmentVideosForSet(participantSession.videoSets.pre),
        post: selectAssessmentVideosForSet(participantSession.videoSets.post),
    };
}

function ensureAssessmentVideoSelection() {
    const selectedIds = participantSession.selectedVideoIds;
    const hasCompleteSelection = ["pre", "post"].every(
        (mode) =>
            selectedIds[mode].length === 4 &&
            new Set(selectedIds[mode]).size === 4 &&
            selectedIds[mode].every((videoId) =>
                assessmentVideos.some(
                    (video) =>
                        video.id === videoId &&
                        video.set === participantSession.videoSets[mode],
                ),
            ),
    );

    if (!hasCompleteSelection) {
        selectAssessmentVideos();
    }
}

function setParticipationUnavailable(message, isError = false) {
    formReady = false;
    demographicsConfigStatus.textContent = message;
    demographicsConfigStatus.hidden = false;
    demographicsConfigStatus.classList.toggle("is-error", isError);
    consentCheckbox.disabled = true;
    consentCheckbox.checked = false;
    ageConfirmationCheckbox.disabled = true;
    ageConfirmationCheckbox.checked = false;
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
    ageConfirmationCheckbox.checked = false;

    if (questions === null || !questions.every((question) => isConfiguredQuestion(question, questions))) {
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
        if (question.subsection) {
            const heading = createElement("h4", "question-subsection", question.subsection);
            heading.dataset.questionHeading = question.id;
            demographicsQuestions.append(heading);
        }
        if (question.subsectionDescription) {
            const description = createElement("p", "question-definition", question.subsectionDescription);
            description.dataset.subsectionDescription = question.id;
            demographicsQuestions.append(description);
        }
        demographicsQuestions.append(renderQuestion(question));
    });

    showIntroStep(0, false);
    demographicsConfigStatus.hidden = true;
    formReady = questions.length > 0 && hasConsentStatement;
    consentCheckbox.disabled = !formReady;
    ageConfirmationCheckbox.disabled = !formReady;
    updateStartExperimentButtonState();
}

function validateQuestion(question) {
    const questionElement = getQuestionElement(question.id);

    if (question.type === "nationality") {
        const control = questionElement.querySelector(".nationality-input");
        const selectedValue = control?.dataset.selectedNationality ?? "";
        const rawValue = control?.value.trim() ?? "";

        if (
            !control ||
            rawValue !== selectedValue ||
            (selectedValue && !nationalityOptions.includes(selectedValue))
        ) {
            return {
                valid: false,
                message: "Select a nationality from the list.",
                value: selectedValue,
            };
        }

        if (question.required && !selectedValue) {
            return {
                valid: false,
                message: "Select a nationality from the list.",
                value: "",
            };
        }

        return {
            valid: true,
            message: "",
            value: selectedValue,
        };
    }

    if (question.type === "range") {
        const selected = questionElement.querySelector('input[type="radio"]:checked');
        const range = questionElement.querySelector('input[type="range"]');
        let value = "";
        let valid = !question.required;
        if (selected) {
            value = selected.value;
            valid = question.options.includes(value);
        } else if (range.dataset.touched === "true") {
            value = Number(range.value);
            valid = Number.isInteger(value) && value >= question.min && value <= question.max;
        }
        return {
            valid,
            message: valid ? "" : "Select a position on the scale or choose one of the options below.",
            value,
        };
    }

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

        if (question.exclusiveOption && values.includes(question.exclusiveOption) && values.length > 1) {
            return { valid: false, message: `Choose either “${question.exclusiveOption}” or the other options.`, value: values };
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

function validateDemographics(questions = demographicsConfig.questions) {
    const responses = {};
    let firstInvalidElement = null;

    questions.forEach((question) => {
        if (!isQuestionApplicable(question)) {
            clearQuestionError(getQuestionElement(question.id));
            return;
        }
        const result = validateQuestion(question);
        const questionElement = getQuestionElement(question.id);

        setQuestionError(questionElement, result.message);
        responses[question.id] = result.value;

        if (!result.valid && !firstInvalidElement) {
            firstInvalidElement = questionElement;
        }
    });

    const consentIsValid = consentCheckbox.checked;
    const ageConfirmationIsValid = ageConfirmationCheckbox.checked;
    consentError.hidden = consentIsValid;
    ageConfirmationError.hidden = ageConfirmationIsValid;

    if (consentIsValid) {
        consentCheckbox.removeAttribute("aria-invalid");
    } else {
        consentCheckbox.setAttribute("aria-invalid", "true");
    }

    if (ageConfirmationIsValid) {
        ageConfirmationCheckbox.removeAttribute("aria-invalid");
    } else {
        ageConfirmationCheckbox.setAttribute("aria-invalid", "true");
    }

    return {
        isValid:
            !firstInvalidElement &&
            consentIsValid &&
            ageConfirmationIsValid,
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
    clearMediaElement(assessmentVideo);
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
    selectAssessmentVideos();

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
    ensureAssessmentVideoSelection();

    return participantSession.selectedVideoIds[mode]
        .map((videoId) =>
            assessmentVideos.find((video) => video.id === videoId),
        )
        .filter(Boolean);
}

function getScoredAssessmentResponses(mode) {
    return participantSession.assessmentAnswers
        .filter((response) => response.stage === mode)
        .map((response) => {
            const video = assessmentVideos.find(
                (candidate) => candidate.id === response.videoId,
            );

            if (!video || !["real", "fake"].includes(response.answer)) {
                return null;
            }

            return {
                response,
                correctLabel: video.label,
            };
        })
        .filter(Boolean);
}

function roundPercentage(value) {
    return Math.round(value * 10) / 10;
}

function calculatePerformanceMetrics(mode) {
    const scoredResponses = getScoredAssessmentResponses(mode);
    const correctClassifications = scoredResponses.filter(
        ({ response, correctLabel }) => response.answer === correctLabel,
    ).length;
    const confidenceValues = scoredResponses
        .map(({ response }) => response.confidence)
        .filter(
            (confidence) =>
                Number.isFinite(confidence) && confidence >= 0 && confidence <= 100,
        );

    return {
        correctClassifications,
        totalClassifications: scoredResponses.length,
        accuracyPercent: scoredResponses.length
            ? roundPercentage(
                  (correctClassifications / scoredResponses.length) * 100,
              )
            : null,
        averageConfidencePercent: confidenceValues.length
            ? roundPercentage(
                  confidenceValues.reduce((total, value) => total + value, 0) /
                      confidenceValues.length,
              )
            : null,
    };
}

function calculateExperimentPerformance() {
    const pre = calculatePerformanceMetrics("pre");
    const post = calculatePerformanceMetrics("post");
    const hasAccuracyComparison =
        pre.accuracyPercent !== null && post.accuracyPercent !== null;

    return {
        pre,
        post,
        accuracyDifferencePercentagePoints: hasAccuracyComparison
            ? post.accuracyPercent - pre.accuracyPercent
            : null,
    };
}

function prepareAssessmentResponses(mode) {
    return getScoredAssessmentResponses(mode).map(
        ({ response, correctLabel }) => ({
            videoId: response.videoId,
            correctLabel,
            classification: response.answer,
            confidence: Number.isFinite(response.confidence)
                ? response.confidence
                : null,
            selectedClues: Array.isArray(response.clues)
                ? [...response.clues]
                : [],
        }),
    );
}

function prepareSubmissionPayload() {
    return {
        participantId: participantSession.participantId,
        demographics: { ...participantSession.demographics },
        condition: participantSession.condition,
        videoSets: { ...participantSession.videoSets },
        assessments: {
            pre: {
                responses: prepareAssessmentResponses("pre"),
            },
            post: {
                responses: prepareAssessmentResponses("post"),
            },
        },
        learning: {
            completedModuleIds: [
                ...participantSession.learning.completedModuleIds,
            ],
            quizAnswers: {
                ...participantSession.learning.selectedQuizAnswers,
            },
            isComplete: participantSession.learning.isComplete,
        },
        performance: calculateExperimentPerformance(),
    };
}

function setSubmissionState(state) {
    submissionState = state;
    const isBusy = state === "posting" || state === "verifying";
    submitResultsButton.hidden = state === "success";
    submitResultsButton.disabled = isBusy || state === "success";
    const buttonLabels = {
        posting: "Submitting...",
        verifying: "Verifying Submission...",
        unconfirmed: "Check Submission Again",
    };
    submitResultsButton.textContent = buttonLabels[state] ?? "Submit Results";
    viewResultsButton.hidden = state !== "success";
    viewResultsButton.disabled = state !== "success";
    submissionLoading.hidden = !isBusy;
    submissionScreen.setAttribute(
        "aria-busy",
        isBusy ? "true" : "false",
    );
    if (state === "posting") {
        submissionStatus.textContent = "Submitting your responses...";
    } else if (state === "verifying") {
        submissionStatus.textContent =
            "Checking that your responses were saved...";
    } else if (state === "success") {
        submissionStatus.textContent =
            "Your responses have been saved successfully.";
        viewResultsButton.focus();
    } else if (state === "unconfirmed") {
        submissionStatus.textContent =
            "We couldn't confirm that your responses were saved yet. Check again without resubmitting.";
    } else {
        submissionStatus.textContent = "Your results have not been submitted.";
    }
}

function renderSubmissionStage() {
    setSubmissionState(submissionState);
}

function canAccessResults() {
    return submissionState === "success" && Boolean(participantSession.participantId);
}

function verifyParticipantSaved(
    participantId,
    timeoutMilliseconds = submissionVerificationTimeoutMilliseconds,
) {
    return new Promise((resolve, reject) => {
        const callbackName = `deepfakeDetectiveVerification_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}`;
        const script = document.createElement("script");
        const verificationUrl = new URL(submissionEndpoint);
        let settled = false;
        let timeoutId;

        const cleanup = () => {
            window.clearTimeout(timeoutId);
            script.remove();
            delete window[callbackName];
        };
        const rejectVerification = () => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            reject(new Error("Submission verification failed."));
        };

        window[callbackName] = (result) => {
            if (
                !result ||
                result.participantId !== participantId ||
                result.saved !== true
            ) {
                rejectVerification();
                return;
            }

            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(true);
        };

        verificationUrl.searchParams.set("participantId", participantId);
        verificationUrl.searchParams.set("callback", callbackName);
        script.src = verificationUrl.toString();
        script.async = true;
        script.onerror = rejectVerification;
        timeoutId = window.setTimeout(rejectVerification, timeoutMilliseconds);
        document.head.appendChild(script);
    });
}

function waitForSubmissionVerification() {
    return new Promise((resolve) => {
        window.setTimeout(resolve, submissionVerificationDelayMilliseconds);
    });
}

async function verifySubmissionWithRetries(participantId) {
    let lastError;

    for (let attempt = 0; attempt < submissionVerificationAttempts; attempt += 1) {
        try {
            await verifyParticipantSaved(participantId);
            return true;
        } catch (error) {
            lastError = error;
        }

        if (attempt < submissionVerificationAttempts - 1) {
            await waitForSubmissionVerification();
        }
    }

    throw lastError;
}

async function postSubmission(
    body,
    timeoutMilliseconds = submissionPostTimeoutMilliseconds,
) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
        () => controller.abort(),
        timeoutMilliseconds,
    );

    try {
        await fetch(submissionEndpoint, {
            method: "POST",
            mode: "no-cors",
            headers: {
                "Content-Type": "text/plain;charset=utf-8",
            },
            body,
            signal: controller.signal,
        });
    } finally {
        window.clearTimeout(timeoutId);
    }
}

async function handleResultsSubmission() {
    if (
        submissionState === "posting" ||
        submissionState === "verifying" ||
        submissionState === "success"
    ) {
        return;
    }

    const participantId = participantSession.participantId;
    if (!participantId) {
        submissionStatus.textContent =
            "Your participant ID is unavailable. Please return to Welcome and start again.";
        return;
    }

    if (submissionState === "unconfirmed") {
        if (pendingSubmissionParticipantId !== participantId) {
            resetSubmissionState();
            return;
        }

        await verifyPendingSubmission(participantId);
        return;
    }

    if (submissionState !== "idle") {
        return;
    }

    pendingSubmissionParticipantId = participantId;
    pendingSubmissionBody = JSON.stringify(prepareSubmissionPayload());
    setSubmissionState("posting");

    try {
        await postSubmission(pendingSubmissionBody);
    } catch {
        // Delivery is ambiguous, so verification remains the source of truth.
    }

    if (
        pendingSubmissionParticipantId !== participantId ||
        participantSession.participantId !== participantId
    ) {
        return;
    }

    await verifyPendingSubmission(participantId);
}

async function verifyPendingSubmission(participantId) {
    if (
        pendingSubmissionParticipantId !== participantId ||
        participantSession.participantId !== participantId
    ) {
        return;
    }

    setSubmissionState("verifying");

    try {
        await verifySubmissionWithRetries(participantId);
        if (
            submissionState === "verifying" &&
            pendingSubmissionParticipantId === participantId
        ) {
            setSubmissionState("success");
        }
    } catch {
        if (
            submissionState === "verifying" &&
            pendingSubmissionParticipantId === participantId
        ) {
            setSubmissionState("unconfirmed");
        }
    }
}

function resetSubmissionState() {
    pendingSubmissionParticipantId = null;
    pendingSubmissionBody = null;
    setSubmissionState("idle");
}

function formatPercentage(value) {
    return value === null ? "Not available" : `${value}%`;
}

function formatAccuracyDifference(value) {
    if (value === null) {
        return "Not available";
    }

    const sign = value > 0 ? "+" : "";
    return `${sign}${value} percentage points`;
}

function renderResults() {
    if (!canAccessResults()) {
        showStage(stages.findIndex((stage) => stage.id === "submission"), false);
        return;
    }

    const performance = calculateExperimentPerformance();

    preCorrect.textContent = `${performance.pre.correctClassifications}/${performance.pre.totalClassifications}`;
    preAccuracy.textContent = formatPercentage(performance.pre.accuracyPercent);
    preConfidence.textContent = formatPercentage(
        performance.pre.averageConfidencePercent,
    );
    postCorrect.textContent = `${performance.post.correctClassifications}/${performance.post.totalClassifications}`;
    postAccuracy.textContent = formatPercentage(performance.post.accuracyPercent);
    postConfidence.textContent = formatPercentage(
        performance.post.averageConfidencePercent,
    );
    accuracyDifference.textContent = formatAccuracyDifference(
        performance.accuracyDifferencePercentagePoints,
    );
    confidenceComparison.textContent = `${formatPercentage(
        performance.pre.averageConfidencePercent,
    )} → ${formatPercentage(performance.post.averageConfidencePercent)}`;
}

function clearResultsDisplay() {
    [
        preCorrect,
        preAccuracy,
        preConfidence,
        postCorrect,
        postAccuracy,
        postConfidence,
        accuracyDifference,
        confidenceComparison,
    ].forEach((element) => {
        element.textContent = "—";
    });
}

function resetExperimentSession() {
    Object.assign(participantSession, {
        participantId: null,
        consentProvided: false,
        demographics: {},
        condition: null,
        videoSets: {
            pre: null,
            post: null,
        },
        selectedVideoIds: {
            pre: [],
            post: [],
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
        learning: {
            completedModuleIds: [],
            selectedQuizAnswers: {},
            isComplete: false,
        },
    });

    assessmentSubmitting = false;
    lastAssessmentSubmissionAt = -Infinity;
    learningQuizSubmitted = false;
    currentLearningQuestionIndex = 0;
    demographicsForm.reset();
    showIntroStep(0, false);
    formErrorSummary.hidden = true;
    clearConsentError();
    demographicsQuestions
        .querySelectorAll("[data-demographic-question]")
        .forEach((question) => clearQuestionError(question));
    assessmentErrorSummary.hidden = true;
    clearMediaElement(assessmentVideo);
    resetSubmissionState();
    clearResultsDisplay();
    showStage(0);
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

    clearMediaElement(assessmentVideo);
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

function clearLearningConcepts() {
    learningConcepts.hidden = true;
    learningContentHeading.textContent = "";
    learningClues.replaceChildren();
}

function setLearningUnavailable(message, isError = false) {
    learningContentReady = false;
    learningModules = [];
    learningStageContent.hidden = true;
    learningQuizControls.replaceChildren();
    learningQuiz.hidden = true;
    learningFeedback.hidden = true;
    learningCheckAnswer.hidden = true;
    learningContinue.disabled = true;
    clearLearningConcepts();
    learningConfigStatus.textContent = message;
    learningConfigStatus.hidden = false;
    learningConfigStatus.classList.toggle("is-error", isError);
}

function initialiseLearningContent(config) {
    const validation = validateLearningConfig(config);

    if (!validation.isValid) {
        setLearningUnavailable(validation.message, true);
        return;
    }

    learningModules = validation.modules;
    learningContentReady = true;
    learningConfigStatus.hidden = true;
    learningConfigStatus.classList.remove("is-error");

    if (stages[currentStageIndex].id === "learning") {
        renderLearningStage();
    }
}

async function loadLearningContent() {
    try {
        const response = await fetch("data/lessons.json");
        if (!response.ok) {
            throw new Error("Learning content request failed");
        }

        const config = await response.json();
        initialiseLearningContent(config);
    } catch {
        setLearningUnavailable(
            "Learning content could not be loaded. The learning stage is unavailable until the content file can be read.",
            true,
        );
    }
}

function getCurrentLearningModuleIndex() {
    const firstIncompleteIndex = learningModules.findIndex(
        (module) =>
            !participantSession.learning.completedModuleIds.includes(module.id),
    );

    return firstIncompleteIndex === -1
        ? learningModules.length - 1
        : firstIncompleteIndex;
}

function renderLearningConcepts(module) {
    clearLearningConcepts();

    if (module.type !== "content") {
        return;
    }

    learningContentHeading.textContent = module.contentHeading;
    learningConcepts.hidden = false;
    learningClues.replaceChildren(
        ...module.clues.map((clue, index) => {
            const concept = createElement("article", "learning-clue");
            const number = createElement(
                "p",
                "learning-clue-number",
                String(index + 1).padStart(2, "0"),
            );
            const content = createElement("div", "learning-clue-content");
            content.append(
                createElement("h5", "learning-clue-title", clue.title),
                createElement("p", "", clue.text),
            );
            concept.append(number, content);
            return concept;
        }),
    );
}

function getCurrentQuizQuestionIndex(module) {
    const firstUnansweredIndex = module.questions.findIndex(
        (question) =>
            !Object.prototype.hasOwnProperty.call(
                participantSession.learning.selectedQuizAnswers,
                question.id,
            ),
    );

    return firstUnansweredIndex === -1
        ? module.questions.length - 1
        : firstUnansweredIndex;
}

function renderLearningFeedback(question, selectedAnswer, moveFocus = false) {
    const correctOption = question.options.find(
        (option) => option.id === question.correctOptionId,
    );
    const isCorrect = selectedAnswer === question.correctOptionId;

    learningFeedbackResult.textContent = isCorrect ? "Correct" : "Incorrect";
    learningCorrectAnswer.textContent = `Correct answer: ${correctOption.text}`;
    learningExplanation.textContent = question.feedback;
    learningFeedback.classList.toggle("is-incorrect", !isCorrect);
    learningFeedback.hidden = false;

    if (moveFocus) {
        learningFeedback.focus();
    }
}

function renderLearningQuiz(module, moduleIndex) {
    learningQuizControls.replaceChildren();
    learningQuizError.hidden = true;
    learningFeedback.hidden = true;
    learningCheckAnswer.hidden = true;
    learningQuizSubmitted = false;

    if (module.type !== "quiz") {
        learningQuiz.hidden = true;
        learningContinue.disabled = false;
        return;
    }

    learningQuiz.hidden = false;
    currentLearningQuestionIndex = getCurrentQuizQuestionIndex(module);
    const question = module.questions[currentLearningQuestionIndex];
    const selectedAnswer =
        participantSession.learning.selectedQuizAnswers[question.id];
    const hasSubmittedAnswer =
        typeof selectedAnswer === "string" &&
        question.options.some((option) => option.id === selectedAnswer);
    const questionProgress = createElement(
        "p",
        "learning-question-progress",
        `Question ${currentLearningQuestionIndex + 1} of ${module.questions.length}`,
    );
    questionProgress.id = "learning-question-progress";
    const fieldset = createElement("fieldset", "learning-question");
    const legend = createElement(
        "legend",
        "",
        question.question,
    );
    const choices = createElement("div", "choice-list");

    fieldset.setAttribute(
        "aria-describedby",
        "learning-quiz-error learning-feedback",
    );

    question.options.forEach((option, optionIndex) => {
        const input = document.createElement("input");
        const label = createElement("label", "choice-option");

        input.id = `learning-quiz-${moduleIndex}-${currentLearningQuestionIndex}-${optionIndex}`;
        input.name = "learning-quiz-answer";
        input.type = "radio";
        input.value = option.id;
        input.required = true;
        input.checked = hasSubmittedAnswer && option.id === selectedAnswer;
        input.disabled = hasSubmittedAnswer;
        input.setAttribute(
            "aria-describedby",
            "learning-quiz-error learning-feedback",
        );

        label.htmlFor = input.id;
        label.append(input, createElement("span", "", option.text));
        choices.append(label);
    });

    fieldset.append(legend, choices);
    learningQuizControls.append(questionProgress, fieldset);
    learningQuizSubmitted = hasSubmittedAnswer;
    learningCheckAnswer.hidden = hasSubmittedAnswer;
    learningCheckAnswer.disabled = true;
    learningContinue.disabled = !hasSubmittedAnswer;

    if (hasSubmittedAnswer) {
        renderLearningFeedback(question, selectedAnswer);
    }
}

function renderLearningStage(moveFocus = false) {
    if (!learningContentReady) {
        learningStageContent.hidden = true;
        return;
    }

    if (!participantSession.participantId) {
        learningStageContent.hidden = true;
        learningConfigStatus.textContent =
            "The learning session has not started. Complete the welcome stage before continuing.";
        learningConfigStatus.hidden = false;
        learningConfigStatus.classList.add("is-error");
        return;
    }

    const moduleIndex = getCurrentLearningModuleIndex();
    const module = learningModules[moduleIndex];

    if (!module) {
        setLearningUnavailable(
            "Learning content is not configured. The learning stage is unavailable until the research team provides modules.",
            true,
        );
        return;
    }

    learningConfigStatus.hidden = true;
    learningConfigStatus.classList.remove("is-error");
    learningStageContent.hidden = false;

    learningModuleProgress.textContent = `Module ${moduleIndex + 1} of ${learningModules.length}`;
    learningModuleProgressTrack.setAttribute(
        "aria-valuemax",
        String(learningModules.length),
    );
    learningModuleProgressTrack.setAttribute(
        "aria-valuenow",
        String(moduleIndex + 1),
    );
    learningModuleProgressTrack.setAttribute(
        "aria-valuetext",
        `Module ${moduleIndex + 1} of ${learningModules.length}`,
    );
    learningModuleProgressFill.style.width = `${
        ((moduleIndex + 1) / learningModules.length) * 100
    }%`;

    learningModuleTitle.textContent = module.title;
    learningModuleContent.replaceChildren();
    if (module.type === "content") {
        learningModuleContent.append(
            createElement("p", "", module.introduction),
        );
    }
    renderLearningConcepts(module);
    renderLearningQuiz(module, moduleIndex);

    learningContinue.textContent =
        moduleIndex === learningModules.length - 1
            ? "Continue to Round-2"
            : "Continue";

    if (moveFocus) {
        learningModuleTitle.focus();
    }
}

function handleLearningCheckAnswer() {
    const module = learningModules[getCurrentLearningModuleIndex()];
    const question = module?.questions?.[currentLearningQuestionIndex];

    if (
        !learningContentReady ||
        stages[currentStageIndex].id !== "learning" ||
        module?.type !== "quiz" ||
        !question ||
        learningQuizSubmitted
    ) {
        return;
    }

    const fieldset = learningQuizControls.querySelector(
        ".learning-question",
    );
    const selectedInput = learningQuizControls.querySelector(
        'input[name="learning-quiz-answer"]:checked',
    );

    if (!selectedInput) {
        learningQuizError.hidden = false;
        fieldset.setAttribute("aria-invalid", "true");
        fieldset.querySelectorAll("input").forEach((input) => {
            input.setAttribute("aria-invalid", "true");
        });
        fieldset.querySelector("input").focus();
        return;
    }

    participantSession.learning.selectedQuizAnswers[question.id] =
        selectedInput.value;
    learningQuizSubmitted = true;
    learningQuizError.hidden = true;
    fieldset.removeAttribute("aria-invalid");
    fieldset.querySelectorAll("input").forEach((input) => {
        input.removeAttribute("aria-invalid");
        input.disabled = true;
    });
    learningCheckAnswer.hidden = true;
    learningContinue.disabled = false;
    renderLearningFeedback(question, selectedInput.value, true);
}

function handleLearningContinue() {
    if (
        !learningContentReady ||
        stages[currentStageIndex].id !== "learning"
    ) {
        return;
    }

    const module = learningModules[getCurrentLearningModuleIndex()];
    const hasAnsweredCurrentQuestion =
        module?.type !== "quiz" ||
        Object.prototype.hasOwnProperty.call(
            participantSession.learning.selectedQuizAnswers,
            module.questions[currentLearningQuestionIndex]?.id,
        );

    if (!module || !hasAnsweredCurrentQuestion) {
        return;
    }

    if (
        module.type === "quiz" &&
        currentLearningQuestionIndex < module.questions.length - 1
    ) {
        renderLearningStage(true);
        return;
    }

    if (
        !participantSession.learning.completedModuleIds.includes(module.id)
    ) {
        participantSession.learning.completedModuleIds.push(module.id);
    }

    const allModulesCompleted = learningModules.every((learningModule) =>
        participantSession.learning.completedModuleIds.includes(
            learningModule.id,
        ),
    );

    const allQuizQuestionsAnswered = learningModules
        .filter((learningModule) => learningModule.type === "quiz")
        .every((learningModule) =>
            learningModule.questions.every((question) =>
                Object.prototype.hasOwnProperty.call(
                    participantSession.learning.selectedQuizAnswers,
                    question.id,
                ),
            ),
        );

    participantSession.learning.isComplete =
        allModulesCompleted && allQuizQuestionsAnswered;

    if (participantSession.learning.isComplete) {
        showStage(currentStageIndex + 1);
        return;
    }

    renderLearningStage(true);
}

function generateParticipantId() {
    return crypto.randomUUID();
}

function handleDemographicsSubmit(event) {
    event.preventDefault();

    if (!formReady || !demographicsConfig) {
        formErrorSummary.textContent =
            "Participation is unavailable until the questionnaire is fully configured.";
        formErrorSummary.hidden = false;
        return;
    }

    const questions = introStep === 0 ? [] : demographicsConfig.questions.filter(
        (question) => (question.section ?? "demographics") ===
            (introStep === 1 ? "demographics" : "ai"),
    );
    const validation = validateDemographics(questions);
    if (!validation.isValid) {
        formErrorSummary.textContent =
            "Please correct the highlighted fields and confirm the consent requirements before continuing.";
        formErrorSummary.hidden = false;

        const focusTarget =
            validation.firstInvalidElement?.querySelector("input, select") ??
            (!consentCheckbox.checked
                ? consentCheckbox
                : ageConfirmationCheckbox);
        focusTarget.focus();
        return;
    }

    if (introStep < 2) {
        showIntroStep(introStep + 1);
        return;
    }

    const completeValidation = validateDemographics();
    if (!completeValidation.isValid) {
        const question = demographicsConfig.questions.find(
            (item) => getQuestionElement(item.id) === completeValidation.firstInvalidElement,
        );
        showIntroStep(
            !consentCheckbox.checked || !ageConfirmationCheckbox.checked
                ? 0
                : question?.section === "ai"
                  ? 2
                  : 1,
        );
        formErrorSummary.textContent = "Please complete the highlighted fields before continuing.";
        formErrorSummary.hidden = false;
        (
            completeValidation.firstInvalidElement?.querySelector(
                "input, select",
            ) ??
            (!consentCheckbox.checked
                ? consentCheckbox
                : ageConfirmationCheckbox)
        ).focus();
        return;
    }
    if (!participantSession.participantId) {
        participantSession.participantId = generateParticipantId();
        assignParticipantCondition();
    }
    participantSession.consentProvided = true;
    participantSession.demographics = completeValidation.responses;
    formErrorSummary.hidden = true;
    showStage(1);
}

document.addEventListener("click", (event) => {
    const previousButton = event.target.closest("[data-previous-stage]");

    if (previousButton && currentStageIndex > 0) {
        showStage(currentStageIndex - 1);
    }
});

document.querySelector("#intro-back").addEventListener("click", () => {
    showIntroStep(Math.max(0, introStep - 1));
});

demographicsForm.addEventListener("submit", handleDemographicsSubmit);

demographicsForm.addEventListener("input", (event) => {
    clearQuestionError(event.target.closest("[data-demographic-question]"));
    formErrorSummary.hidden = true;
});

demographicsForm.addEventListener("change", (event) => {
    if (event.target.closest("[data-demographic-question]")) {
        showIntroStep(introStep, false);
    }
    clearQuestionError(event.target.closest("[data-demographic-question]"));
    if (
        event.target === consentCheckbox ||
        event.target === ageConfirmationCheckbox
    ) {
        clearConsentError();
        updateStartExperimentButtonState();
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

learningCheckAnswer.addEventListener("click", handleLearningCheckAnswer);
learningContinue.addEventListener("click", handleLearningContinue);
submitResultsButton.addEventListener("click", handleResultsSubmission);
viewResultsButton.addEventListener("click", () => {
    if (!canAccessResults()) {
        renderSubmissionStage();
        return;
    }

    showStage(stages.findIndex((stage) => stage.id === "results"));
});
learningQuizControls.addEventListener("change", (event) => {
    if (!event.target.matches('input[name="learning-quiz-answer"]')) {
        return;
    }

    const fieldset = event.target.closest(".learning-question");
    learningQuizError.hidden = true;
    fieldset.removeAttribute("aria-invalid");
    fieldset.querySelectorAll("input").forEach((input) => {
        input.removeAttribute("aria-invalid");
    });
    learningCheckAnswer.disabled = false;
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
        const [questionnaireResponse, nationalityResponse] = await Promise.all([
            fetch("data/pre-questionnaire.json"),
            fetch("data/nationalities.json"),
        ]);
        if (!questionnaireResponse.ok || !nationalityResponse.ok) {
            throw new Error("Questionnaire request failed");
        }

        const [config, options] = await Promise.all([
            questionnaireResponse.json(),
            nationalityResponse.json(),
        ]);
        if (
            !Array.isArray(options) ||
            !options.length ||
            !options.every(
                (option) => typeof option === "string" && option.trim(),
            ) ||
            new Set(options).size !== options.length
        ) {
            throw new Error("Nationality list is invalid");
        }
        nationalityOptions = options;
        initialiseDemographics(config);
    } catch {
        setParticipationUnavailable(
            "Questionnaire content could not be loaded. Participation is unavailable.",
            true,
        );
        setConsentContent("");
    }
}

resetSubmissionState();
showStage(0, false);
loadDemographics();
loadAssessmentContent();
loadLearningContent();
