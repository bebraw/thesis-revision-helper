# Feature: Thesis Revision Helper

## Blueprint

### Context and status

This is the planned implementation baseline, version 0.1 of 6 November 2026. The current repository contains a starter Worker, not this product. The product is a LaTeX writing assistant for students who have already performed their research and developed their main ideas but need help presenting them clearly. It combines a continuously updated outline of manuscript reasoning with a workspace where students write their own revisions, using the original text and an AI proposal as references.

The source manuscript is authoritative. AI maintains interpretations and proposes wording; the student determines what to say and commits changes to the manuscript. This distinction must be visible in both the interface and implementation. The product aims to reduce language and presentation barriers while leaving research decisions visible to the student.

### Current increment: early vertical slice

The first implementation increment is a complete but bounded slice: open a small local LaTeX project, edit one supported prose paragraph, observe an automatically updated purpose, request a proposal, compose a student variant, commit it, and see the outline refresh. The original and proposal are references; the editable student buffer starts from the original, and proposal generation never mutates it or the manuscript. Commit targets the intended unchanged source as one undoable transaction, otherwise preserves the draft and reports a conflict. The slice must preserve source fidelity and student work, keep editing available when analysis fails, reject obsolete analysis, and prevent commits against changed or ambiguous targets. The implementation plan must identify its exact supported subset and checks. Capabilities below that are not necessary for this slice remain deferred to later increments of the first release, not authorized implementation work now. The baseline's source authority, ownership, fidelity, safety, and failure invariants still apply within the slice.

### Architecture

- **Capability source root and composition root:** To be selected during implementation; the starter `src/` is not yet the product.
- **Entry points:** A single-user browser interface and local companion service; transport and application framework remain open.
- **State authority:** UTF-8 LaTeX source files and ordinary editor transactions; generated analysis, history, student intent, and revision drafts live separately in application-managed project data.
- **Public contracts:** The operations, data distinctions, source and revision guards, and progress events defined below.
- **Dependency direction:** Keep editor, parser, storage, and model adapters replaceable. The local companion owns project access; a Cloudflare model/backend component is planned. The precise integration and authentication remain open. Credentials must remain out of browser state, exports, and logs; the baseline requires provider credentials in the local service. See [ADR-069](../../docs/adrs/accepted/ADR-069-local-companion-and-cloudflare-backend.md) for the architectural decision and [ARCHITECTURE.md](../../ARCHITECTURE.md) for cross-cutting constraints.

### Outside the first release

Literature discovery, citation truth verification, writing new research content, generating entire chapters, automatic application of AI edits, grading, authorship detection, plagiarism scoring, supervisor dashboards, real-time collaboration, Overleaf integration, full TeX macro execution, and in-app PDF compilation are out of scope. Students continue compiling with their normal LaTeX tooling. The earlier illustrative interface sketch is superseded where it suggested manually maintained observed purposes: observed purposes must update automatically.

### Anti-patterns

Do not confuse AI interpretation with source authority or student intent. Do not automatically insert AI proposals, use a global search-and-replace as a failed anchor fallback, or treat feedback as proof of external claims. Do not require artificial wording differences, retyping, mandatory reflections, or a minimum human contribution score. A third field is a workspace, not evidence of independent thought. Do not execute TeX macros, shell commands, package code, or instructions embedded in manuscripts or model output. Do not make model or persistence operations block typing.

## Contract

### Required outcomes and default choices

Students write and revise using LaTeX syntax. A hierarchical outline automatically describes the purpose of each section and prose paragraph as the manuscript changes and helps inspect progression and reasoning beyond headings and topic summaries. Students compare an original passage and AI proposal, then compose their own version separately. Analysis never automatically changes the manuscript, and proposal generation never inserts a proposal into a student revision. LaTeX commands, citations, references, mathematics, and source locations survive the workflow. Students can continue writing when parsing or analysis is incomplete or unavailable.

The first release defaults are a single-user browser interface with a local companion; opening a local directory or importing into a managed local directory; UTF-8 source files and ordinary editor transactions as authority; separate application-managed project data; one prose paragraph per language or clarity proposal with surrounding paragraph and section context; paragraph and section purposes plus section flow observations; English feedback with optional Finnish author notes; and a replaceable model provider adapter with application-validated structured responses. No specific model, framework, or LaTeX parser package is required. Core contracts are language independent; TypeScript shapes below are illustrative.

### Student ownership and editing

