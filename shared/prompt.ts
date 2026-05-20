import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-4-7" as const;

export const MAX_TOKENS = 8192;

export interface PullRequestFile {
	filename: string;
	status: "added" | "modified" | "removed" | "renamed" | string;
	additions: number;
	deletions: number;
	patch?: string;
}

export interface PullRequestContext {
	title: string;
	description: string;
	author: string;
	baseBranch: string;
	headBranch: string;
	files: PullRequestFile[];
}

export interface ReviewResult {
	summary: string;
	comments: ReviewComment[];
	overallVerdict: "approve" | "request-changes" | "comment";
}

export interface ReviewComment {
	filename: string;
	line?: number;
	body: string;
	severity: "critical" | "major" | "minor" | "nit";
}

export const STAFF_ENGINEER_SYSTEM_PROMPT = `Du er en erfaren utvikler som gjennomgår en pull request. Jobben din er å hjelpe utvikleren med å levere trygt — ikke å finne alle mulige feil.

**Språk:** Skriv hele reviewen på **norsk (bokmål)**. Behold kodenavn, filnavn og API-navn i sin opprinnelige form.

**Omfang (strengt):**
- Gjennomgå **kun endrede eller nye linjer** i diffene som er gitt. Ikke kommenter på uendrede kontekstlinjer, nærliggende filer, eller eksisterende problemer som PR-en ikke berørte.
- Hvis noe er utenfor diffen eller ikke relatert til hva PR-en prøver å gjøre — **si ingenting**.
- Foretrekk stillhet fremfor støy. En kort, presis review er bedre enn en lang en.

**Blokker PR-en kun for:**
- Feil som vil føre til feil oppførsel i produksjon
- Sikkerhetssårbarheter (omgåelse av autentisering, injeksjon, dataeksponering)
- Risiko for tap eller korrupsjon av data

**Påpek, men ikke blokker for:**
- Ytelsesbekymringer som ikke er et målbart problem ennå
- Manglende tester for ikke-kritiske kodestier
- Feilsøkingslogging (\`console.log\`, \`debugger\` e.l.) i produksjonskode
- Hardkodede brukervendte tekster som burde bruke i18n eller konfig

**Ignorer helt:**
- Formatering, importrekkefølge, navnepreferanser eller stil som en linter bør håndtere
- Abstraksjoner for kode som ikke er duplisert ennå
- Hypotetiske fremtidige problemer
- Eksisterende teknisk gjeld som PR-en ikke berører

**Regler for konklusjon:**
- Hvis det ikke finnes blokkerende problemer → **GODKJENN** eller **GODKJENN MED SMÅTING**. Ikke finn på grunner til å be om endringer.
- Hvis det kun trengs én liten rettelse → si det tydelig og godkjenn når det er gjort.
- Be kun om **ENDRINGER** når noe konkret må fikses før sammenslåing.

**Alvorlighetsgrad (bruk sparsomt):**
- **Kritisk** — sikkerhetssårbarhet, datatap, eller definitiv produksjonsfeil i endret kode. Blokkerer sammenslåing.
- **Alvorlig** — alvorlig korrekthetsproblem i diffen som bør fikses før eller rett etter sammenslåing.
- Utelat lavprioritert tilbakemelding helt.

**Utdataformat:**

### Sammendrag
2–3 setninger: hva PR-en gjør, samlet risiko, og kun de viktigste funnene (hvis noen).

### Kritiske funn
Én blokk per problem i endret kode (filnavn, linje, konsekvens, konkret fiks). Hvis ingen: **Ingen.**

### Alvorlige funn
Samme format. **Utelat hele seksjonen** hvis ingen.

### Konklusjon
Én av: **GODKJENN** · **GODKJENN MED SMÅTING** · **BE OM ENDRINGER** · **BLOKKER**

Én setning som begrunner valget. Bruk **GODKJENN** når det ikke er kritiske eller alvorlige funn i diffen.`;

export const MAX_INLINE_COMMENTS = 8;

const INLINE_COMMENTS_INSTRUCTION = `
---

## Inline-kommentarer (påkrevd for verktøy)

Etter konklusjonen, legg til **én** JSON-kodeblokk og ingenting etter den. Blokken må være gyldig JSON:

\`\`\`json
{
  "inlineComments": [
    {
      "file": "path/relative/to/repo-root.ts",
      "line": 42,
      "severity": "critical",
      "body": "Kort, handlingsorientert kommentar på norsk (1–3 setninger)."
    }
  ]
}
\`\`\`

Regler:
- \`file\`: sti slik den vises i diff-headerene (repo-relativ, skråstrek fremover, ingen ledende skråstrek).
- \`line\`: linjenummer i filen **etter endring** på en **lagt til/endret** linje. Avled fra diff \`@@\`-hunk-headerene (\`+start,count\`).
- \`severity\`: kun \`critical\` eller \`major\`.
- Inline kun for: sikkerhet, korrekthetsfeil, feilsøkingslogging i produksjonskode, hardkodede brukervendte tekster, eller alvorlige lesbarhetsploblemer — **alt må være i diffen**.
- Maksimalt ${MAX_INLINE_COMMENTS} kommentarer; bruk **færre** hvis PR-en er ren. Ingen duplikater.
- All \`body\`-tekst må være på **norsk (bokmål)**.
- Bruk \`"inlineComments": []\` når ingenting møter terskelen.`;

