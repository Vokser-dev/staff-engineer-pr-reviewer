# Domain Glossary

## Review Domain

| Term                            | Definition                                                                                                                                            | Aliases to avoid                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Pull Request Context**        | The structured representation of a pull request's metadata (title, description, author, branches) and changed files.                                  | PR metadata, diff context        |
| **Review Summary**              | A high-level description of the code review, written in Norwegian, ending with an overall verdict.                                                    | PR comment, summary post         |
| **Inline Comment**              | A comment targeting a specific file and line number in the diff, written in Norwegian, enforcing severity thresholds.                                 | Line comment, thread comment     |
| **Review Host**                 | The platform seam interface that abstracts platform-specific actions like fetching context and publishing reviews.                                    | Adapter seam, host wrapper       |
| **Platform Adapter**            | The concrete implementation of a Review Host for a specific Git hosting service (e.g., GitHub, Azure DevOps).                                         | Entrypoint, orchestrator         |
| **Reviewer Plugin**             | A platform-specific entrypoint implementing the `ReviewerPlugin` interface, facilitating the execution of a review session on a specific host.        | Platform reviewer, plugin        |
| **Path Resolver**               | A utility (such as the Azure `resolveRepoPath` helper) that maps LLM-reported file paths back to the repository's file structure.                     | Path matcher, repo path resolver |
| **Review Session Orchestrator** | The core controller (`runReviewSession`) that executes the review lifecycle: fetching context, requesting the review, and posting summaries/comments. | Orchestrator, session run        |
| **Review Function**             | The functional abstraction callback that invokes the AI review facade, decoupling orchestration from LLM client specifics.                            | Facade callback, AI reviewer     |

## Relationships

- A **Review Host** fetches one **Pull Request Context** per review session.
- A **Review Host** publishes exactly one **Review Summary** for a review session.
- A **Review Host** publishes zero or more **Inline Comments** if inline comment generation is enabled.
- A **Platform Adapter** is orchestrated via a **Reviewer Plugin** that executes a review session using `runReviewSession`.

## Reviewer Plugins

Reviewer Plugins are the platform-specific entrypoints that conform to the `ReviewerPlugin` interface (i.e. expose a `run(): Promise<void>` method).

### Implementations and Usages

#### GitHub Reviewer

- **File path**: `src/reviewers/github.ts`
- **Compiled path**: `dist/reviewers/github.js`
- **Usage**: Automatically run inside GitHub Actions workflows.
- **Command**:
  ```bash
  node -r tsconfig-paths/register dist/reviewers/github.js
  ```
- **Required Inputs (via Environment Variables)**:
  - `INPUT_GITHUB-TOKEN`: Access token for posting comments via GitHub API.
  - `INPUT_ANTHROPIC-API-KEY`: API key for accessing Anthropic's Claude.

#### Azure DevOps Reviewer

- **File path**: `src/reviewers/azure.ts`
- **Compiled path**: `dist/reviewers/azure.js`
- **Usage**: Automatically run in Azure DevOps pipelines or manually from terminal.
- **Command**:
  ```bash
  node -r tsconfig-paths/register dist/reviewers/azure.js
  ```
- **Required Environment Variables**:
  - `AZURE_DEVOPS_ORG`: Azure DevOps organization name.
  - `AZURE_DEVOPS_PROJECT`: Azure DevOps project name.
  - `AZURE_DEVOPS_REPO_ID`: Azure DevOps repository identifier.
  - `AZURE_DEVOPS_PR_ID`: Azure DevOps pull request ID.
  - `AZURE_DEVOPS_PAT`: Azure DevOps Personal Access Token.
  - `ANTHROPIC_API_KEY`: API key for accessing Anthropic's Claude.