Use specific descriptions such as “Explains why the benchmark represents the target workload.” A label such as “Methods” or “Background” is insufficient as a paragraph purpose. Students may keep good phrases from either reference and may copy and paste normally. Reserve questions for ambiguities affecting meaning; optional explanations and occasional reflection prompts support learning without interrupting every correction. Describe a proposal as “One possible revision,” not the correct answer. Routine analysis and outline maintenance are automatic; changes to claims, explanations, interpretations, and manuscript wording occur through student editing.

### Main workflows

#### Open and analyse

1. Open a directory or import project files; select the root document when several candidates exist.
2. Display the file tree and root document in a LaTeX source editor.
3. Parse the supported include graph and immediately show heading and block structure.
4. Start background purpose analysis with explicit pending, current, stale, unclear, and failed states.
5. Allow source editing throughout analysis and persist student changes independently of model availability.

#### Write with the live outline

1. A source edit updates structural boundaries and source mappings; affected semantic annotations become stale immediately.
2. After a short pause, analyse changed paragraphs and relevant surrounding context.
3. Refresh purposes and section flow observations only if results still match their input dependencies.
4. Clicking an outline entry navigates to source; selecting a source paragraph selects its outline entry without stealing editor focus.

Students do not approve each outline update. Automatically generated interpretations remain visibly attributable to AI.

#### Compose a revision

1. Select a supported prose paragraph and choose Language or Clarity feedback; capture an immutable original snapshot and context dependencies.
2. Generate a proposal and short explanation of consequential changes.
3. Display Original, One possible revision, and Your revision, stacking clearly labelled panels on smaller screens.
4. Initialise Your revision from the original, never the proposal. A new proposal must not overwrite student work.
5. Allow free editing, hiding the proposal, comparing changes, and optionally recording a decision.
6. On “Use my revision,” validate the current target and apply the student-authored buffer as one undoable source transaction, then reanalyse and update the outline.

Revision buffers are saved as drafts while students work; they modify source only upon commit. Ordinary typing in the main source editor modifies the manuscript normally.

### Interface

The manuscript workspace provides a file tree, LaTeX source editor, and collapsible outline. Show local save state separately from analysis state. Support source syntax highlighting, keyboard navigation, and ordinary undo and redo. An outline-only view allows reading the argument without full prose.

Each section shows its actual source heading and inferred purpose. Each prose paragraph shows a short inferred purpose and can expand to a key point, relationship to the previous paragraph, and relevant feedback. Non-prose blocks remain navigable and are not mislabelled as prose. Offer at most a few prioritised flow observations per section; each links to its source blocks and explains the concern. Examples are repeated reasoning, a concept used before explanation, a conclusion before support, or an unclear transition. Apparent repetition can be intentional and feedback must allow that interpretation.

The original and proposal are read-only; Your revision is an editable LaTeX buffer. Allow text diffs between the student revision and original and keep both references available without forcing three narrow columns on small screens. Do not provide “Accept all AI edits,” automatic replacement, or a button that fills the student buffer from a proposal. Provide proposal visibility controls, optional explanations, a clear commit action, and a return path that preserves the draft.

Observed purpose is automatically generated from the current manuscript; intended purpose is an optional student-authored note. Persist them separately. Changing intended purpose schedules reanalysis without changing the source or replacing the observed description. A student may attach a correction note and request reanalysis when disagreeing with an observed purpose. Preserve the previous interpretation in analysis history; never freeze an observed purpose permanently as a result of a correction.

### LaTeX support

| Construct          | Required treatment                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document body      | Locate ordinary document content; exclude preamble commands from prose analysis.                                                                               |
| Headings           | Recognise chapter, section, subsection, subsubsection, paragraph, and subparagraph commands, including starred forms and optional short titles.                |
| Prose paragraphs   | Recognise blank-line and explicit paragraph boundaries outside protected contexts; a line wrap or LaTeX line-break command alone is not a new prose paragraph. |
| Formatting         | Preserve nested braces and common text-formatting commands; expose their text arguments to analysis.                                                           |
| Comments           | Exclude actual comments from semantic analysis while preserving original source; distinguish escaped percent signs from comments.                              |
| Mathematics        | Preserve exact inline and display math; associate display blocks with neighbouring prose as context.                                                           |
| Citations          | Preserve complete citation command source, optional arguments, keys, order, and occurrences.                                                                   |
| Cross references   | Preserve labels and reference commands, including exact identifiers.                                                                                           |
| Lists              | Represent list items as subordinate blocks, not unrelated flattened paragraphs.                                                                                |
| Figures and tables | Represent as non-prose blocks; use available captions and labels as context without claiming to interpret image content.                                       |
| Code and verbatim  | Treat content as opaque, retain navigation and source spans, and do not analyse it as thesis prose.                                                            |
| Included files     | Resolve literal root-relative input and include paths in source order, including omitted `.tex` extensions.                                                    |
| Unknown commands   | Preserve exact source, expose text only where a configured command signature permits it, and report uncertainty where interpretation is affected.              |

