// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Several named byte sections in one file: a length, a JSON header of names and lengths, then the sections end to end.

const HEADER_LENGTH_BYTES = 4;

export function pack(sections: readonly (readonly [name: string, bytes: Uint8Array])[]): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify(sections.map(([name, bytes]) => [name, bytes.length])));
  const size = sections.reduce((n, [, bytes]) => n + bytes.length, HEADER_LENGTH_BYTES + header.length);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, header.length, true);
  out.set(header, HEADER_LENGTH_BYTES);
  let at = HEADER_LENGTH_BYTES + header.length;
  for (const [, bytes] of sections) {
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}

/** The sections by name, as views into `buf`. */
export function unpack(buf: ArrayBuffer): Map<string, Uint8Array> {
  if (buf.byteLength < HEADER_LENGTH_BYTES) throw new Error("a container shorter than its own header length");
  const headerLength = new DataView(buf).getUint32(0, true);
  const start = HEADER_LENGTH_BYTES + headerLength;
  if (start > buf.byteLength) throw new Error("a container cut off inside its header");
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, HEADER_LENGTH_BYTES, headerLength))) as [
    string,
    number,
  ][];
  const out = new Map<string, Uint8Array>();
  let at = start;
  for (const [name, length] of header) {
    if (at + length > buf.byteLength) throw new Error(`a container cut off inside ${name}`);
    out.set(name, new Uint8Array(buf, at, length));
    at += length;
  }
  return out;
}
