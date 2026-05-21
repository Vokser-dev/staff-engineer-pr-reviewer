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

En linje er kun "endret" hvis den vises som \`+\` eller \`-\` i diffen. Linjer som vises uten prefiks (kontekstlinjer) er **uendret** og skal aldri kommenteres, selv om de tilfeldigvis er synlige i diff-utdraget.

Du skal **ikke** kommentere på:
- Uendrede kontekstlinjer (alt som ikke er \`+\` eller \`-\` i diffen)
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

Ikke presenter antakelser som fakta. Hvis et mulig problem avhenger av kontekst som ikke finnes i diffen, skriv ingenting.

**Ikke spekuler om eksterne fakta du ikke kan verifisere fra diffen alene.** Du har ikke tilgang til internett, dokumentasjon, API-kataloger, modellregistre, pakkeversjoner eller andre eksterne kilder. Ikke påstå at en modell-ID, et API-endepunkt, et pakkenavn eller en versjon er ugyldig med mindre dette er bevist av selve diffen (f.eks. en kompilator-feil eller en typedefinisjon i koden).

**Ikke skriv hedge-funn.** Hvis du må legge til "bekreft at dette er bevisst", "hvis denne linjen ikke er endret kan funnet ignoreres", "ved nærmere ettersyn", eller lignende forbehold — så er funnet ikke klart nok til å inkluderes. Avgjør internt om funnet er reelt; ta det enten med uten forbehold, eller utelat det helt.

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

**Ikke "tenk høyt" i utdataet.** Hvis du under vurderingen kommer til at noe likevel ikke er et reelt funn, skal du **ikke** inkludere det i listen — heller ikke som "trukket tilbake", "ved nærmere ettersyn er dette greit" eller lignende. Bare ta med funn du står inne for.

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
  "overallVerdict": "approve",
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
- \`severity\`: kun \`critical\`, \`major\`, \`minor\` eller \`nit\`.
- Bruk \`critical\` kun for blokkerende sikkerhet, datatap eller sikker produksjonsfeil.
- Bruk \`major\` for konkrete korrekthetsproblemer som bør fikses før eller rett etter merge.
- Bruk \`minor\` kun for konkrete, handlingsorienterte problemer i diffen som ikke blokkerer merge, for eksempel debug-logging, hardkodede brukervendte tekster, manglende enkel fallback eller tydelig forvirrende ny kode.
- Bruk \`nit\` kun for små forbedringer som øker lesbarhet eller vedlikeholdbarhet uten å påvirke korrekthet eller risiko.
- \`nit\` skal aldri blokkere merge.
- \`overallVerdict\` må være én av:
  - \`approve\`
  - \`comment\`
  - \`request-changes\`
- Mapping:
  - \`approve\` brukes for GODKJENN
  - \`comment\` brukes for GODKJENN MED SMÅTING
  - \`request-changes\` brukes for BE OM ENDRINGER eller BLOKKER
- Ikke bruk \`inlineComments\` for rene preferanser, stil, hypotetiske problemer eller generelle forbedringsforslag.
- Lag \`inlineComments\` bare når kommentaren peker på et konkret problem på akkurat denne linjen.
- Kommentaren skal forklare hva som er galt og foreslå en konkret fiks.
- Ikke lag \`inlineComments\` for generelle observasjoner.
- Inkluder kun funn du står inne for. Hvis du er usikker, eller har vurdert og forkastet et funn underveis, skal det **ikke** med i \`inlineComments\` — verken som advarsel, "trukket tilbake" eller "ved nærmere ettersyn".
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

function parseInlineCommentsPayload(jsonText: string): {
	overallVerdict?: "approve" | "comment" | "request-changes";
	inlineComments: ReviewComment[];
} {
	const parsed = JSON.parse(jsonText) as {
		overallVerdict?: unknown;
		inlineComments?: Array<{
			file?: string;
			line?: number;
			severity?: string;
			body?: string;
		}>;
	};

	const verdicts = new Set(["approve", "comment", "request-changes"]);
	const normalizedVerdict =
		typeof parsed.overallVerdict === "string"
			? parsed.overallVerdict.toLowerCase()
			: undefined;
	const overallVerdict =
		normalizedVerdict && verdicts.has(normalizedVerdict)
			? (normalizedVerdict as "approve" | "comment" | "request-changes")
			: undefined;

	const inlineSeverities = new Set(["critical", "major", "minor", "nit"]);
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

	return { overallVerdict, inlineComments };
}

export function splitReviewResponse(text: string): {
	markdown: string;
	inlineComments: ReviewComment[];
	overallVerdict?: "approve" | "comment" | "request-changes";
} {
	const trimmed = text.trim();
	const lastMatch = findLastJsonFence(trimmed);

	const markdownBeforeJson =
		lastMatch?.index != null ? trimmed.slice(0, lastMatch.index) : trimmed;

	const markdown = stripJsonCodeBlocks(markdownBeforeJson);
	let inlineComments: ReviewComment[] = [];
	let overallVerdict: "approve" | "comment" | "request-changes" | undefined;

	if (lastMatch) {
		try {
			const payload = parseInlineCommentsPayload(lastMatch[1].trim());
			overallVerdict = payload.overallVerdict;
			inlineComments = payload.inlineComments;
		} catch {
			overallVerdict = undefined;
			inlineComments = [];
		}
	}

	return { markdown, inlineComments, overallVerdict };
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