A section command named `paragraph` is a heading, distinct from a prose paragraph. Do not use regular expressions alone to establish nested syntax and block boundaries. Hide a tolerant syntax parser behind a documented adapter and test it against fixtures.

Restrict include resolution to the selected project. Detect missing files, cycles, repeated inclusion, dynamic paths, conditional include behaviour, and unsupported include mechanisms. Preserve constructs and show diagnostic placeholders instead of silently claiming a complete outline. The first release semantically expands static, non-repeated input and include paths; repeated inclusions and complex conditional or macro-generated structures are flagged as partially supported. Bibliography files and other assets remain unchanged. Bibliography metadata may label known citation keys but is not evidence of a cited claim's correctness. Never execute arbitrary macros, shell commands, package code, or embedded instructions, or compile documents during import or analysis.

When braces, environments, or commands are temporarily incomplete, preserve editing and saving, recover unaffected blocks where possible, and retain the last successful annotations visibly marked stale or parse-incomplete. Do not invent an interpretation of malformed source. Reconcile boundaries and reanalyse when source becomes interpretable.

Import and export preserve exact bytes of unedited files, including assets. Support UTF-8 with or without a byte-order mark and retain each file's original newline convention. Reject unsupported encodings with a useful message rather than replacing characters. The editor may use LF-normalised text internally; record the conversion and restore the file's convention on write. Source hashes use canonical LF-normalised strings encoded as UTF-8. Editor offsets use zero-based UTF-16 code units with exclusive ends. Maintain conversion explicitly; displayed line numbers are navigation aids, not durable identities.

### Automatic outline analysis

For each prose paragraph generate a concise purpose, optional key point, and relationship to the preceding relevant prose block. Relationship categories may include introduces, elaborates, provides evidence, contrasts, qualifies, interprets, transitions, concludes, or unclear; these aid navigation and are not a mandatory thesis template. Describe the paragraph's contribution in its actual context, not what an ideal paragraph ought to contain. Use unclear when its role cannot be inferred reliably; mark interpretations as tentative where needed and do not display uncalibrated numeric confidence.

Infer section purposes from headings, current contents, and child purposes; update ancestor purposes after relevant child changes. Use a configured research question and student notes as context when available, but describe what is currently written. Preserve hierarchy with incomplete semantic analysis and do not impose a fixed introduction/methods/results/discussion template; implementation-oriented CS theses may differ.

Each substantive issue identifies source blocks and supporting quotes or ranges. Verify quoted text against the analysed snapshot. Feedback may identify an unsupported step in the visible argument but must not claim external papers, datasets, experiments, or research findings have been verified. AI output is provisional. Allow dismissal with an optional reason and prevent unchanged dismissed issues from reappearing every pass; expire dismissal when the underlying source or relevant dependencies materially change.

### Incremental analysis and concurrency

Use independent structural parsing and asynchronous semantic-analysis paths. Neither model requests nor persistence operations block typing.

1. Assign a new file version to each source transaction and reparse the affected file in a background worker or equivalent isolated task.
2. Reconcile block identities and source anchors before semantic analysis.
3. Immediately mark changed blocks, affected neighbours, section flow observations, and dependent ancestor purposes stale.
4. Dispatch paragraph analysis after 1,500 ms without relevant typing; do not dispatch during active input-method composition.
5. Batch nearby changed blocks. Reuse cached results only when source hash, context digest, prompt version, and model configuration match.
6. After accepting child results, refresh affected section analysis and ancestor purposes without reanalysing unrelated sections.
7. Validate response shape and every input dependency before publishing; discard obsolete responses even when cancellation was attempted.

Every request carries the exact block versions, neighbouring and heading context, author notes, and upstream purpose revisions used. The context digest covers every input actually sent. A result cannot become current merely because the selected paragraph is unchanged when other supplied context changed.

