export interface SourceSpan {
  start: number;
  end: number;
  text: string;
}

export interface LatexParagraph extends SourceSpan {
  analysisText: string;
  safe: boolean;
  protectedSpans: SourceSpan[];
}

export interface LatexHeading extends SourceSpan {
  level: number;
  title: string;
}

export interface LatexDiagnostic {
  start: number;
  end: number;
  message: string;
}

export interface LatexParseResult {
  paragraphs: LatexParagraph[];
  headings: LatexHeading[];
  diagnostics: LatexDiagnostic[];
}

const headingLevels: Readonly<Record<string, number>> = {
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

const textCommands = new Set(["emph", "textbf", "textit", "texttt", "textrm", "textsf", "textsc", "underline"]);
const protectedCommands = new Set(["cite", "citep", "citet", "ref", "eqref", "pageref", "label"]);
const opaqueEnvironments = new Set(["verbatim", "verbatim*", "lstlisting", "minted"]);
const protectedSymbols = new Set(["\\", "%", "$", "#", "&", "_", "{", "}", " ", "~", "^"]);

function isLetter(char: string | undefined): boolean {
  return char !== undefined && ((char >= "a" && char <= "z") || (char >= "A" && char <= "Z"));
}

function commandAt(source: string, start: number): { name: string; end: number } {
  let end = start + 1;
  if (isLetter(source[end])) {
    while (isLetter(source[end])) end += 1;
  } else if (end < source.length) {
    end += 1;
  }
  return { name: source.slice(start + 1, end), end };
}

function skipComment(source: string, start: number, limit: number): number {
  const next = source.indexOf("\n", start);
  return next < 0 || next >= limit ? limit : next;
}

function groupEnd(source: string, start: number, limit: number, open: string, close: string): number | null {
  if (source[start] !== open) return null;
  let depth = 1;
  let braces = 0;
  let i = start + 1;
  while (i < limit) {
    const char = source[i];
    if (char === "\\") {
      i = commandAt(source, i).end;
      continue;
    }
    if (char === "%") {
      i = skipComment(source, i, limit);
      continue;
    }
    if (open === "[") {
      if (char === "{") braces += 1;
      if (char === "}") {
        if (braces === 0) return null;
        braces -= 1;
      }
    }
    if (braces === 0 && char === open) depth += 1;
    if (braces === 0 && char === close && --depth === 0) return i + 1;
    i += 1;
  }
  return null;
}

function argumentBounds(source: string, start: number, limit: number): { start: number; end: number } | null {
  let position = start;
  while (source[position] === "[" && position < limit) {
    const end = groupEnd(source, position, limit, "[", "]");
    if (end === null) return null;
    position = end;
  }
  const end = groupEnd(source, position, limit, "{", "}");
  return end === null ? null : { start: position, end };
}

function findDocumentBoundary(source: string, name: "begin" | "end", start: number): number | null {
  let i = start;
  let preambleDepth = 0;
  while (i < source.length) {
    if (source[i] === "%") {
      i = skipComment(source, i, source.length);
    } else if (source[i] === "\\") {
      const command = commandAt(source, i);
      if (command.name === name && (name === "end" || preambleDepth === 0) && source.slice(command.end, command.end + 10) === "{document}")
        return i;
      if (name === "end" && command.name === "begin") {
        const end = groupEnd(source, command.end, source.length, "{", "}");
        if (end === null) return null;
        const environment = source.slice(command.end + 1, end - 1);
        const closing = `\\end{${environment}}`;
        const closeAt = source.indexOf(closing, end);
        if (closeAt < 0) return null;
        const nested = source.indexOf("\\begin{", end);
        if (!opaqueEnvironments.has(environment) && nested >= 0 && nested < closeAt) return null;
        i = closeAt + closing.length;
        continue;
      }
      i = command.end;
    } else {
      if (name === "begin" && source[i] === "{") preambleDepth += 1;
      if (name === "begin" && source[i] === "}" && preambleDepth > 0) preambleDepth -= 1;
      i += 1;
    }
  }
  return null;
}

function withoutComments(source: string): string {
  let result = "";
  let i = 0;
  while (i < source.length) {
    if (source[i] === "\\") {
      const command = commandAt(source, i);
      result += source.slice(i, command.end);
      i = command.end;
    } else if (source[i] === "%") {
      i = skipComment(source, i, source.length);
    } else {
      result += source[i];
      i += 1;
    }
  }
  return result;
}

/** Parse a deliberately restricted, non-executing LaTeX subset. Offsets are UTF-16 in LF source. */
export function parseLatex(source: string): LatexParseResult {
  const result: LatexParseResult = { paragraphs: [], headings: [], diagnostics: [] };
  const diagnostic = (start: number, end: number, message: string): void => {
    result.diagnostics.push({ start, end, message });
  };
  if (source.includes("\r")) {
    diagnostic(0, source.length, "Source must use canonical LF line endings.");
    return result;
  }
  const begin = findDocumentBoundary(source, "begin", 0);
  if (begin === null) {
    diagnostic(0, source.length, "Document body is missing or incomplete.");
    return result;
  }
  const bodyStart = begin + "\\begin{document}".length;
  const bodyEnd = findDocumentBoundary(source, "end", bodyStart);
  if (bodyEnd === null) {
    diagnostic(bodyStart, source.length, "Document end is missing, incomplete, or inside an unsupported environment.");
    return result;
  }

  let start: number | null = null;
  let safe = true;
  let depth = 0;
  let spans: SourceSpan[] = [];
  const flush = (end: number): void => {
    if (start === null) return;
    let trimmedEnd = end;
    while (trimmedEnd > start && /\s/u.test(source[trimmedEnd - 1] ?? "")) trimmedEnd -= 1;
    const text = source.slice(start, trimmedEnd);
    if (withoutComments(text).trim()) {
      result.paragraphs.push({
        start,
        end: trimmedEnd,
        text,
        analysisText: withoutComments(text),
        safe: safe && depth === 0,
        protectedSpans: spans,
      });
    }
    start = null;
    safe = true;
    depth = 0;
    spans = [];
  };
  const protect = (from: number, to: number): void => {
    spans.push({ start: from, end: to, text: source.slice(from, to) });
  };
  let i = bodyStart;
  while (i < bodyEnd) {
    const char = source[i];
    if (char === "%") {
      i = skipComment(source, i, bodyEnd);
      continue;
    }
    if (char === "\n" && depth === 0) {
      let next = i + 1;
      while (source[next] === " " || source[next] === "\t") next += 1;
      if (source[next] === "\n") {
        flush(i);
        i = next + 1;
        continue;
      }
    }
    if (start === null && /\s/u.test(char ?? "")) {
      i += 1;
      continue;
    }
    if (char === "\\") {
      const command = commandAt(source, i);
      const level = headingLevels[command.name];
      if (depth === 0 && level !== undefined) {
        flush(i);
        const argsStart = source[command.end] === "*" ? command.end + 1 : command.end;
        const argument = argumentBounds(source, argsStart, bodyEnd);
        if (argument === null) {
          diagnostic(i, bodyEnd, "Incomplete heading.");
          break;
        }
        result.headings.push({
          start: i,
          end: argument.end,
          text: source.slice(i, argument.end),
          level,
          title: source.slice(argument.start + 1, argument.end - 1),
        });
        i = argument.end;
        continue;
      }
      if (depth === 0 && command.name === "par") {
        flush(i);
        i = command.end;
        continue;
      }
      if (depth === 0 && (command.name === "begin" || command.name === "end")) {
        flush(i);
        const end = groupEnd(source, command.end, bodyEnd, "{", "}");
        if (end === null) {
          diagnostic(i, bodyEnd, "Incomplete environment.");
          break;
        }
        const environment = source.slice(command.end + 1, end - 1);
        const closing = `\\end{${environment}}`;
        const closeAt = command.name === "begin" ? source.indexOf(closing, end) : -1;
        const next = closeAt >= 0 && closeAt < bodyEnd ? closeAt + closing.length : bodyEnd;
        diagnostic(i, next, `Unsupported environment: ${environment}.`);
        i = next;
        continue;
      }
      if (start === null) start = i;
      if (command.name === "(" || command.name === "[") {
        const closing = command.name === "(" ? ")" : "]";
        let end = command.end;
        let found = false;
        while (end < bodyEnd) {
          if (source[end] === "\\") {
            const next = commandAt(source, end);
            end = next.end;
            if (next.name === closing) {
              found = true;
              break;
            }
          } else end += 1;
        }
        if (!found) {
          safe = false;
          diagnostic(i, bodyEnd, "Incomplete mathematics.");
        } else protect(i, end);
        if (command.name === "[") {
          safe = false;
          diagnostic(i, end, "Display mathematics is not a supported prose target.");
        }
        i = end;
        continue;
      }
      if (protectedCommands.has(command.name)) {
        const argument = argumentBounds(source, command.end, bodyEnd);
        if (argument === null) {
          safe = false;
          diagnostic(i, command.end, "Incomplete protected command.");
          i = command.end;
        } else {
          protect(i, argument.end);
          i = argument.end;
        }
        continue;
      }
      if (protectedSymbols.has(command.name)) {
        protect(i, command.end);
        i = command.end;
        continue;
      }
      if (isLetter(command.name[0]) && !textCommands.has(command.name)) {
        safe = false;
        diagnostic(i, command.end, `Unknown command: \\${command.name}.`);
      } else if (textCommands.has(command.name) && source[command.end] !== "{") {
        safe = false;
        diagnostic(i, command.end, "Incomplete or unsupported formatting command.");
      } else if (!isLetter(command.name[0])) {
        safe = false;
        diagnostic(i, command.end, `Unknown control symbol: \\${command.name}.`);
      }
      i = command.end;
      continue;
    }
    if (start === null && !/\s/u.test(char ?? "")) start = i;
    if (char === "$") {
      const delimiter = source[i + 1] === "$" ? "$$" : "$";
      if (delimiter === "$$") {
        safe = false;
        diagnostic(i, i + 2, "Display mathematics is not a supported prose target.");
      }
      let end = i + delimiter.length;
      while (end < bodyEnd && !source.startsWith(delimiter, end)) {
        if (source[end] === "\\") end = commandAt(source, end).end;
        else end += 1;
      }
      if (end >= bodyEnd) {
        safe = false;
        diagnostic(i, bodyEnd, "Incomplete mathematics.");
        i = bodyEnd;
      } else {
        end += delimiter.length;
        protect(i, end);
        i = end;
      }
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      if (depth === 0) {
        safe = false;
        diagnostic(i, i + 1, "Unmatched closing brace.");
      } else depth -= 1;
    }
    i += 1;
  }
  if (depth !== 0) {
    safe = false;
    diagnostic(start ?? bodyEnd, bodyEnd, "Incomplete brace group.");
  }
  flush(bodyEnd);
  return result;
}

/** Validate a proposed paragraph without allowing it to create or alter protected syntax. */
export function validateProposalSyntax(original: LatexParagraph, proposal: string): { valid: boolean; reason?: string } {
  if (!original.safe) return { valid: false, reason: "The original paragraph is not a safe revision target." };
  const prefix = "\\begin{document}\n";
  const parsed = parseLatex(`${prefix}${proposal}\n\\end{document}`);
  const candidate = parsed.paragraphs[0];
  if (
    parsed.diagnostics.length !== 0 ||
    parsed.headings.length !== 0 ||
    parsed.paragraphs.length !== 1 ||
    !candidate?.safe ||
    candidate.text !== proposal.trim()
  ) {
    return { valid: false, reason: "The proposal is not one supported, complete prose paragraph." };
  }
  const originalSpans = original.protectedSpans.map((span) => span.text);
  const candidateSpans = candidate.protectedSpans.map((span) => span.text);
  if (originalSpans.length !== candidateSpans.length || originalSpans.some((span, i) => span !== candidateSpans[i])) {
    return { valid: false, reason: "The proposal changes or introduces protected LaTeX syntax." };
  }
  return { valid: true };
}
