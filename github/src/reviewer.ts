import * as core from "@actions/core";
import * as github from "@actions/github";
import Anthropic from "@anthropic-ai/sdk";
import {
	formatInlineCommentBody,
	PullRequestContext,
	PullRequestFile,
	ReviewComment,
	runReview,
	splitReviewResponse,
} from "../../shared/prompt";

type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

interface PullRequestData {
	context: PullRequestContext;
	headSha: string;
}

async function getPullRequestContext(
	octokit: ReturnType<typeof github.getOctokit>,
	owner: string,
	repo: string,
	pullNumber: number,
): Promise<PullRequestData> {
	const { data: pr } = await octokit.rest.pulls.get({
		owner,
		repo,
		pull_number: pullNumber,
	});

	const { data: rawFiles } = await octokit.rest.pulls.listFiles({
		owner,
		repo,
		pull_number: pullNumber,
		per_page: 100,
	});

	const files: PullRequestFile[] = rawFiles.map((f) => ({
		filename: f.filename,
		status: f.status,
		additions: f.additions,
		deletions: f.deletions,
		patch: f.patch,
	}));

	return {
		context: {
			title: pr.title,
			description: pr.body ?? "",
			author: pr.user?.login ?? "unknown",
			baseBranch: pr.base.ref,
			headBranch: pr.head.ref,
			files,
		},
		headSha: pr.head.sha,
	};
}

/** Returns the set of line numbers (in the new file) that GitHub will accept
 *  as inline review comment anchors on the RIGHT side. These are added (`+`)
 *  lines from the unified diff. Context lines are also valid anchors but Claude
 *  is instructed to only comment on changed lines, so we limit to additions. */
function extractAddedLines(patch: string | undefined): Set<number> {
	const lines = new Set<number>();
	if (!patch) return lines;

	let newLineNum = 0;
	for (const raw of patch.split("\n")) {
		const hunk = raw.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
		if (hunk) {
			newLineNum = parseInt(hunk[1], 10);
			continue;
		}
		if (raw.startsWith("+++") || raw.startsWith("---")) continue;
		if (raw.startsWith("\\")) continue;

		if (raw.startsWith("+")) {
			lines.add(newLineNum);
			newLineNum++;
		} else if (raw.startsWith(" ")) {
			newLineNum++;
		}
	}
	return lines;
}

function buildAddedLinesIndex(
	files: PullRequestFile[],
): Map<string, Set<number>> {
	const index = new Map<string, Set<number>>();
	for (const file of files) {
		index.set(file.filename, extractAddedLines(file.patch));
	}
	return index;
}

function filterInlineComments(
	comments: ReviewComment[],
	index: Map<string, Set<number>>,
): ReviewComment[] {
	const kept: ReviewComment[] = [];
	for (const c of comments) {
		if (c.line == null) {
			core.warning(
				`Skipping inline comment on ${c.filename}: missing line number`,
			);
			continue;
		}
		const validLines = index.get(c.filename);
		if (!validLines) {
			core.warning(
				`Skipping inline comment: file "${c.filename}" not in PR diff`,
			);
			continue;
		}
		if (!validLines.has(c.line)) {
			core.warning(
				`Skipping inline comment on ${c.filename}:${c.line} (line not in diff)`,
			);
			continue;
		}
		kept.push(c);
	}
	return kept;
}

function verdictToEvent(
	verdict: "approve" | "comment" | "request-changes" | undefined,
): ReviewEvent {
	switch (verdict) {
		case "approve":
			return "APPROVE";
		case "request-changes":
			return "REQUEST_CHANGES";
		case "comment":
		default:
			return "COMMENT";
	}
}

async function postReview(
	octokit: ReturnType<typeof github.getOctokit>,
	owner: string,
	repo: string,
	pullNumber: number,
	commitId: string,
	body: string,
	event: ReviewEvent,
	inlineComments: ReviewComment[],
): Promise<void> {
	const reviewComments = inlineComments
		.filter((c) => c.line != null)
		.map((c) => ({
			path: c.filename,
			line: c.line as number,
			side: "RIGHT" as const,
			body: formatInlineCommentBody(c),
		}));

	await octokit.rest.pulls.createReview({
		owner,
		repo,
		pull_number: pullNumber,
		commit_id: commitId,
		body,
		event,
		comments: reviewComments,
	});
}

async function postFallbackComment(
	octokit: ReturnType<typeof github.getOctokit>,
	owner: string,
	repo: string,
	pullNumber: number,
	body: string,
): Promise<void> {
	await octokit.rest.issues.createComment({
		owner,
		repo,
		issue_number: pullNumber,
		body,
	});
}

async function run(): Promise<void> {
	const token = core.getInput("github-token", { required: true });
	const anthropicApiKey = core.getInput("anthropic-api-key", {
		required: true,
	});

	const octokit = github.getOctokit(token);
	const context = github.context;

	if (context.eventName !== "pull_request") {
		core.setFailed("This action only runs on pull_request events.");
		return;
	}

	const pullNumber = context.payload.pull_request?.number;
	if (!pullNumber) {
		core.setFailed("Could not determine pull request number.");
		return;
	}

	const { owner, repo } = context.repo;

	core.info(`Reviewing PR #${pullNumber} in ${owner}/${repo}`);

	const anthropic = new Anthropic({ apiKey: anthropicApiKey });

	const { context: prContext, headSha } = await getPullRequestContext(
		octokit,
		owner,
		repo,
		pullNumber,
	);

	core.info(
		`PR has ${prContext.files.length} changed file(s). Sending to Claude...`,
	);

	const reviewText = await runReview(anthropic, prContext, {
		requestInlineComments: true,
	});

	const { markdown, inlineComments, overallVerdict } =
		splitReviewResponse(reviewText);

	if (overallVerdict === undefined) {
		core.warning(
			"Could not parse overallVerdict from Claude's response (missing or invalid JSON block). Defaulting review event to COMMENT.",
		);
	}

	const linesIndex = buildAddedLinesIndex(prContext.files);
	const filteredComments = filterInlineComments(inlineComments, linesIndex);
	const event = verdictToEvent(overallVerdict);

	core.info(
		`Posting review (event=${event}) with ${filteredComments.length} inline comment(s) (${inlineComments.length} requested).`,
	);

	try {
		await postReview(
			octokit,
			owner,
			repo,
			pullNumber,
			headSha,
			markdown,
			event,
			filteredComments,
		);
		core.info("Review posted successfully.");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		core.warning(
			`Failed to create formal review (${message}). Falling back to flat comment.`,
		);
		await postFallbackComment(octokit, owner, repo, pullNumber, markdown);
		core.info("Fallback comment posted.");
	}

	core.setOutput("review", reviewText);
}

run().catch((err: Error) => {
	core.setFailed(err.message);
});