Use configurable concurrency, token, and project-request budgets. Coalesce queued work to the newest dependency set. On provider error preserve source and drafts, mark analysis failed or stale, and retry with bounded backoff. Budget exhaustion pauses analysis with clear status rather than silently omitting sections or disabling editing.

### Stable identities and source anchoring

Generate persistent opaque IDs for files and blocks, never deriving block IDs solely from position or current text hash. Reconcile reparses using editor change mappings first, then syntax structure, neighbouring identities, and content similarity. Distinguish insertion before a paragraph, wording edits, and moves. Identical repeated text is not a unique anchor.

Record explicit lineage between old and new blocks on split or merge. Preserve source-linked history but flag ambiguous intended-purpose notes for student review rather than silently attaching them to the wrong paragraph. Reordering updates flow dependencies in both old and new neighbourhoods. If an anchor cannot be uniquely resolved, disable source mutation for that revision session, preserve the draft, and request reselection or conflict resolution. Never fall back to global text search and replace.

### Revision generation and commit

| Mode             | Proposal or feedback may do                                                                          | Must surface separately                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Language         | Improve grammar, articles, idiom, word choice, and repetition within the selected paragraph.         | Ambiguities affecting meaning.                                                          |
| Clarity          | Reorganise sentences and make existing relationships easier to follow within the selected paragraph. | New inferences, changed emphasis, or an uncertain intended connection.                  |
| Structure review | Comment on paragraph order, scope, transitions, and section progression.                             | Proposed moves, splits, and merges as suggestions; the student performs source changes. |

Language and clarity proposals retain one selected paragraph's scope. Structural feedback never automatically moves or regenerates paragraphs in the first release; students can restructure source directly and receive an updated outline. Do not add findings, citations, methodological steps, causal explanations, or missing comparison targets. If “the system performed better” lacks a comparison or measure, ask instead of supplying one. Preserve cautious language and distinguish observation from interpretation.

Extract protected spans before requesting a proposal. Verify citation and reference payloads, labels, mathematical source, code spans, and unknown commands survive exactly without silent removal, duplication, invention, or modification. A response failing these checks is not a valid proposal: preserve it as a failed response record, explain the reason, and permit a fresh request.

Check known numerical facts and project terminology. Reject deterministic changes to extracted factual quantities, allowing equivalent numeral representations. Highlight uncertain changes in quantities, negation, quantifiers, modality, comparison scope, and citation attachment for review. Syntax checks can be deterministic; semantic checks are advisory and must not be represented as a guarantee of preserved meaning. Students may change research content in their own revision. When their buffer changes protected material or important facts, warn explicitly for review rather than silently correcting or prohibiting authorship.

Capture the original source slice, its anchor, and exact hash when opening a revision session. Store each proposal separately from the student buffer; regeneration creates a new immutable proposal record. On commit, resolve the target through current editor mappings and require an exact match to the original target text. Edits elsewhere may shift offsets without invalidating it. If target content changed, preserve all three versions and require explicit conflict resolution against current source; never overwrite newer source. If only supplied surrounding context changed, mark the proposal stale and explain why; the student may refresh it or review their independently authored draft. Before committing, surface current fact or syntax warnings. Treat commit, persistence, and undo history as one recoverable editing operation. A no-op revision produces no unnecessary source transaction.

### Component responsibilities

| Component           | Responsibilities                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Source editor       | LaTeX editing, selection, transactions, source maps, undo and redo.                         |
| Project service     | Project access, include resolution, file versions, atomic saves, import and export.         |
| Parser adapter      | Tolerant syntax tree, blocks, protected spans, source mapping, diagnostics.                 |
| Identity reconciler | Stable block IDs, move detection, split and merge lineage.                                  |
| Analysis scheduler  | Dependency tracking, debounce, cache, request budgets, retries, obsolete-result rejection.  |
| Model gateway       | Provider credentials, request formatting, response parsing, cancellation, usage accounting. |
| Response validator  | Schema validation, source evidence checks, protected syntax checks, review warnings.        |
| Outline store       | Generated purposes, issues, states, history, optional author intent.                        |
| Revision service    | Original snapshots, proposals, student drafts, guarded commits, conflicts.                  |

Keep model credentials in the local service rather than the browser. A structured-response adapter must work with native provider schemas or plain text: parse and validate the same application schema in both cases.

### Data contracts

