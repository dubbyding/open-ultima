import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, '../..');

export function concatUint8Arrays(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function buildBluetrumTlvStream(entries: readonly [number, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [tag, value] of entries) {
    const tlv = new Uint8Array(2 + value.length);
    tlv[0] = tag & 0xff;
    tlv[1] = value.length & 0xff;
    tlv.set(value, 2);
    parts.push(tlv);
  }
  return concatUint8Arrays(parts);
}

export function listTsFilesRecursive(relDir: string): string[] {
  const absDir = path.join(REPO_ROOT, relDir);
  const collected: string[] = [];
  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        collected.push(path.relative(REPO_ROOT, fullPath).replace(/\\/g, '/'));
      }
    }
  };
  walk(absDir);
  return collected;
}

export function resolveSourceFiles(relTargets: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rel of relTargets) {
    const abs = path.join(REPO_ROOT, rel);
    const stat = fs.statSync(abs);
    const files = stat.isDirectory() ? listTsFilesRecursive(rel) : [rel.replace(/\\/g, '/')];
    for (const file of files) {
      if (!seen.has(file)) {
        seen.add(file);
        out.push(file);
      }
    }
  }
  return out;
}

export function readCombinedText(relTargets: readonly string[]): string {
  return resolveSourceFiles(relTargets)
    .map((rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'))
    .join('\n');
}
