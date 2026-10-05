// Checks WCAG contrast of --color-on-accent over --color-accent-fill and
// --color-accent-fill-hover for every accent × theme, reading src/styles/_themes.scss.
// Exits 1 if any pair is below 4.5:1 or a token is missing.
import { readFileSync } from 'node:fs';

const ACCENTS = ['violet', 'blue', 'cyan', 'emerald', 'amber', 'rose'];
const TOKENS = ['--color-accent-fill', '--color-accent-fill-hover', '--color-on-accent'];
const MIN = 4.5;

const scss = readFileSync(new URL('../src/styles/_themes.scss', import.meta.url), 'utf8');

// Bodies of every `{ ... }` block opened by `header`, in source (cascade) order, joined.
function block(src, header) {
  const bodies = [];
  for (let start = src.indexOf(header); start >= 0; start = src.indexOf(header, start + 1)) {
    let i = src.indexOf('{', start) + 1;
    const from = i;
    for (let depth = 1; depth > 0 && i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
    bodies.push(src.slice(from, i - 1));
  }
  return bodies.join('\n');
}

function tokens(body) {
  const flat = body.replace(/&\[[^\]]+\]\s*\{[^}]*\}/g, ''); // ignore nested accent blocks
  const out = {};
  for (const name of TOKENS) {
    const all = [...flat.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))];
    if (all.length) out[name] = all.at(-1)[1].trim(); // last declaration wins
  }
  return out;
}

const hex = (h) => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? [...s].map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};

// Supports #hex and `color-mix(in srgb, #a N%, #b)`.
function rgb(value) {
  const mix = value.match(/color-mix\(in srgb,\s*(#[0-9a-f]+)\s+([\d.]+)%,\s*(#[0-9a-f]+)\)/i);
  if (mix) {
    const p = Number(mix[2]) / 100;
    const a = hex(mix[1]);
    const b = hex(mix[3]);
    return a.map((v, i) => Math.round(v * p + b[i] * (1 - p)));
  }
  if (/^#[0-9a-f]{3,6}$/i.test(value)) return hex(value);
  throw new Error(`Unsupported colour value: ${value}`);
}

const luminance = (c) =>
  c
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

function contrast(a, b) {
  const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const lightBody = block(scss, "html[data-theme='light'] {");
const lightBase = tokens(lightBody);
let failed = false;

console.log('| theme | accent | fill | fill-hover | on-accent | normal | hover | result |');
console.log('|---|---|---|---|---|---|---|---|');
for (const theme of ['dark', 'light']) {
  for (const accent of ACCENTS) {
    const t =
      theme === 'dark'
        ? tokens(block(scss, `html[data-accent='${accent}'] {`))
        : { ...lightBase, ...tokens(block(lightBody, `&[data-accent='${accent}'] {`)) };
    const missing = TOKENS.filter((name) => !t[name]);
    if (missing.length) {
      failed = true;
      console.log(`| ${theme} | ${accent} | missing: ${missing.join(', ')} |`);
      continue;
    }
    const fg = t['--color-on-accent'];
    const normal = contrast(fg, t['--color-accent-fill']);
    const hover = contrast(fg, t['--color-accent-fill-hover']);
    const ok = normal >= MIN && hover >= MIN;
    if (!ok) failed = true;
    console.log(
      `| ${theme} | ${accent} | ${t['--color-accent-fill']} | ${t['--color-accent-fill-hover']} | ${fg} | ${normal.toFixed(2)}:1 | ${hover.toFixed(2)}:1 | ${ok ? 'PASS' : 'FAIL'} |`,
    );
  }
}

process.exit(failed ? 1 : 0);