Additional storage fields are permitted, but these distinctions and invariants must survive. Types are illustrative, not a requirement to use TypeScript throughout.

```typescript
type AnalysisState = "pending" | "current" | "stale" | "unclear" | "parse_incomplete" | "failed" | "paused";

interface SourceAnchor {
  fileId: string;
  fileVersion: number;
  startUtf16: number;
  endUtf16: number;
  sourceHash: string;
}

interface SourceBlock {
  id: string;
  parentId: string | null;
  kind: "section" | "paragraph" | "list_item" | "math" | "figure" | "table" | "code" | "opaque";
  order: number;
  source: SourceAnchor;
  headingLevel?: number;
  headingText?: string;
  protectedSpans: Array<{
    kind: string;
    startRelativeUtf16: number;
    endRelativeUtf16: number;
    exactSource: string;
  }>;
}

interface AnalysisDependency {
  blockId: string;
  sourceHash: string;
  purposeRevision?: string;
}

interface OutlineAnalysis {
  id: string;
  blockId: string;
  state: AnalysisState;
  purpose: string | null;
  keyPoint?: string;
  relationToPrevious?: { kind: string; explanation: string };
  dependencies: AnalysisDependency[];
  contextDigest: string;
  providerId: string;
  modelId: string;
  promptVersion: string;
  generatedAt: string;
  issues: Array<{
    id: string;
    kind: string;
    message: string;
    sourceBlockIds: string[];
    evidence: Array<{ blockId: string; exactQuote: string }>;
  }>;
}

interface AuthorIntent {
  blockId: string;
  intendedPurpose?: string;
  correctionNote?: string;
  modifiedAt: string;
}

interface RevisionSession {
  id: string;
  blockId: string;
  baseAnchor: SourceAnchor;
  originalSource: string;
  contextDigest: string;
  proposalIds: string[];
  studentDraft: string;
  studentDecisionNote?: string;
  status: "draft" | "conflict" | "committed" | "discarded";
}

interface Proposal {
  id: string;
  sessionId: string;
  mode: "language" | "clarity";
  source: string;
  contextDigest: string;
  explanation: string[];
  questions: string[];
  validation: "valid" | "failed";
  warnings: string[];
  modelId: string;
  promptVersion: string;
}
```

An anchor's source hash covers its exact canonical source slice, not the whole file. A section node's source span identifies its heading command; children and dependencies represent contents, potentially across files. The application computes IDs, hashes, dependency digests, freshness, and provider metadata. The model returns textual interpretations, permitted block references, and proposal content; it cannot declare its output current or authorise a source operation. The digest also covers non-block inputs such as research questions, glossary entries, author notes, and relevant prompt configuration. Persist document versions, save states, lineage, source snapshots for open sessions, and student drafts even when not expanded above.

### Application operations

Internal service interfaces or an equivalent local API expose these operations. Transport is replaceable; state changes and guards are required.

| Operation         | Main input                                              | Required result                                |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------- |
| OpenProject       | Directory or imported project, optional root            | Project identity, file inventory, diagnostics. |
| UpdateSource      | File ID, expected file version, editor transaction      | New version and mapped anchors, or conflict.   |
| GetOutline        | Project and analysis cursor                             | Hierarchy, annotations, issues, freshness.     |
| SetAuthorIntent   | Block ID and author text                                | Stored intent and scheduled analysis.          |
| StartRevision     | Block ID, mode, current selection version               | Immutable base snapshot and student draft.     |
| GenerateProposal  | Session ID, selected context digest                     | Proposal record or explicit failed response.   |
| SaveRevisionDraft | Session ID, draft version, student text                 | Updated draft without source mutation.         |
| CommitRevision    | Session ID, expected target hash, student draft version | Undoable source transaction or conflict.       |
| ExportProject     | Project ID, include-annotations option                  | LaTeX project with source fidelity preserved.  |

Progress events carry project, block, request, and version IDs. A cancelled request may still finish at the provider; result publication remains subject to dependency validation. Model-generated identifiers must refer to allowed request IDs and cannot create arbitrary file paths or source targets.

### Storage and recovery

Store generated outlines, optional intended purposes, proposal history, revision drafts, and diagnostics separately from source. Do not inject metadata comments into the manuscript. Offer optional portable annotations export alongside the LaTeX project; ordinary compilation must not require it.

