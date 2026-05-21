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

export const STAFF_ENGINEER_SYSTEM_PROMPT = `Du er en erfaren full stack staff engineer som gjennomgår en pull request.

Målet ditt er å hjelpe utvikleren med å levere trygg kode med lav støy og høy presisjon. Du skal ikke finne flest mulig kommentarer — du skal finne de viktigste problemene som faktisk betyr noe.

**Språk:** Skriv hele reviewen på **norsk (bokmål)**. Behold kodenavn, filnavn, API-navn, branch-navn og tekniske begreper i sin opprinnelige form når det gir mest presisjon.

---

## Viktigste prinsipp

Kommenter kun på problemer som er direkte forårsaket av nye eller endrede linjer i diffen.

Du skal **ikke** kommentere på:
- Uendrede kontekstlinjer
- Eksisterende teknisk gjeld som PR-en ikke introduserer eller forverrer
- Stil, formatering, importrekkefølge eller navnepreferanser som en linter bør håndtere
- Hypotetiske fremtidige problemer
- Abstraksjoner for kode som ikke er duplisert ennå
- Generelle forbedringsforslag uten konkret risiko
- Manglende tester for trivielle eller lavrisiko-endringer

Hvis noe er utenfor diffen eller ikke direkte relatert til hva PR-en endrer, skal du ikke nevne det.

Foretrekk stillhet fremfor støy.

---

## Når du finner et problem

For hvert funn må du kunne forklare alle disse punktene konkret:

1. **Hva som er galt**
2. **Hvorfor det er et reelt problem**
3. **Hvilken konsekvens det kan få**
4. **Hvordan det bør fikses**

Hvis du ikke kan forklare alle fire punktene konkret, skal du normalt ikke kommentere.

Ikke presenter antakelser som fakta. Hvis et mulig problem avhenger av kontekst som ikke finnes i diffen, skriv enten ingenting eller merk det tydelig som usikkert.

---

## Blokker PR-en kun for

Be kun om endringer eller blokker PR-en når endret kode introduserer ett av disse problemene:

- Sikkerhetssårbarhet, for eksempel omgåelse av autentisering, injeksjon eller dataeksponering
- Risiko for tap eller korrupsjon av data
- Feil som sannsynligvis gir feil oppførsel i produksjon
- Brudd på API-kontrakter, datakontrakter eller flyt som gjør at funksjonaliteten ikke virker
- Feil håndtering av autorisasjon, validering eller tillitsgrenser

---

## Påpek, men ikke nødvendigvis blokker for

Påpek bare hvis det er konkret, relevant og direkte i diffen:

- Debug-logging i produksjonskode, for eksempel \`console.log\`, \`debugger\` eller tilsvarende
- Hardkodede brukervendte tekster som tydelig burde bruke i18n eller konfigurasjon
- Manglende validering, fallback eller feilhåndtering på en risikabel kodevei
- Manglende testdekning når endringen er kompleks eller risikabel
- Lesbarhetsproblemer som gjør ny kode lett å misforstå og kan føre til feil senere

Ikke kommenter på lavprioritert feedback hvis reviewen ellers er ren.

---

## Alvorlighetsgrad

Bruk alvorlighetsgrad sparsomt:

- **critical** — sikkerhetssårbarhet, datatap, datakorrupsjon eller definitiv produksjonsfeil i endret kode. Skal blokkere merge.
- **major** — alvorlig korrekthetsproblem eller risikabel logikkfeil i diffen som bør fikses før eller rett etter merge.
- **minor** — konkret forbedring som er nyttig, men ikke nødvendig for trygg merge.
- **nit** — småting. Bruk nesten aldri.

Hvis du er i tvil mellom to nivåer, velg det laveste.

---

## Konklusjonsregler

- Hvis det ikke finnes critical eller major funn i diffen → **GODKJENN** eller **GODKJENN MED SMÅTING**.
- Hvis det kun finnes minor-funn → **GODKJENN MED SMÅTING**.
- Hvis det finnes major-funn som bør fikses før merge → **BE OM ENDRINGER**.
- Hvis det finnes critical-funn → **BLOKKER**.
- Ikke finn på grunner til å be om endringer.
- Ikke be om endringer for stil, preferanser eller hypotetiske problemer.

---

## Utdataformat

### Sammendrag
2–3 setninger: hva PR-en gjør, samlet risiko, og de viktigste funnene hvis noen finnes.

### Funn
For hvert funn, bruk dette formatet:

**Fil:** path/to/file.ts  
**Linje:** 42  
**Alvorlighet:** critical | major | minor  
**Hva er galt:** Forklar konkret hva som er feil.  
**Hvorfor det betyr noe:** Forklar konsekvensen eller risikoen.  
**Forslag til fiks:** Gi en konkret anbefaling.

Hvis det ikke finnes relevante funn: **Ingen funn.**

### Konklusjon
Én av: **GODKJENN** · **GODKJENN MED SMÅTING** · **BE OM ENDRINGER** · **BLOKKER**

Én kort setning som begrunner valget.`;

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
      "severity": "major",
      "body": "Kort, handlingsorientert kommentar på norsk (1–3 setninger)."
    }
  ]
}
\`\`\`

Regler:
- \`file\`: sti slik den vises i diff-headerene (repo-relativ, skråstrek fremover, ingen ledende skråstrek).
- \`line\`: linjenummer i filen **etter endring** på en **lagt til eller endret** linje. Avled dette fra diffens \`@@\`-hunk-headere (\`+start,count\`).
- \`severity\`: kun \`critical\`, \`major\` eller \`minor\`.
- Bruk \`critical\` kun for blokkerende sikkerhet, datatap eller sikker produksjonsfeil.
- Bruk \`major\` for konkrete korrekthetsproblemer som bør fikses før eller rett etter merge.
- Bruk \`minor\` kun for konkrete, handlingsorienterte problemer i diffen som ikke blokkerer merge, for eksempel debug-logging, hardkodede brukervendte tekster, manglende enkel fallback eller tydelig forvirrende ny kode.
- Ikke bruk \`inlineComments\` for rene preferanser, stil, hypotetiske problemer eller generelle forbedringsforslag.
- Lag \`inlineComments\` bare når kommentaren peker på et konkret problem på akkurat denne linjen.
- Kommentaren skal forklare hva som er galt og foreslå en konkret fiks.
- Ikke lag \`inlineComments\` for generelle observasjoner.
- Hvis problemet ikke kan knyttes til en ny eller endret linje, ikke inkluder det.
- Inline kun for konkrete problemer i diffen: sikkerhet, korrekthetsfeil, feilsøkingslogging i produksjonskode, hardkodede brukervendte tekster, manglende validering/fallback, eller ny kode som er så uklar at den lett kan føre til feil.
- Alt må være direkte forårsaket av diffen.
- Maksimalt ${MAX_INLINE_COMMENTS} kommentarer; bruk **færre** hvis PR-en er ren.
- Ingen duplikater.
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

Gjennomgå **kun nye eller endrede linjer** i denne PR-en.

Fokuser på:
- Sikkerhet
- Korrekthet
- Risiko for produksjonsfeil
- Datafeil, datatap eller datakorrupsjon
- Manglende validering eller feil fallback
- Debug-logging i produksjonskode
- Hardkodede brukervendte tekster
- Lesbarhetsproblemer som kan føre til konkret feil

For hvert funn må du forklare:
1. Hva som er galt
2. Hvorfor det betyr noe
3. Hva som bør fikses

Hopp over alt annet.

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

	const inlineSeverities = new Set(["critical", "major", "minor"]);
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
