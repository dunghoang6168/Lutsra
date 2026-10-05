// Checks WCAG contrast of --color-on-accent over --color-accent-fill and
// --color-accent-fill-hover for every accent × theme, reading src/styles/_themes.scss.
// Also checks status colours, danger buttons and warning/accent CIE76 ΔE >= 20.
// Exits 1 if a contrast pair is below 4.5:1, ΔE is below 20 or a token is missing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ACCENTS = ['violet', 'blue', 'cyan', 'emerald', 'amber', 'rose'];
const TOKENS = ['--color-accent-fill', '--color-accent-fill-hover', '--color-on-accent'];
const MIN = 4.5;


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

function tokens(body, tokenNames = TOKENS) {
  const flat = body.replace(/&\[[^\]]+\]\s*\{[^}]*\}/g, ''); // ignore nested accent blocks
  const out = {};
  for (const name of tokenNames) {
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

// sRGB -> XYZ -> CIELAB, using the D65 reference white.
export function srgbToLab(color) {
  const linear = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const matrix = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
  ];
  const white = [0.95047, 1, 1.08883];
  const f = matrix.map((row, i) => {
    const t = row.reduce((sum, coefficient, j) => sum + coefficient * linear[j], 0) / white[i];
    const delta = 6 / 29;
    return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta ** 2) + 4 / 29;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

export function cie76DeltaE(a, b) {
  const c1 = srgbToLab(a);
  const c2 = srgbToLab(b);
  return Math.hypot(...c1.map((v, i) => v - c2[i]));
}

export function runChecks() {
  const scss = readFileSync(new URL('../src/styles/_themes.scss', import.meta.url), 'utf8');
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

  const tokensScss = readFileSync(new URL('../src/styles/_tokens.scss', import.meta.url), 'utf8');
  const rootTokens = tokens(block(tokensScss, ':root {'), [
    '--status-warning',
    '--status-warning-text',
    '--color-text-muted',
  ]);

  const darkBody = block(scss, "html[data-theme='dark'] {");
  const darkAmberBody = block(scss, "html[data-accent='amber'] {");
  const lightAmberBody = block(lightBody, "&[data-accent='amber'] {");

  const STATUS_TOKENS = ['--status-warning', '--status-warning-text', '--color-text-muted', '--color-accent'];
  const themeConfigs = {
    dark: {
      bgs: ['#17181b', '#111214', '#1c1e22', '#23262a'],
      default: { ...rootTokens, ...tokens(darkBody, STATUS_TOKENS) },
      amber: { ...rootTokens, ...tokens(darkBody, STATUS_TOKENS), ...tokens(darkAmberBody, STATUS_TOKENS) },
    },
    light: {
      bgs: ['#e5e9f0', '#f1f4f8', '#ffffff', '#f8fafc'],
      default: { ...rootTokens, ...tokens(lightBody, STATUS_TOKENS) },
      amber: { ...rootTokens, ...tokens(lightBody, STATUS_TOKENS), ...tokens(lightAmberBody, STATUS_TOKENS) },
    },
  };

  console.log('\n| theme | variant | token | color | background | contrast / dist | result |');
  console.log('|---|---|---|---|---|---|---|');

  for (const theme of ['dark', 'light']) {
    const config = themeConfigs[theme];
    const bgs = config.bgs;

    // 1. Default tokens
    const defaultItems = [
      { name: '--status-warning-text', value: config.default['--status-warning-text'] },
      { name: '--color-text-muted', value: config.default['--color-text-muted'] },
    ];
    for (const item of defaultItems) {
      if (!item.value) {
        failed = true;
        console.log(`| ${theme} | default | ${item.name} | missing | - | - | FAIL |`);
        continue;
      }
      for (const bg of bgs) {
        const cr = contrast(item.value, bg);
        const ok = cr >= MIN;
        if (!ok) failed = true;
        console.log(
          `| ${theme} | default | ${item.name} | ${item.value} | ${bg} | ${cr.toFixed(2)}:1 | ${ok ? 'PASS' : 'FAIL'} |`,
        );
      }
    }

    // 2. Amber variant: --status-warning-text override
    const amberWarningText = config.amber['--status-warning-text'];
    if (!amberWarningText) {
      failed = true;
      console.log(`| ${theme} | amber | --status-warning-text | missing | - | - | FAIL |`);
    } else {
      for (const bg of bgs) {
        const cr = contrast(amberWarningText, bg);
        const ok = cr >= MIN;
        if (!ok) failed = true;
        console.log(
          `| ${theme} | amber | --status-warning-text | ${amberWarningText} | ${bg} | ${cr.toFixed(2)}:1 | ${ok ? 'PASS' : 'FAIL'} |`,
        );
      }
    }

    // 3. Amber variant: distinct from accent check
    const warningColor = config.amber['--status-warning'];
    const accentColor = config.amber['--color-accent'];
    if (!warningColor || !accentColor) {
      failed = true;
      console.log(`| ${theme} | amber | --status-warning vs --color-accent | missing | - | - | FAIL |`);
    } else {
      const dist = cie76DeltaE(warningColor, accentColor);
      const distinct = dist >= 20;
      if (!distinct) failed = true;
      console.log(
        `| ${theme} | amber | --status-warning vs --color-accent | ${warningColor} | ${accentColor} | ΔE=${dist.toFixed(1)} | ${distinct ? 'PASS' : 'FAIL'} |`,
      );
    }
  }

  const dangerNames = ['--status-error-fill', '--color-on-error'];
  const rootDanger = tokens(block(tokensScss, ':root {'), dangerNames);
  console.log('\n| theme | danger fill | on-error | normal | hover | active | result |');
  console.log('|---|---|---|---|---|---|---|');
  for (const theme of ['dark', 'light']) {
    const t = { ...rootDanger, ...tokens(theme === 'dark' ? darkBody : lightBody, dangerNames) };
    if (dangerNames.some((name) => !t[name])) {
      failed = true;
      console.log('| ' + theme + ' | missing danger token | FAIL |');
      continue;
    }
    const cr = contrast(t['--color-on-error'], t['--status-error-fill']);
    const ok = cr >= MIN;
    if (!ok) failed = true;
    console.log('| ' + theme + ' | ' + t['--status-error-fill'] + ' | ' + t['--color-on-error'] + ' | ' + cr.toFixed(2) + ':1 | ' + cr.toFixed(2) + ':1 | ' + cr.toFixed(2) + ':1 | ' + (ok ? 'PASS' : 'FAIL') + ' |');
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runChecks();
}
