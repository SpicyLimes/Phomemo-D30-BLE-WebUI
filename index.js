/*!
Text tab add-on vs. odensc:
- Custom text renderer (Text tab only) with a fixed preview transform.
- Consistent letter-spacing (kerning-preserving), alignment, line height, margin,
  and style toggles (Bold/Italic/Underline/ALL CAPS).
- Font picker with web & system fonts; dropdown options and labels show their style.
- Numeric inputs accept dot or comma; drawing is scheduled after index.core.js.
*/

import './index.core.js';

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- Orientation config ---------- */
const ROTATION = 'cw90'; // change to 'ccw90' to invert

/* ---------- Fonts (includes common system faces) ---------- */
const FONT_MAP = {
  'Inter': '"Inter", system-ui, Arial, Helvetica, sans-serif',
  'Libre Franklin': '"Libre Franklin", "Franklin Gothic Medium", Arial, Helvetica, sans-serif',
  'Oswald': '"Oswald", "DIN Alternate", "DIN Condensed", Arial, Helvetica, sans-serif',
  'Staatliches': '"Staatliches", "Bahnschrift", Arial, Helvetica, sans-serif',
  'Fredoka': '"Fredoka", "Arial Rounded MT", Arial, sans-serif',
  'Baloo 2': '"Baloo 2", "Comic Sans MS", cursive',
  'Libre Baskerville': '"Libre Baskerville", "Times New Roman", Times, serif',
  'JetBrains Mono': '"JetBrains Mono", "Courier New", Courier, monospace',
  'Alex Brush': '"Alex Brush", "Brush Script MT", cursive',
  'Caveat': '"Caveat", "Bradley Hand", cursive',
  'Stardos Stencil': '"Stardos Stencil", "Stencil", Impact, sans-serif',
  'Arial': 'Arial, Helvetica, sans-serif',
  'Times New Roman': '"Times New Roman", Times, serif',
  'Courier New': '"Courier New", Courier, monospace',
};

/* ---------- Utils ---------- */
function isActivePane(id) {
  const el = document.getElementById(id);
  return el?.classList.contains('active') && el?.classList.contains('show');
}

// Remove CSS transforms on the preview chain (avoid flips)
function neutralizeTransformsForTextTabDeep() {
  if (!isActivePane('nav-text')) return;
  const canvas = $('#canvas'); if (!canvas) return;
  let node = canvas;
  for (let i = 0; i < 10 && node; i++) {
    if (node.dataset.prevTransform === undefined) node.dataset.prevTransform = node.style.transform || '';
    node.style.transform = 'none';
    if (node.id === 'nav-text' || node.classList?.contains('tab-pane')) break;
    node = node.parentElement;
  }
}
function restoreTransformsDeep() {
  const canvas = $('#canvas'); if (!canvas) return;
  let node = canvas;
  for (let i = 0; i < 10 && node; i++) {
    if (node.dataset.prevTransform !== undefined) {
      node.style.transform = node.dataset.prevTransform;
      delete node.dataset.prevTransform;
    }
    if (node.id === 'nav-text' || node.classList?.contains('tab-pane')) break;
    node = node.parentElement;
  }
}

// Parse numbers (accepts comma or dot)
const num = (v, dflt=0) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : dflt;
};

