import React, { useMemo, useState } from 'react';

/**
 * ISO/IEC 18004 QR Code parameters for Error Correction Level L (Versions 1..25).
 * Each tuple: [ecCodewordsPerBlock, g1Blocks, g1DataCodewords, g2Blocks, g2DataCodewords, alignmentCenters[]]
 */
const QR_LEVEL_L_SPECS: Array<[number, number, number, number, number, number[]]> = [
  [7, 1, 19, 0, 0, []], // V1
  [10, 1, 34, 0, 0, [6, 18]], // V2
  [15, 1, 55, 0, 0, [6, 22]], // V3
  [20, 1, 80, 0, 0, [6, 26]], // V4
  [26, 1, 108, 0, 0, [6, 30]], // V5
  [18, 2, 68, 0, 0, [6, 34]], // V6
  [20, 2, 78, 0, 0, [6, 22, 38]], // V7
  [24, 2, 97, 0, 0, [6, 24, 42]], // V8
  [30, 2, 116, 0, 0, [6, 26, 46]], // V9
  [18, 2, 68, 2, 69, [6, 28, 50]], // V10
  [20, 4, 81, 0, 0, [6, 30, 54]], // V11
  [24, 2, 92, 2, 93, [6, 32, 58]], // V12
  [26, 4, 107, 0, 0, [6, 34, 62]], // V13
  [30, 3, 115, 1, 116, [6, 26, 46, 66]], // V14
  [22, 5, 87, 1, 88, [6, 26, 48, 70]], // V15
  [24, 5, 98, 1, 99, [6, 26, 50, 74]], // V16
  [28, 1, 107, 5, 108, [6, 30, 54, 78]], // V17
  [30, 5, 120, 1, 121, [6, 30, 56, 82]], // V18
  [28, 3, 113, 4, 114, [6, 30, 58, 86]], // V19
  [28, 3, 107, 5, 108, [6, 34, 62, 90]], // V20
  [28, 4, 116, 4, 117, [6, 28, 50, 72, 94]], // V21
  [28, 2, 111, 7, 112, [6, 26, 50, 74, 98]], // V22
  [30, 4, 121, 5, 122, [6, 30, 54, 78, 102]], // V23
  [30, 6, 117, 4, 118, [6, 28, 54, 80, 106]], // V24
  [26, 8, 106, 4, 107, [6, 32, 58, 84, 110]], // V25
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

export function encodeQrMatrix(text: string): boolean[][] | null {
  const utf8 = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= QR_LEVEL_L_SPECS.length; v++) {
    const [, g1B, g1D, g2B, g2D] = QR_LEVEL_L_SPECS[v - 1];
    const totalDataBytes = g1B * g1D + g2B * g2D;
    const headerBytes = v <= 9 ? 2 : 3;
    if (utf8.length + headerBytes <= totalDataBytes) {
      version = v;
      break;
    }
  }
  if (version === 0) return null;

  const [ecLen, g1B, g1D, g2B, g2D, alignCenters] = QR_LEVEL_L_SPECS[version - 1];
  const totalDataBytes = g1B * g1D + g2B * g2D;
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  // Byte mode indicator (0100) + character count
  pushBits(0b0100, 4);
  pushBits(utf8.length, version <= 9 ? 8 : 16);
  for (let i = 0; i < utf8.length; i++) pushBits(utf8[i], 8);

  const maxBits = totalDataBytes * 8;
  const term = Math.min(4, maxBits - bits.length);
  pushBits(0, term);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(totalDataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    dataBytes[i] = b;
  }
  let padIdx = 0;
  for (let i = bits.length / 8; i < totalDataBytes; i++) {
    dataBytes[i] = padIdx++ % 2 === 0 ? 0xec : 0x11;
  }

  // Split into blocks and compute Reed-Solomon EC codewords
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < g1B; i++) {
    const block = dataBytes.subarray(offset, offset + g1D);
    offset += g1D;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecLen));
  }
  for (let i = 0; i < g2B; i++) {
    const block = dataBytes.subarray(offset, offset + g2D);
    offset += g2D;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecLen));
  }

  const interleaved: number[] = [];
  const maxDataLen = Math.max(g1D, g2D);
  for (let col = 0; col < maxDataLen; col++) {
    for (const block of dataBlocks) {
      if (col < block.length) interleaved.push(block[col]);
    }
  }
  for (let col = 0; col < ecLen; col++) {
    for (const block of ecBlocks) {
      interleaved.push(block[col]);
    }
  }

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = dark;
    reserved[r][c] = true;
  };

  // Finder patterns + separators
  const placeFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (onBorder || inCore));
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  for (const r of alignCenters) {
    for (const c of alignCenters) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 8) || (r >= size - 8 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(r + dr, c + dc, dark);
        }
      }
    }
  }

  // Reserve format info areas + dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunctionModule(8, i, false);
      setFunctionModule(i, 8, false);
    }
    if (i < 8) {
      setFunctionModule(8, size - 1 - i, false);
      setFunctionModule(size - 1 - i, 8, false);
    }
  }
  setFunctionModule(size - 8, 8, true);

  // Version info (V7+)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunctionModule(b, a, bit);
      setFunctionModule(a, b, bit);
    }
  }

  // Place interleaved data bits with Mask 0 ((r + c) % 2 === 0)
  let bitIdx = 0;
  const totalBits = interleaved.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const upward = ((right + 1) & 2) === 0;
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (reserved[r][c]) continue;
        let dark = false;
        if (bitIdx < totalBits) {
          dark = ((interleaved[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
          bitIdx++;
        }
        if ((r + c) % 2 === 0) dark = !dark;
        modules[r][c] = dark;
      }
    }
  }

  // Format information for Level L (01) + Mask 0 (000) -> 0b01000 -> BCH & XOR mask = 0x77c4
  const formatBits = 0x77c4;
  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, ((formatBits >>> i) & 1) === 1);
  setFunctionModule(8, 7, ((formatBits >>> 6) & 1) === 1);
  setFunctionModule(8, 8, ((formatBits >>> 7) & 1) === 1);
  setFunctionModule(7, 8, ((formatBits >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, ((formatBits >>> i) & 1) === 1);
  for (let i = 0; i < 8; i++) setFunctionModule(8, size - 1 - i, ((formatBits >>> i) & 1) === 1);
  for (let i = 8; i < 15; i++) setFunctionModule(size - 15 + i, 8, ((formatBits >>> i) & 1) === 1);

  return modules;
}

export const QrCodeSvg: React.FC<{ value: string; size?: number }> = ({ value, size = 168 }) => {
  const matrix = useMemo(() => encodeQrMatrix(value), [value]);
  if (!matrix) {
    return (
      <div className="text-xs text-slate-400">
        Payload is too large for an inline QR code ({value.length} chars); use Copy Link or Copy Markdown.
      </div>
    );
  }
  const quiet = 3;
  const total = matrix.length + quiet * 2;
  const pathParts: string[] = [];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix.length; c++) {
      if (matrix[r][c]) {
        pathParts.push(`M${c + quiet},${r + quiet}h1v1h-1z`);
      }
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      className="rounded-lg bg-white p-1.5 shadow-inner"
      role="img"
      aria-label="QR Code for webring capability link"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={pathParts.join('')} fill="#0f172a" />
    </svg>
  );
};

