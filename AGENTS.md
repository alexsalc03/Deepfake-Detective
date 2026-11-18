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

For UI design and visual refinement tasks, use the
frontend-design skill when available.

Prioritize balanced proportions, usability, visual hierarchy,
and compact, comfortable layouts.

Avoid oversized typography, excessive whitespace,
generic dashboard layouts, and unnecessary cards.

Evaluate the rendered interface visually whenever possible.

The application should feel like a polished, human-centered
research product rather than a marketing website.

Visual design improvements must not introduce new frameworks
or dependencies.
