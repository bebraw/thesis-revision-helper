import { describe, expect, it } from "vitest";
import { parseLatex, validateProposalSyntax } from "./latex";

describe("parseLatex", () => {
  it("retains exact heading source and raw title through optional arguments and nested markup", () => {
    const source = String.raw`\begin{document}
\section*[Short {title}]{A \emph{nested \{ literal\}}}
Body.
\end{document}`;
    const [heading] = parseLatex(source).headings;
    expect(heading).toMatchObject({
      level: 2,
      text: String.raw`\section*[Short {title}]{A \emph{nested \{ literal\}}}`,
      title: String.raw`A \emph{nested \{ literal\}}`,
    });
    expect(heading && source.slice(heading.start, heading.end)).toBe(heading?.text);
  });

  it("excludes the preamble and recognises nested starred headings and paragraph boundaries", () => {
    const source = String.raw`\documentclass{article}
\begin{document}
\section*[Short]{A {nested} title}
First wrapped
line.\\ Still here.

Second paragraph.\par Third paragraph.
\end{document}`;
    const result = parseLatex(source);
    expect(result.headings.map((heading) => heading.text)).toEqual([String.raw`\section*[Short]{A {nested} title}`]);
    expect(result.headings.map((heading) => heading.title)).toEqual(["A {nested} title"]);
    expect(result.paragraphs.map((paragraph) => paragraph.text)).toEqual([
      String.raw`First wrapped
line.\\ Still here.`,
      "Second paragraph.",
      "Third paragraph.",
    ]);
    expect(result.paragraphs.every((paragraph) => paragraph.safe)).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not mistake a document command inside a preamble group for the body", () => {
    const source = String.raw`\newcommand{\fake}{\begin{document}}
\begin{document}
Real prose.
\end{document}`;
    expect(parseLatex(source).paragraphs.map((paragraph) => paragraph.text)).toEqual(["Real prose."]);
  });

  it("retains exact protected syntax and UTF-16 spans while excluding comments from analysis", () => {
    const source = String.raw`\begin{document}
😀 A \emph{nested {idea}} with 20\% gain % no claim
and \cite[see][p. 2]{ref-one,ref-two}, \ref{sec:x}, and $x_{i}$.
\end{document}`;
    const result = parseLatex(source);
    const paragraph = result.paragraphs[0];
    expect(paragraph).toBeDefined();
    if (!paragraph) throw new Error("Expected a paragraph");
    expect(paragraph.text).toBe(source.slice(paragraph.start, paragraph.end));
    expect(paragraph?.analysisText).not.toContain("no claim");
    expect(paragraph?.analysisText).toContain(String.raw`20\% gain`);
    expect(paragraph?.protectedSpans.map((span) => span.text)).toEqual([
      String.raw`\%`,
      String.raw`\cite[see][p. 2]{ref-one,ref-two}`,
      String.raw`\ref{sec:x}`,
      String.raw`$x_{i}$`,
    ]);
    for (const span of paragraph?.protectedSpans ?? []) {
      expect(source.slice(span.start, span.end)).toBe(span.text);
    }
    expect(paragraph?.safe).toBe(true);
  });

  it("validates an entire proposal and preserves the protected syntax sequence exactly", () => {
    const source = String.raw`\begin{document}A gain of 20\% in $x$ \cite[see]{source}.\end{document}`;
    const original = parseLatex(source).paragraphs[0];
    if (!original) throw new Error("Expected a paragraph");
    expect(validateProposalSyntax(original, String.raw`The gain is 20\% in $x$ \cite[see]{source}.`).valid).toBe(true);
    for (const changed of [
      String.raw`A gain of 20% in $x$ \cite[see]{source}.`,
      String.raw`A gain of 20\% in $y$ \cite[see]{source}.`,
      String.raw`A gain of 20\% in $x$ \cite[see]{other}.`,
      String.raw`A gain of 20\% in $x$ \cite[see]{source}. \cite{extra}`,
      String.raw`A gain of 20\% in $x$ \cite[see]{source}. \unknown{one}`,
      String.raw`A gain of 20\% in $x$ \cite[see]{source}. \end{document}ignored`,
      "One.\n\nTwo.",
      String.raw`\section{New heading}Text.`,
      String.raw`Unclosed \emph{text`,
    ]) {
      expect(validateProposalSyntax(original, changed).valid, changed).toBe(false);
    }
    expect(validateProposalSyntax({ ...original, safe: false }, original.text).valid).toBe(false);
  });

  it("flags unknown commands and incomplete nested syntax instead of permitting a revision", () => {
    const source = String.raw`\begin{document}
An unknown \custom{value}.

An unfinished \emph{phrase.
\end{document}`;
    const result = parseLatex(source);
    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphs.map((paragraph) => paragraph.safe)).toEqual([false, false]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("Unknown command"))).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("Incomplete"))).toBe(true);
  });

  it("does not classify unsupported environments as prose and resumes after them", () => {
    const source = String.raw`\begin{document}
Before.
\begin{verbatim}
not prose
\end{verbatim}
After.
\end{document}`;
    const result = parseLatex(source);
    expect(result.paragraphs.map((paragraph) => paragraph.text)).toEqual(["Before.", "After."]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("Unsupported environment"))).toBe(true);
  });

  it("rejects non-canonical line endings rather than producing misleading offsets", () => {
    const result = parseLatex("\\begin{document}\r\nText.\r\n\\end{document}");
    expect(result.paragraphs).toEqual([]);
    expect(result.diagnostics[0]?.message).toContain("LF");
  });

  it("protects backslash-delimited mathematics and flags even single-letter unknown commands", () => {
    const source = String.raw`\begin{document}
Equation \(x_{1}\) and display \[x = 2\].

Unknown \x{payload}.
\end{document}`;
    const result = parseLatex(source);
    expect(result.paragraphs[0]?.protectedSpans.map((span) => span.text)).toEqual([String.raw`\(x_{1}\)`, String.raw`\[x = 2\]`]);
    expect(result.paragraphs[1]?.safe).toBe(false);
  });

  it("treats bracket characters inside nested braces as citation argument content", () => {
    const source = String.raw`\begin{document}
Evidence \cite[{see ] here}]{ref}.
\end{document}`;
    const paragraph = parseLatex(source).paragraphs[0];
    expect(paragraph?.safe).toBe(true);
    expect(paragraph?.protectedSpans[0]?.text).toBe(String.raw`\cite[{see ] here}]{ref}`);
  });

  it("does not let a document end inside verbatim hide following prose", () => {
    const source = String.raw`\begin{document}
\begin{verbatim}
\end{document}
\end{verbatim}
After.
\end{document}`;
    const result = parseLatex(source);
    expect(result.paragraphs.map((paragraph) => paragraph.text)).toEqual(["After."]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("Unsupported environment"))).toBe(true);
  });

  it("does not expose text from nested unsupported environments as prose", () => {
    const source = String.raw`\begin{document}
\begin{itemize}
\begin{itemize} Nested \end{itemize}
Outer text.
\end{itemize}
After.
\end{document}`;
    const result = parseLatex(source);
    expect(result.paragraphs.every((paragraph) => !paragraph.text.includes("Outer text"))).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stops safely for missing bodies, headings, and protected arguments", () => {
    expect(parseLatex("plain source").paragraphs).toEqual([]);
    expect(parseLatex(String.raw`\begin{document} unfinished`).paragraphs).toEqual([]);
    const heading = parseLatex(String.raw`\begin{document}\section{unfinished\end{document}`);
    expect(heading.headings).toEqual([]);
    expect(heading.diagnostics[0]?.message).toContain("Incomplete heading");
    const cite = parseLatex(String.raw`\begin{document}Broken \cite{\end{document}`);
    expect(cite.paragraphs[0]?.safe).toBe(false);
    expect(cite.diagnostics.some((item) => item.message.includes("Incomplete protected"))).toBe(true);
  });

  it("reports unmatched braces and incomplete mathematics", () => {
    const braces = parseLatex(String.raw`\begin{document}Broken }.\end{document}`);
    expect(braces.paragraphs[0]?.safe).toBe(false);
    expect(braces.diagnostics[0]?.message).toContain("Unmatched");
    for (const content of [String.raw`Math $x`, String.raw`Math \(x`]) {
      const result = parseLatex(`\\begin{document}${content}\\end{document}`);
      expect(result.paragraphs[0]?.safe).toBe(false);
      expect(result.diagnostics[0]?.message).toContain("Incomplete mathematics");
    }
  });

  it("does not offer malformed formatting or display math as a safe prose target", () => {
    for (const content of [String.raw`Broken \emph text.`, String.raw`Text $$x = 2$$.`, String.raw`Text \[x = 2\].`]) {
      const result = parseLatex(`\\begin{document}${content}\\end{document}`);
      expect(result.paragraphs[0]?.safe).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