Autosave source edits and revision drafts independently using atomic file replacement or an equivalent recoverable journal. Retain a last-saved snapshot and clearly indicate unsaved state. After restart recover pending student drafts and mark interrupted analysis stale or retryable. When external tooling changes a source file, compare it with last loaded and saved versions; reload clean buffers or present a conflict for dirty ones without overwriting external edits. Export identifies unsaved or conflicted files and offers the current coherent saved snapshot.

### Model context and data handling

Send only selected source and necessary surrounding context. Show which configured provider receives manuscript text. Keep credentials out of browser state, project exports, and logs. The local service binds to loopback and validates allowed request origins; imported paths cannot escape the project directory.

Treat manuscript prose, comments, included files, bibliography text, and model output as untrusted content. They cannot change application instructions, trigger commands, access unrelated files, or grant network access. Escape rendered output and validate structured payloads before display or use. Retain useful request metadata and error categories without logging manuscript text by default. Let students clear generated analysis and history without deleting thesis source. Deleting an imported managed project has an explicit scope distinct from clearing annotations; never delete an externally opened source directory as a side effect.

### Optional writing resources

The following user-supplied links to Learn Scientific Writing are optional contextual explanations, not an additional required workflow or proof that tool interpretations are correct. A simple versioned mapping may link categories to resources; a link is enough for the first release. The linked content has not been reviewed during project initialization.

