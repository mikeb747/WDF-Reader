/**
 * Pure TypeScript text decoding utilities for Windows Registry (.reg / .rrg) files.
 *
 * Handles UTF-16LE (standard Regedit 5.00 export), UTF-16BE, UTF-8 with BOM,
 * and plain UTF-8 without depending on Node Buffer or browser TextDecoder.
 */

import type { DecodedRegistrySource, DetectedTextEncoding, RegistryInput } from './types';

function decodeUtf16Bytes(bytes: Uint8Array, littleEndian: boolean, startOffset: number): string {
  const chunkSize = 0x4000;
  const parts: string[] = [];
  const end = bytes.length - ((bytes.length - startOffset) % 2);

  for (let i = startOffset; i < end; i += chunkSize * 2) {
    const chunkEnd = Math.min(end, i + chunkSize * 2);
    const codeUnits: number[] = [];
    for (let j = i; j < chunkEnd; j += 2) {
      const lo = littleEndian ? bytes[j] : bytes[j + 1];
      const hi = littleEndian ? bytes[j + 1] : bytes[j];
      codeUnits.push((hi << 8) | lo);
    }
    parts.push(String.fromCharCode(...codeUnits));
  }

  return parts.join('');
}

function decodeUtf8Bytes(bytes: Uint8Array, startOffset: number): string {
  const parts: string[] = [];
  let codeUnits: number[] = [];

  const flush = (): void => {
    if (codeUnits.length > 0) {
      parts.push(String.fromCharCode(...codeUnits));
      codeUnits = [];
    }
  };

  let i = startOffset;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      codeUnits.push(b0);
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      const b1 = bytes[i + 1];
      if ((b1 & 0xc0) === 0x80) {
        codeUnits.push(((b0 & 0x1f) << 6) | (b1 & 0x3f));
        i += 2;
      } else {
        codeUnits.push(0xfffd);
        i += 1;
      }
    } else if ((b0 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80) {
        codeUnits.push(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
        i += 3;
      } else {
        codeUnits.push(0xfffd);
        i += 1;
      }
    } else if ((b0 & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const b3 = bytes[i + 3];
      if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80 && (b3 & 0xc0) === 0x80) {
        const cp =
          (((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)) -
          0x10000;
        codeUnits.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        i += 4;
      } else {
        codeUnits.push(0xfffd);
        i += 1;
      }
    } else {
      codeUnits.push(0xfffd);
      i += 1;
    }

    if (codeUnits.length >= 0x4000) {
      flush();
    }
  }

  flush();
  return parts.join('');
}

function looksLikeUtf16LeWithoutBom(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes.length % 2 !== 0) {
    return false;
  }
  const sampleLen = Math.min(bytes.length, 64);
  let nullOddCount = 0;
  let asciiEvenCount = 0;
  let pairs = 0;
  for (let i = 0; i + 1 < sampleLen; i += 2) {
    pairs += 1;
    if (bytes[i + 1] === 0x00) {
      nullOddCount += 1;
    }
    if (bytes[i] >= 0x09 && bytes[i] <= 0x7e) {
      asciiEvenCount += 1;
    }
  }
  return pairs >= 2 && nullOddCount / pairs >= 0.7 && asciiEvenCount / pairs >= 0.7;
}

/**
 * Decodes a string, Uint8Array, or ArrayBuffer into normalized text and
 * reports the detected encoding.
 */
export function decodeRegistryInput(input: RegistryInput): DecodedRegistrySource {
  if (typeof input === 'string') {
    const hasBom = input.length > 0 && input.charCodeAt(0) === 0xfeff;
    return {
      text: hasBom ? input.slice(1) : input,
      encoding: hasBom ? 'utf-8-bom' : 'string',
      byteLength: input.length,
    };
  }

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const byteLength = bytes.length;

  if (byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: decodeUtf16Bytes(bytes, true, 2),
      encoding: 'utf-16le-bom',
      byteLength,
    };
  }

  if (byteLength >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: decodeUtf16Bytes(bytes, false, 2),
      encoding: 'utf-16be-bom',
      byteLength,
    };
  }

  if (byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: decodeUtf8Bytes(bytes, 3),
      encoding: 'utf-8-bom',
      byteLength,
    };
  }

  if (looksLikeUtf16LeWithoutBom(bytes)) {
    return {
      text: decodeUtf16Bytes(bytes, true, 0),
      encoding: 'utf-16le-inferred',
      byteLength,
    };
  }

  const encoding: DetectedTextEncoding = 'utf-8';
  return {
    text: decodeUtf8Bytes(bytes, 0),
    encoding,
    byteLength,
  };
}

/**
 * Decodes a UTF-16LE byte array (such as `REG_EXPAND_SZ` or `REG_MULTI_SZ`)
 * into a string without stripping internal NUL delimiters.
 */
export function decodeUtf16LeRawBytes(bytes: readonly number[]): string {
  const arr = new Uint8Array(bytes);
  return decodeUtf16Bytes(arr, true, 0);
}
