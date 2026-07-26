export type ZipEntry = {
  name: string;
  bytes: Uint8Array;
};

const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const MAX_ZIP_ENTRIES = 1_000;
const MAX_UINT32 = 0xffffffff;

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = createCrcTable();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function dosTimestamp(date: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  return {
    date:
      ((year - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
  };
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? "-" : character;
  }).join("");
}

function safeEntryName(value: string, index: number): string {
  const normalized = replaceControlCharacters(
    value
      .normalize("NFKC")
      .replaceAll("\\", "/")
      .split("/")
      .filter((part) => part && part !== "." && part !== "..")
      .join("-"),
  ).slice(0, 180);
  return normalized || `document-${index + 1}.pdf`;
}

function concat(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/**
 * Creates a standards-compliant ZIP archive using the STORE method.
 * PDF files are already compressed internally, so avoiding a second
 * compression pass is both faster and less memory intensive in the browser.
 */
export function createStoredZip(
  entries: readonly ZipEntry[],
  modifiedAt = new Date(),
): Uint8Array {
  if (entries.length === 0 || entries.length > MAX_ZIP_ENTRIES) {
    throw new Error("The ZIP entry count is outside the supported range.");
  }

  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  const timestamp = dosTimestamp(modifiedAt);
  let localOffset = 0;
  let centralLength = 0;

  entries.forEach((entry, index) => {
    if (entry.bytes.byteLength > MAX_UINT32) {
      throw new Error("A ZIP entry exceeds the supported 4 GB size.");
    }

    const name = encoder.encode(safeEntryName(entry.name, index));
    if (name.byteLength > 0xffff) {
      throw new Error("A ZIP entry name is too long.");
    }

    const checksum = crc32(entry.bytes);
    const localHeader = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, UTF8_FLAG);
    writeUint16(localView, 8, STORE_METHOD);
    writeUint16(localView, 10, timestamp.time);
    writeUint16(localView, 12, timestamp.date);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, entry.bytes.byteLength);
    writeUint32(localView, 22, entry.bytes.byteLength);
    writeUint16(localView, 26, name.byteLength);
    writeUint16(localView, 28, 0);
    localHeader.set(name, 30);
    localChunks.push(localHeader, entry.bytes);

    const centralHeader = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, UTF8_FLAG);
    writeUint16(centralView, 10, STORE_METHOD);
    writeUint16(centralView, 12, timestamp.time);
    writeUint16(centralView, 14, timestamp.date);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, entry.bytes.byteLength);
    writeUint32(centralView, 24, entry.bytes.byteLength);
    writeUint16(centralView, 28, name.byteLength);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    centralHeader.set(name, 46);
    centralChunks.push(centralHeader);
    centralLength += centralHeader.byteLength;

    localOffset += localHeader.byteLength + entry.bytes.byteLength;
    if (localOffset > MAX_UINT32) {
      throw new Error("The ZIP archive exceeds the supported 4 GB size.");
    }
  });

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralLength);
  writeUint32(endView, 16, localOffset);
  writeUint16(endView, 20, 0);

  return concat(
    [...localChunks, ...centralChunks, end],
    localOffset + centralLength + end.byteLength,
  );
}