| Feedback category                            | Resource                                                          |
| -------------------------------------------- | ----------------------------------------------------------------- |
| Paragraph purpose, cohesion, and signposting | [Paragraphs](https://learnscientificwriting.com/book/paragraphs/) |
| Section order and clarity                    | [Editing](https://learnscientificwriting.com/book/editing/)       |
| Citation placement and attribution           | [Citing](https://learnscientificwriting.com/book/citing/)         |
| Iteration and progress                       | [Process](https://learnscientificwriting.com/book/process/)       |

Retrieval from the complete book, personalised exercises, and supervisor-specific pedagogical configuration are later possibilities after the core workflow is reliable.

### Performance targets

These are initial targets to validate on the selected implementation, not measurements of an existing system.

| Area                | Target                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Editing             | No model request blocks source entry, selection, or undo.                                                             |
| Structural updates  | Visible within 250 ms at p95 after a normal edit in an active file up to 200 KiB on the documented reference machine. |
| Semantic dispatch   | Begins after the configured 1,500 ms idle interval when analysis is available and within budget.                      |
| Semantic completion | Target p95 below 15 seconds for a small paragraph batch with the selected provider; show pending status throughout.   |
| Durability          | Save source and draft changes within 1 second of idle when storage is available; report failures explicitly.          |
| Reference project   | Exercise 100,000 prose words, 100 source files, and 2,000 prose blocks; record initial-analysis cost and latency.     |

Typing and navigation must remain useful before full initial analysis completes. A provider missing the latency target must not cause false current states or lost work.

### First-release acceptance criteria

The first release is complete only when all scenarios below are demonstrated. They describe the full first-release target; the current vertical slice implements the relevant subset, with its exact verification specified before implementation. Use a deterministic fake model for concurrency and failure tests, plus a small manually reviewed set of real-provider outputs for semantic quality.

| ID  | Scenario                                                                      | Acceptance                                                                                                                                              |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Open and export an unchanged project                                          | All unedited files and assets are byte-identical, including newline conventions and UTF-8 marks.                                                        |
| A02 | Parse ordinary headings and prose                                             | Correct hierarchy, including starred headings, optional titles, explicit paragraphs, and the paragraph heading command.                                 |
| A03 | Parse comments and line breaks                                                | Comments do not become outline prose; escaped percent signs remain text; ordinary line wraps and line-break commands do not create spurious paragraphs. |
| A04 | Encounter nested formatting, citations, and math                              | Extract usable context while retaining exact source spans and protected payloads.                                                                       |
| A05 | Encounter lists, floats, and verbatim                                         | Navigate correctly; keep non-prose blocks distinct; avoid treating code as an argument.                                                                 |
| A06 | Resolve includes                                                              | Static includes appear in source order; cycles, missing paths, repeated inclusions, and unsupported structures produce explicit diagnostics.            |
| A07 | Temporarily break a command or environment                                    | Editing and saving continue; unaffected structure survives; affected annotations remain visibly incomplete or stale.                                    |
| A08 | Edit a paragraph                                                              | Its observed purpose updates after idle without student confirmation; dependent section analysis refreshes.                                             |
| A09 | Edit an unrelated section                                                     | Current results with unchanged dependencies are reused rather than resending the whole thesis.                                                          |
| A10 | Receive responses out of order                                                | An older dependency set never overwrites current analysis, even if cancellation failed.                                                                 |
| A11 | Move, split, or merge paragraphs                                              | Preserve identity where unambiguous, record lineage, invalidate affected flow, and flag ambiguous author-note reassignment.                             |
| A12 | Edit near repeated identical passages                                         | Source navigation and revision commits target the correct block or stop for ambiguity.                                                                  |
| A13 | Start a revision                                                              | Original is immutable; student buffer starts from original; generating or regenerating a proposal never changes source or student buffer.               |
| A14 | Write an independent variant                                                  | Student can keep, reject, combine, or independently rewrite wording; no artificial difference threshold or mandatory reflection.                        |
| A15 | Model alters a citation, reference, math expression, label, or numerical fact | Reject deterministic preservation violations; surface semantic uncertainty; never silently insert the response.                                         |
| A16 | Student deliberately changes protected material                               | Keep the authored change available, show review warnings, and allow a deliberate source commit.                                                         |
| A17 | Source changes during a revision session                                      | Unrelated edits remap anchors; changed target content produces a conflict without losing the student draft.                                             |
| A18 | Commit and undo a revision                                                    | Apply the exact student buffer to the intended span as one transaction; undo restores the previous source.                                              |
| A19 | Use non-ASCII text and emoji                                                  | UTF-16 editor offsets map correctly to the intended source without corrupting adjacent text.                                                            |
| A20 | Provider returns malformed output, times out, or exceeds budget               | Preserve manuscript and drafts; show an actionable analysis state; reject invalid payloads.                                                             |
| A21 | Restart or detect an external file edit                                       | Recover saved drafts and source state; show conflicts rather than overwriting work.                                                                     |
| A22 | Read the outline without prose                                                | Show specific contributions in source order; unclear roles remain explicit; headings alone are insufficient.                                            |
| A23 | Receive a structural observation                                              | Link it to real source blocks and verified excerpts; permit dismissal and retain meaningful dismissal state.                                            |
| A24 | Use keyboard and a narrow screen                                              | Navigate outline, inspect both references, edit the student variant, and commit without clipped essential controls.                                     |
| A25 | Import adversarial manuscript content                                         | No instruction in source or model output executes commands, escapes paths, accesses unrelated files, or bypasses source guards.                         |

Fixtures must include an implementation-oriented CS thesis structure, a literature-review passage, a results-and-limitations passage, citation-heavy prose, mathematical notation, incomplete syntax, and multi-file source.

### Implementation sequence

The requested early vertical slice takes priority across these stages; it is the current increment and does not itself authorise implementing the whole first release. The stages provide the broader delivery and exit criteria.

| Stage | Deliverable                                      | Exit condition                                                                                                         |
| ----- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 1     | Local project editing and source fidelity        | Import, guarded saves, export, undo, and external-change handling work without AI.                                     |
| 2     | Tolerant parser and stable block model           | Supported LaTeX fixtures produce correct navigation, protected spans, and identity reconciliation.                     |
| 3     | Live semantic outline                            | Background analysis updates purposes, tracks dependencies, and rejects obsolete results.                               |
| 4     | Student revision workspace                       | Immutable original and proposal, independently saved student draft, comparison, guarded commit, and conflict recovery. |
| 5     | Section flow feedback and optional author intent | Source-linked observations and intended-versus-observed feedback work without manual outline maintenance.              |
| 6     | Pilot and release validation                     | Acceptance criteria pass; observed student sessions identify and resolve misleading feedback and workflow friction.    |

### Pilot evaluation

Start with students whose research is substantially complete and ideas available, but who experience difficulty with presentation or English expression. Observe whether they can explain a paragraph's purpose, recognise when an AI proposal changes meaning, and produce a revision they can justify.

With explicit agreement collect a small set of original passages, proposals, student revisions, outline interpretations, and student comments. Human reviewers assess clarity, preservation of facts and qualifications, and whether outline descriptions match the prose. Record false positives and unnecessary interruptions alongside useful interventions.

A later study can compare independent revision of a fresh passage after tool use. Cleaner assisted prose, satisfaction, time saved, and independent reasoning are separate outcomes. The first pilot establishes usability and feedback reliability; it cannot establish that the workflow guarantees student thinking or prevents outsourcing elsewhere.