/* ---------- Letter-spacing with preserved kerning ---------- */
function drawTextKerningSpacing(ctx, text, x, y, align, letterSpacing) {
  const n = text.length;
  if (n === 0) return { startX: x, totalW: 0 };

  // No letter-spacing: draw once (best kerning)
  if (!letterSpacing) {
    const w = ctx.measureText(text).width;
    let left = x;
    if (align === 'center') left = x - w / 2;
    else if (align === 'right') left = x - w;

    const prev = ctx.textAlign;
    ctx.textAlign = 'left';
    ctx.fillText(text, left, y);
    ctx.textAlign = prev;

    return { startX: left, totalW: w };
  }

  // With letter-spacing: left-based per-glyph drawing; kerning from partial widths
  const baseW  = ctx.measureText(text).width;               // natural width incl. kerning
  const totalW = baseW + (n - 1) * letterSpacing;

  let left = x;
  if (align === 'center') left = x - totalW / 2;
  else if (align === 'right') left = x - totalW;

  const prev = ctx.textAlign;
  ctx.textAlign = 'left';

  for (let i = 0; i < n; i++) {
    const subW = ctx.measureText(text.slice(0, i)).width;   // kerning up to i-1
    const gx   = left + subW + (i * letterSpacing);
    ctx.fillText(text[i], gx, y);
  }

  ctx.textAlign = prev;
  return { startX: left, totalW };
}

/* ---------- Styled labels + per-option font preview ---------- */
function styleControlsStatic() {
  // Labels always show their effect
  const map = [
    ['advBold',      (l)=> l.style.fontWeight     = '700' ],
    ['advItalic',    (l)=> l.style.fontStyle      = 'italic' ],
    ['advUnderline', (l)=> l.style.textDecoration = 'underline' ],
    ['advUpper',     (l)=> { l.style.textTransform = 'uppercase'; l.style.letterSpacing='0.04em'; }],
  ];
  for (const [id, fn] of map) {
    const lbl = document.querySelector(`label[for="${id}"]`);
    if (lbl) fn(lbl);
  }

  // Each <option> uses its own font (not the <select> itself)
  const sel = $('#advFontFamily');
  if (sel) {
    sel.style.fontFamily = '';
    Array.from(sel.options).forEach(opt => {
      const fam = FONT_MAP[opt.text] || '';
      if (fam) opt.style.fontFamily = fam;
    });
  }
}

/* ---------- Draw text horizontally on an offscreen canvas ---------- */
function drawTextToOffscreen(width, height, params) {
  const off = document.createElement('canvas');
  off.width = width; off.height = height;
  const ctx = off.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Font
  const weight = params.isBold ? '700' : '400';
  const style  = params.isItalic ? 'italic' : 'normal';
  ctx.font = `${style} ${weight} ${params.fontSize}px ${params.family}`;
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';

  // Horizontal x by alignment
  let x;
  if (params.align === 'left')       { ctx.textAlign = 'left';  x = params.margin; }
  else if (params.align === 'right') { ctx.textAlign = 'right'; x = width - params.margin; }
  else                               { ctx.textAlign = 'center';x = width / 2; }

  const lines  = params.text.split(/\r?\n/);
  const lhPx   = params.fontSize * params.lineH;
  const totalH = lhPx * (lines.length - 1);
  const yStart = height / 2 - totalH / 2;

  // Underline
  const underlineThickness = Math.max(1, Math.round(params.fontSize / 9));
  const underlineExtra     = Math.max(params.fontSize * 0.35, 4);

  for (let i = 0; i < lines.length; i++) {
    const y = yStart + i * lhPx;
    const { startX, totalW } = drawTextKerningSpacing(ctx, lines[i], x, y, ctx.textAlign, params.letterSpacing);

    if (params.isUnderline) {
      const m = ctx.measureText(lines[i]);
      const descent = (m.actualBoundingBoxDescent ?? params.fontSize * 0.2);
      const uy = y + descent + underlineExtra;
      ctx.save();
      ctx.beginPath();
      ctx.lineWidth = underlineThickness;
      ctx.strokeStyle = '#000';
      ctx.moveTo(Math.round(startX), Math.round(uy));
      ctx.lineTo(Math.round(startX + totalW), Math.round(uy));
      ctx.stroke();
      ctx.restore();
    }
  }

  return off;
}

