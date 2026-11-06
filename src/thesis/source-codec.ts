export interface DecodedSource {
  text: string;
  newline: "lf" | "crlf" | "cr" | "mixed";
  bom: boolean;
  originalBytes: Uint8Array;
}

/** Decode source without silently replacing invalid UTF-8. Offsets in text are UTF-16. */
export function decodeSource(bytes: Uint8Array): DecodedSource {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
  } catch {
    throw new Error("Source is not valid UTF-8");
  }
  const endings = new Set<string>();
  for (let index = 0; index < decoded.length; index++) {
    if (decoded[index] === "\r") {
      if (decoded[index + 1] === "\n") {
        endings.add("crlf");
        index++;
      } else endings.add("cr");
    } else if (decoded[index] === "\n") endings.add("lf");
  }
  const newline = endings.size > 1 ? "mixed" : endings.has("crlf") ? "crlf" : endings.has("cr") ? "cr" : "lf";
  return { text: decoded.replace(/\r\n?|\n/g, "\n"), newline, bom, originalBytes: bytes.slice() };
}

/** Retain exact unedited bytes and restore the source's original newline convention. */
export function encodeSource(source: DecodedSource, text: string): Uint8Array {
  if (text === source.text) return source.originalBytes.slice();
  if (source.newline === "mixed") throw new Error("Cannot safely edit a file with mixed newline conventions");
  if (text.includes("\r")) throw new Error("Editor text must use LF newlines");
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("Editor text contains an unpaired surrogate");
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error("Editor text contains an unpaired surrogate");
  }
  const separator = source.newline === "crlf" ? "\r\n" : source.newline === "cr" ? "\r" : "\n";
  const encoded = new TextEncoder().encode(text.replace(/\n/g, separator));
  if (!source.bom) return encoded;
  const result = new Uint8Array(encoded.length + 3);
  result.set([0xef, 0xbb, 0xbf]);
  result.set(encoded, 3);
  return result;
}
