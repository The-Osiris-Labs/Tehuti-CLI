"""Planning module for Tehuti project planning and execution."""

TEMPLATES = {
    "PROJECT": """# Project: {title}

<metadata>
  <name>{title}</name>
  <created>{created}</created>
  <status>{status}</status>
</metadata>

## Vision
{vision}

## Goals
{goals}

## Success Criteria
{success_criteria}

## Tech Stack
{tech_stack}

## Constraints & Scope
{constraints}

## Known Risks
{risks}
""",
    "REQUIREMENTS": """# Requirements for {project_title}

<metadata>
  <project>{project_title}</project>
  <created>{created}</created>
  <phase_count>{phase_count}</phase_count>
</metadata>

## Functional Requirements
{functional_requirements}

## Non-Functional Requirements
{non_functional_requirements}

## Dependencies & Integrations
{dependencies}

## Edge Cases & Assumptions
{edge_cases}
""",
    "ROADMAP": """# Roadmap for {project_title}

<metadata>
  <project>{project_title}</project>
  <created>{created}</created>
  <phase_count>{phase_count}</phase_count>
</metadata>

## Phase Overview
{phase_overview}

## Phases

{phases}

## Timeline & Milestones
{milestones}

## Resource Allocation
{resources}

## Risk Mitigation
{risk_mitigation}
""",
    "PHASE_PLAN": """# Plan for {phase_name}

<metadata>
  <project>{project_title}</project>
  <phase>{phase_number}</phase>
  <created>{created}</created>
  <status>{status}</status>
</metadata>

## Phase Goal
{goal}

## Research & Analysis
{research}

## Task Breakdown

{tasks}

## Task Dependencies
{dependencies}

## Verification Steps
{verification}

## Rollback Plan
{rollback}
""",
    "STATE": """# State for {project_title}

<metadata>
  <project>{project_title}</project>
  <updated>{updated}</updated>
  <status>{status}</status>
</metadata>

## Current Phase
{current_phase}

## Completed Phases
{completed_phases}

## Blocker Log
{blockers}

## Decision Log
{decisions}

## Session Notes
{notes}
""",
}