export function buildReviewPrompt(
	pr: PullRequestContext,
	options?: { requestInlineComments?: boolean },
): string {
	const filesSummary = pr.files
		.map((f) => {
			const diffBlock = f.patch ? `\`\`\`diff\n${f.patch}\n\`\`\`` : "_No diff available_";
			return `### ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n\n${diffBlock}`;
		})
		.join("\n\n---\n\n");

	return `## Pull Request: ${pr.title}

**Forfatter:** ${pr.author}
**Målgren:** ${pr.baseBranch} ← **Kildegren:** ${pr.headBranch}

**Beskrivelse:**
${pr.description || "_Ingen beskrivelse gitt._"}

---

## Endrede filer (${pr.files.length})

${filesSummary}

---

Gjennomgå **kun endrede linjer** i denne PR-en. Fokuser på sikkerhet, korrekthet, lesbarhet av ny kode, feilsøkingslogging, og hardkodede brukervendte tekster. Hopp over alt annet.

Skriv hele reviewen på **norsk (bokmål)**.${
		options?.requestInlineComments ? INLINE_COMMENTS_INSTRUCTION : ""
	}`;
}

/** Matches ```json fenced blocks; closing ``` may be on the same line or after whitespace. */
const JSON_FENCE_PATTERN = "```json\\s*\\n([\\s\\S]*?)\\s*```";

function stripJsonCodeBlocks(text: string): string {
	return text
		.replace(new RegExp(JSON_FENCE_PATTERN, "gi"), "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function findLastJsonFence(text: string): RegExpMatchArray | undefined {
	const matches = [...text.matchAll(new RegExp(JSON_FENCE_PATTERN, "gi"))];
	return matches[matches.length - 1];
}

function parseInlineCommentsPayload(jsonText: string): ReviewComment[] {
	const parsed = JSON.parse(jsonText) as {
		inlineComments?: Array<{
			file?: string;
			line?: number;
			severity?: string;
			body?: string;
		}>;
	};

	const inlineSeverities = new Set(["critical", "major"]);
	const inlineComments: ReviewComment[] = [];

	for (const raw of parsed.inlineComments ?? []) {
		if (!raw.file || !raw.body || typeof raw.line !== "number") continue;
		if (!Number.isInteger(raw.line) || raw.line < 1) continue;
		const severity = (raw.severity ?? "major").toLowerCase();
		if (!inlineSeverities.has(severity)) continue;

		inlineComments.push({
			filename: raw.file.replace(/^\//, ""),
			line: raw.line,
			body: raw.body.trim(),
			severity: severity as ReviewComment["severity"],
		});

		if (inlineComments.length >= MAX_INLINE_COMMENTS) break;
	}

	return inlineComments;
}

export function splitReviewResponse(text: string): {
	markdown: string;
	inlineComments: ReviewComment[];
} {
	const trimmed = text.trim();
	const lastMatch = findLastJsonFence(trimmed);

	const markdownBeforeJson =
		lastMatch?.index != null ? trimmed.slice(0, lastMatch.index) : trimmed;

	let markdown = stripJsonCodeBlocks(markdownBeforeJson);
	let inlineComments: ReviewComment[] = [];

	if (lastMatch) {
		try {
			inlineComments = parseInlineCommentsPayload(lastMatch[1].trim());
		} catch {
			inlineComments = [];
		}
	}

	return { markdown, inlineComments };
}

const SEVERITY_LABELS_NO: Record<ReviewComment["severity"], string> = {
	critical: "Kritisk",
	major: "Alvorlig",
	minor: "Mindre",
	nit: "Pirk",
};

export function formatInlineCommentBody(comment: ReviewComment): string {
	const label = SEVERITY_LABELS_NO[comment.severity] ?? comment.severity;
	return `**[${label}]** ${comment.body}`;
}

export async function runReview(
	client: Anthropic,
	pr: PullRequestContext,
	options?: { requestInlineComments?: boolean },
): Promise<string> {
	const message = await client.messages.create({
		model: MODEL,
		max_tokens: MAX_TOKENS,
		system: STAFF_ENGINEER_SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				content: buildReviewPrompt(pr, options),
			},
		],
	});

	const textBlock = message.content.find((b) => b.type === "text");
	if (!textBlock || textBlock.type !== "text") {
		throw new Error("No text content in response");
	}
	return textBlock.text;
}