/* ---------- Main draw (blit offscreen -> main with rotation) ---------- */
function drawAdvancedText() {
  if (!isActivePane('nav-text')) return;

  neutralizeTransformsForTextTabDeep();

  const canvas = $('#canvas'); if (!canvas) return;
  const ctxMain = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height; if (!W || !H) return;

  // UI
  const fontSize = Math.max(8, Math.min(96, parseInt($('#inputFontSize')?.value || '32', 10)));
  const uiFamily = $('#advFontFamily')?.value || 'Inter';
  const family   = FONT_MAP[uiFamily] || `"${uiFamily}", sans-serif`;
  const align    = $('#advAlign')?.value || 'center';
  const lineH    = Math.max(1, Math.min(2, num($('#advLineHeight')?.value, 1.2)));
  const margin   = Math.max(0, Math.min(30, parseInt($('#advMargin')?.value || '6', 10)));
  const isBold   = !!$('#advBold')?.checked;
  const isItalic = !!$('#advItalic')?.checked;
  const isUpper  = !!$('#advUpper')?.checked;
  const isUnderline   = !!$('#advUnderline')?.checked;
  const letterSpacing = Math.max(0, num($('#advLetterSpacing')?.value, 0));

  let text = ($('#inputText')?.value || '').toString();
  if (isUpper) text = text.toUpperCase();

  // Draw horizontally for a label of size (labelW x labelH)
  const labelW = H;
  const labelH = W;

  const off = drawTextToOffscreen(labelW, labelH, {
    text, fontSize, family, align, lineH, margin, isBold, isItalic, isUnderline, letterSpacing
  });

  // Clear main and blit with rotation
  ctxMain.save();
  ctxMain.setTransform(1, 0, 0, 1, 0, 0);
  ctxMain.fillStyle = '#ffffff';
  ctxMain.fillRect(0, 0, W, H);

  if (ROTATION === 'cw90') {
    ctxMain.translate(W, 0);
    ctxMain.rotate(Math.PI / 2);
    ctxMain.drawImage(off, 0, 0, labelW, labelH);
  } else {
    ctxMain.translate(0, H);
    ctxMain.rotate(-Math.PI / 2);
    ctxMain.drawImage(off, 0, 0, labelW, labelH);
  }

  ctxMain.restore();

  styleControlsStatic();
}

/* ---------- Schedule so we draw after core ---------- */
function scheduleTextRedraw(frames = 6) {
  let n = frames;
  const tick = () => {
    if (n-- <= 0) return;
    requestAnimationFrame(() => { drawAdvancedText(); setTimeout(tick, 0); });
  };
  tick();
}

/* ---------- Wiring ---------- */
function wire() {
  [
    '#inputText', '#inputFontSize',
    '#advFontFamily', '#advAlign', '#advLineHeight', '#advMargin',
    '#advBold', '#advItalic', '#advUpper', '#advUnderline', '#advLetterSpacing'
  ].map($).filter(Boolean).forEach(el => {
    el.addEventListener('input',  () => scheduleTextRedraw());
    el.addEventListener('change', () => scheduleTextRedraw());
    el.addEventListener('blur',   () => scheduleTextRedraw());
    el.addEventListener('focusout', () => scheduleTextRedraw());
  });

  // Tabs
  $$('#nav-tab [data-bs-toggle="tab"]').forEach(btn => {
    btn.addEventListener('shown.bs.tab', (e) => {
      if (e.target?.id === 'nav-text-tab') {
        neutralizeTransformsForTextTabDeep();
        (document.fonts?.ready ? document.fonts.ready : Promise.resolve())
          .then(() => scheduleTextRedraw());
      } else {
        restoreTransformsDeep();
      }
    });
  });

  // First render
  styleControlsStatic();
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => { neutralizeTransformsForTextTabDeep(); scheduleTextRedraw(); })
                        .catch(() => { neutralizeTransformsForTextTabDeep(); scheduleTextRedraw(); });
  } else {
    neutralizeTransformsForTextTabDeep();
    scheduleTextRedraw();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
else wire();
