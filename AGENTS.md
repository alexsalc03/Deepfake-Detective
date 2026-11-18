# Deepfake Detective — Agent Instructions

## Project Overview

Deepfake Detective is a lightweight web application developed for the University of Zurich course "The Effects of AI on Individuals and Society".

The project investigates whether a short interactive educational intervention can improve people's ability to recognize political deepfakes.

The application supports five stages:

1. Welcome and demographic data collection
2. Pre-assessment
3. Interactive learning
4. Post-assessment
5. Results and data export

The application must run locally and be maintained through GitHub.

## Technology Stack

Use only:

- HTML5
- CSS3
- Vanilla JavaScript
- JSON for configurable content
- Browser localStorage for temporary experiment data
- CSV for exporting participant results

Do not introduce:

- Frontend frameworks
- Backend services
- Databases
- External dependencies
- Build tools
- Authentication systems

Any exception must be explicitly approved before implementation.

## Core Development Principles

### 1. Keep It Simple

Always prefer the simplest solution that satisfies the requirements.

Avoid premature optimization, unnecessary abstractions, overengineering, and speculative features.

Do not introduce additional complexity without a concrete justification.

### 2. Follow the Defined Scope

Implement only what is explicitly requested.

Do not add features, dependencies, files, or architectural layers unless they are necessary for the assigned task.

If something is unclear, explain the uncertainty rather than making major architectural assumptions.

### 3. Separate Content from Logic

Research content must remain separate from application logic.

Use JSON files to configure:

- Demographic questions
- Assessment questions
- Video metadata
- Educational modules

The application must be able to load new content without requiring changes to its core logic.

Do not invent research questions, educational materials, or video content.

These materials will be provided by other team members.

### 4. Maintain Readable Code

Write clear, readable, and maintainable code.

Prefer:

- Descriptive variable and function names
- Small functions with clear responsibilities
- Straightforward control flow
- Minimal comments explaining non-obvious decisions

Avoid unnecessary design patterns and abstractions.

### 5. Develop Incrementally

Work on one task at a time.

Before implementing changes:

1. Understand the requested task.
2. Inspect the relevant existing files.
3. Identify the minimum necessary modifications.

After implementing changes:

1. Verify that the requested functionality works.
2. Check for regressions in related functionality.
3. Summarize the changes.
4. Report any limitations or unresolved issues.

Do not automatically proceed to the next development phase.

### 6. Data Handling

Participant data must be treated carefully.

- Collect only data required by the experiment.
- Associate responses with participant identifiers.
- Avoid collecting directly identifying information unless explicitly required.
- Do not include actual participant responses in Git commits.
- Keep research data separate from application source code.

### 7. Git Workflow

- Keep changes focused on the current task.
- Do not commit or push automatically.
- Do not modify unrelated files.
- Use clear commit messages when requested.
- Update the README when setup instructions or documented functionality change.

## Project Priorities

When choosing between alternative implementations, prioritize:

1. Correct functionality
2. Simplicity
3. Maintainability
4. Reproducibility
5. User experience
6. Visual polish

The application is a university research prototype, not a production platform.

## Important Rule

Do not implement additional features or introduce new technologies without explaining why they are necessary and obtaining approval.


## UI/UX Design

The application follows a clean, minimalist, Apple-inspired design language.

All new UI components must remain visually consistent with the existing implementation.
Design Principles

    Prioritize usability, simplicity, and visual consistency.

    Use a restrained, professional design appropriate for a university research application.

    Avoid generic AI-generated layouts, marketing-style interfaces, and unnecessary visual decoration.

    Maintain balanced proportions and comfortable spacing.

    Prefer a compact, functional interface over oversized elements and excessive whitespace.

    Preserve the established design system rather than introducing new visual styles.

Colors

    Primary accent: #1976D2 (blue).

    Primary text: #1D1D1F.

    Secondary text: #52525B.

    Background: white or subtle neutral tones such as #FAFAFA.

    Borders: subtle neutral gray, approximately #E5E5E7.

Use CSS variables for shared colors.

Use blue sparingly for interactive elements and selected states.

Do not introduce:

    Green or teal accents.

    Gradients.

    Neon colors.

    Additional accent colors without justification.

Ensure WCAG AA text contrast.
Typography

    Use one consistent system font family throughout the application.

    Do not introduce external fonts or decorative typefaces.

    Establish hierarchy through font size, weight, and spacing.

    Avoid oversized headings.

    Use readable body text and comfortable line heights.

    Keep text blocks at a reasonable reading width.

    Use tabular numbers for numerical results and metrics.

Layout and Spacing

    Prefer open layouts with clear visual hierarchy.

    Avoid excessive card containers, borders, and shadows.

    Use whitespace and subtle separators to organize content.

    Follow a consistent spacing scale based on 8px increments.

    Avoid excessive vertical scrolling when practical.

    Use small, consistent border radii.

    Keep forms and assessment controls compact and easy to scan.

Components

    Reuse existing button, input, and layout styles.

    Maintain consistent hover, focus, active, disabled, and error states.

    Keep buttons and labels concise and action-oriented.

    Avoid decorative icons, emojis, and unnecessary visual elements.

    Use native HTML controls where appropriate.

    Do not introduce UI libraries unless explicitly approved.

Accessibility and Responsiveness

    Use semantic HTML.

    Maintain keyboard accessibility.

    Provide visible focus indicators.

    Ensure sufficient text contrast.

    Use accessible labels and validation messages.

    Maintain comfortable touch targets.

    Prevent horizontal overflow.

    Verify layouts at desktop and mobile widths.

Research-Specific UI Requirements

The interface must not unintentionally influence participant decisions.

    Keep authentic and AI-generated classification options visually neutral and equally prominent.

    Do not reveal correct answers before the appropriate stage.

    Avoid visual cues that could bias participant responses.

    Maintain consistent assessment layouts between pre-test and post-test.

    Prioritize video visibility and question readability.

Design Workflow

For tasks involving significant UI design or visual refinement:

    Use the frontend-design skill when available.

    Inspect existing styles and components before creating new ones.

    Reuse the established design system.

    Make only changes necessary for the requested feature.

    Inspect the rendered interface at desktop and mobile widths when possible.

    Verify that changes do not introduce visual inconsistencies or regressions.

Do not redesign existing screens unless explicitly requested.Existing design tokens and CSS variables take precedence over the example color values above. Do not change established visual styles unless explicitly requested.
