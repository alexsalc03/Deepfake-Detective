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

let currentStageIndex = 0;

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

showStage(0, false);
