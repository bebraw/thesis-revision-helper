import { describe, expect, it } from "vitest";
import { decodeSource, encodeSource } from "./source-codec";

describe("LaTeX source encoding", () => {
  it("retains a UTF-8 BOM and CRLF while editing non-ASCII text", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("A😀\r\nB\r\n")]);
    const source = decodeSource(bytes);
    expect(source.text).toBe("A😀\nB\n");
    expect(encodeSource(source, "A😀\nC\n")).toEqual(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("A😀\r\nC\r\n")]));
  });

  it("keeps unedited mixed newlines byte-identical and rejects ambiguous edited writes", () => {
    const bytes = new TextEncoder().encode("one\r\ntwo\nthree\r");
    const source = decodeSource(bytes);
    expect(encodeSource(source, source.text)).toEqual(bytes);
    expect(() => encodeSource(source, "changed\n")).toThrow("mixed newline");
  });

  it("preserves LF and bare CR newline conventions", () => {
    for (const newline of ["\n", "\r"]) {
      const source = decodeSource(new TextEncoder().encode(`one${newline}two`));
      expect(encodeSource(source, "a\nb")).toEqual(new TextEncoder().encode(`a${newline}b`));
    }
  });

  it("rejects invalid UTF-8 instead of replacing characters", () => {
    expect(() => decodeSource(new Uint8Array([0xc3, 0x28]))).toThrow("UTF-8");
  });

  it("keeps a second BOM as content and rejects unpaired surrogate edits", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 65]);
    const source = decodeSource(bytes);
    expect(source.text).toBe("\ufeffA");
    expect(encodeSource(source, "\ufeffB")).toEqual(new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 66]));
    expect(() => encodeSource(source, "\ud800")).toThrow("surrogate");
  });
});