export const WebringShareBlock: React.FC<{
  uri: string;
  markdownLabel: string;
  onStatus?: (message: string) => void;
}> = ({ uri, markdownLabel, onStatus }) => {
  const [showQr, setShowQr] = useState(false);
  const [copiedKind, setCopiedKind] = useState<'uri' | 'md' | null>(null);

  const copyText = (text: string, kind: 'uri' | 'md', statusText: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKind(kind);
    onStatus?.(statusText);
    setTimeout(() => setCopiedKind((prev) => (prev === kind ? null : prev)), 2000);
  };

  const markdownSnippet = `[${markdownLabel}](${uri})`;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => copyText(uri, 'uri', 'Copied webring:// link to clipboard.')}
          className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
        >
          {copiedKind === 'uri' ? 'Copied URI!' : 'Copy Link'}
        </button>
        <button
          type="button"
          onClick={() => copyText(markdownSnippet, 'md', 'Copied Markdown link snippet to clipboard.')}
          className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          {copiedKind === 'md' ? 'Copied Markdown!' : 'Copy Markdown'}
        </button>
        <button
          type="button"
          onClick={() => setShowQr((v) => !v)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          {showQr ? 'Hide QR Code' : 'Show QR Code'}
        </button>
      </div>
      {showQr && (
        <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/80 p-2.5">
          <QrCodeSvg value={uri} size={156} />
          <div className="text-[11px] leading-relaxed text-slate-400">
            <div className="font-medium text-slate-200">Out-of-Band Capability Link</div>
            <div>
              Scan or paste into any DM, email, or forum post. Clicking or pasting this signed{' '}
              <code className="text-indigo-300">webring://</code> URI opens it directly in Webring Studio.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
