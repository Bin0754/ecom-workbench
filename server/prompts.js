// 提示词 v2：分段结构化模板 + 从款号数据 / 原片自动推导的变量。
// 模板正文用「## 段名」分段，设计师可整段编辑，也可逐段编辑；{变量} 在发送前替换。
// 系统硬约束段（HARD CONSTRAINTS）由程序在末尾追加，不可被模板删掉。
import sharp from 'sharp';

const lines = (s) =>
  String(s || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
export const SECTION_LABELS = {
  PURPOSE: '用途',
  SUBJECT: '商品（锁定）',
  'SCENE & SET': '场景与布景',
  CAMERA: '机位',
  LIGHTING: '布光',
  COMPOSITION: '构图与留白',
  STYLE: '风格',
  'HARD CONSTRAINTS': '硬约束（系统）',
};

// ---------- 品类形态 ----------
export const PRODUCT_TYPES = {
  serum_dropper: {
    label: '精华·滴管瓶',
    form: 'a small glass dropper bottle of facial serum',
    swatch:
      'a few glossy, slightly viscous drops of serum plus one short smear drawn with the dropper tip, showing a fluid, translucent, fast-absorbing texture',
    swatchSurface: 'a sheet of clear glass over a soft neutral background',
  },
  oil_dropper: {
    label: '面部油·滴管瓶',
    form: 'a small glass dropper bottle of facial oil',
    swatch: 'a pool of silky facial oil with a few round droplets and a soft sheen, showing a light, non-greasy dry-oil texture',
    swatchSurface: 'a sheet of clear glass over a soft neutral background',
  },
  cream_jar: {
    label: '面霜·罐装',
    form: 'a wide cosmetic cream jar with a lid',
    swatch: 'a thick, whipped swirl of rich cream with soft peaks and one clean spatula stroke, showing a cushiony, velvety texture',
    swatchSurface: 'a smooth matte stone slab',
  },
  tube: {
    label: '软管（洁面/乳液）',
    form: 'a squeezable cosmetic tube standing on its cap',
    swatch:
      'a short ribbon of clear cleansing gel lying on the surface with a cushion of fine, dense, creamy micro-foam beside it, tiny bubbles visible, showing a gentle, soft lather (the formula only, no container)',
    swatchSurface: 'a wet, smooth light stone surface with a few water beads',
  },
  toner_bottle: {
    label: '水/爽肤水·瓶装',
    form: 'a slim cosmetic bottle of toner',
    swatch: 'a shallow splash of crystal-clear watery toner with gentle ripples and droplets, showing a weightless, refreshing texture',
    swatchSurface: 'a sheet of clear glass over a pale background',
  },
  pump_bottle: {
    label: '乳液·按压瓶',
    form: 'a cosmetic pump bottle of lotion',
    swatch: 'a soft, glossy dollop of lotion with a light swipe, showing a smooth, easy-spreading texture',
    swatchSurface: 'a smooth matte stone slab',
  },
  sheet_mask: {
    label: '面膜（片装）',
    form: 'a single sheet-mask sachet',
    swatch: 'a folded, translucent sheet mask glistening with essence, a few drops of essence pooling beside it',
    swatchSurface: 'a smooth light stone surface',
  },
  other: {
    label: '其他',
    form: 'a skincare product',
    swatch: 'a clean, glossy swatch of the formula showing its real texture',
    swatchSurface: 'a smooth light surface',
  },
};
export function inferProductType(p) {
  if (p.product_type && PRODUCT_TYPES[p.product_type]) return p.product_type;
  const s = `${p.name} ${p.name_zh || ''} ${p.box_contents || ''}`.toLowerCase();
  if (/sheet mask|面膜/.test(s)) return 'sheet_mask';
  if (/oil|精华油/.test(s) && /dropper|滴管|oil/.test(s)) return 'oil_dropper';
  if (/serum|ampoule|dropper|精华/.test(s)) return 'serum_dropper';
  if (/cream|balm|jar|面霜|霜/.test(s)) return 'cream_jar';
  if (/cleanser|foam|tube|gel|洁面|洗面/.test(s)) return 'tube';
  if (/toner|essence|mist|爽肤|化妆水/.test(s)) return 'toner_bottle';
  if (/lotion|pump|乳液/.test(s)) return 'pump_bottle';
  return 'other';
}

// ---------- 成分 → 道具 / 色调 / 配方颜色 ----------
const INGR = [
  [
    /vitamin c|ascorb/i,
    'a halved fresh orange and a few thin citrus slices',
    'warm apricot, soft citrus orange and cream',
    'pale champagne-amber, translucent',
  ],
  [/hyaluronic|sodium hyaluronate/i, 'clear water droplets and small glossy beads of clear gel', 'airy pale aqua, white and soft silver', null],
  [/vitamin e|tocopher/i, 'two golden softgel capsules', null, null],
  [/ferulic/i, 'a small scatter of rice grains', null, null],
  [/niacinamide/i, 'a few clear glass orbs', 'clean white and soft pearl grey', null],
  [/ceramide/i, 'smooth white pebbles', 'warm oat, cream and soft stone', null],
  [/squalane|olive/i, 'a sprig of olive leaves with two green olives', null, null],
  [/oat/i, 'a small wooden scoop of rolled oats', 'warm oat, cream and soft stone', null],
  [/green tea|camellia/i, 'fresh green tea leaves', 'soft sage, mint and warm white', null],
  [/amino/i, 'soft clouds of fine white foam bubbles', null, null],
  [/glycerin/i, 'clear water droplets', null, null],
  [/retin/i, 'a few dried rose petals and a dark amber glass pebble', 'dusky mauve, warm amber and cream, evening mood', 'golden amber, translucent'],
  [/aloe/i, 'a cut aloe vera leaf showing its clear gel', 'fresh green and white', 'clear, very light green'],
  [/centella|cica/i, 'fresh centella asiatica leaves', 'soft sage and white', null],
  [/rose/i, 'fresh pale-pink rose petals', 'blush pink and cream', null],
  [/peptide/i, 'faceted clear glass shapes', 'cool pearl and soft lilac-grey', null],
  [/salicylic|willow/i, 'a small piece of willow bark', null, null],
  [/honey|propolis/i, 'a wooden honey dipper with golden honey', 'warm honey gold and cream', 'golden, translucent'],
];
const BENEFIT_MOOD = [
  [/bright|radian|glow|even/i, 'luminous, sunlit, fresh morning energy'],
  [/hydrat|moist|plump|dew/i, 'dewy, fresh, hydrated, airy'],
  [/barrier|comfort|soothing|calm|sensitive|gentle/i, 'calm, soft, comforting, gentle'],
  [/night|overnight|repair|smooth/i, 'quiet, restorative evening calm'],
  [/oil|pore|clean|cleanse/i, 'clean, fresh, light and pure'],
];
export function ingredientInfo(p) {
  const names = lines(p.ingredients).map((l) => l.split('|')[0].trim());
  const props = [],
    palettes = [],
    colors = [];
  for (const n of names)
    for (const [re, prop, pal, col] of INGR)
      if (re.test(n)) {
        if (prop && !props.includes(prop)) props.push(prop);
        if (pal) palettes.push(pal);
        if (col) colors.push(col);
        break;
      }
  return {
    names,
    hero:
      names
        .slice(0, 4)
        .map((n) => n.replace(/\s*\d+(\.\d+)?%/, ''))
        .join(', ') || 'its key ingredients',
    props: props.slice(0, 3),
    palette: palettes[0],
    formulaColor: colors[0],
  };
}
const mood = (p) => {
  const b = lines(p.benefits).join(' ');
  for (const [re, m] of BENEFIT_MOOD) if (re.test(b)) return m;
  return 'calm, premium, clean';
};

// ---------- 原片分析：商品主色、光线方向（缓存在 source_assets.analysis） ----------
function colorName(r, g, b) {
  const mx = Math.max(r, g, b) / 255,
    mn = Math.min(r, g, b) / 255,
    l = (mx + mn) / 2,
    d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l < 0.42 && r - b > 18 && r >= g) return 'dark amber';
  if (l < 0.13) return 'black';
  if (s < 0.16 || d < 0.06) return l > 0.7 ? 'white / off-white' : l > 0.45 ? 'light grey' : 'charcoal';
  let h = 0;
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  if (mx === R) h = ((G - B) / d) % 6;
  else if (mx === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 340) return l < 0.4 ? 'deep red' : 'rose';
  if (h < 45) return l < 0.42 ? 'dark amber' : l > 0.7 ? 'cream' : 'warm beige';
  if (h < 70) return l > 0.7 ? 'cream' : 'gold';
  if (h < 170) return l > 0.6 ? 'mint green' : 'green';
  if (h < 250) return l > 0.6 ? 'pale blue' : 'blue';
  return l > 0.6 ? 'lilac' : 'purple';
}
export async function analyzeCutout(cutPath) {
  const { data, info } = await sharp(cutPath).ensureAlpha().resize(160, 160, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const counts = {};
  let n = 0,
    x0 = info.width,
    x1 = 0;
  const col = new Array(info.width).fill(0).map(() => [0, 0]);
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] < 200) continue;
      n++;
      const c = colorName(data[i], data[i + 1], data[i + 2]);
      counts[c] = (counts[c] || 0) + 1;
      const L = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      col[x][0] += L;
      col[x][1]++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
  const colors = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .filter(([, c]) => c / n > 0.08)
    .slice(0, 3)
    .map(([k]) => k);
  const band = Math.max(2, Math.round((x1 - x0) * 0.3));
  const avg = (a, b) => {
    let s = 0,
      c = 0;
    for (let x = a; x <= b; x++) {
      s += col[x][0];
      c += col[x][1];
    }
    return c ? s / c : 0;
  };
  const left = avg(x0, x0 + band),
    right = avg(x1 - band, x1);
  const diff = (left - right) / Math.max(1, (left + right) / 2);
  const light = diff > 0.06 ? 'left' : diff < -0.06 ? 'right' : 'front';
  return { colors, light, lightDiff: +diff.toFixed(3) };
}

// ---------- 机位：跟原片拍摄角度一致 ----------
const CAMERA = {
  front:
    "Eye-level, straight-on camera at the product's mid-height with a level lens axis (no tilt), 85mm-equivalent product lens. The tabletop is seen at a shallow, grazing angle and recedes only slightly; vertical lines stay vertical. Match the straight-on perspective of the product in Image 1",
  '45deg':
    'Elevated three-quarter view: camera about 35-45 degrees above the tabletop, looking down at the product, 70mm-equivalent lens. The surface plane is clearly visible and recedes upward in the frame, and the top of the product is visible, exactly as in Image 1. Background elements follow the same downward perspective',
  side: 'Eye-level side view with a level lens axis, 85mm-equivalent lens, matching the profile perspective of the product in Image 1',
  top: 'Top-down flat-lay, camera 90 degrees above the surface, matching the overhead view of the product in Image 1',
  texture: 'Macro close-up, 100mm macro lens look, camera about 60 degrees above the surface',
};

// ---------- 构图：按模板版式给出商品位置和文字留白 ----------
const pct = (v) => `${Math.round(v * 100)}%`;
function productZone(spec) {
  const p = spec.product || {};
  const base = (p.cy ?? 0.5) + (p.h ?? 0.5) / 2;
  return `the area centered ${pct(p.cx ?? 0.5)} from the left edge, about ${pct(p.h ?? 0.5)} of the frame height tall, with its base at ${pct(Math.min(0.98, base))} from the top`;
}
const TEXT_ZONE = {
  ingredients: 'the left half of the frame (from 5% to 49% of the width, 8% to 88% of the height)',
  texture: 'the bottom-left band (from 4% to 65% of the width, 73% to 94% of the height)',
  benefits: 'the top band (top 13%), the four corner panels (left 4-34% and right 66-96% of the width, at 20-38% and 59-77% of the height) and the bottom 6%',
  aplus_header: 'the left 55% of the frame, full height',
  aplus_banner: 'the left 58% of the frame, especially its middle band',
  none: null,
};
const SIDE = { left: 'left', right: 'right', front: 'front-left' };
const OPP = { left: 'right', right: 'left', front: 'right' };

// ---------- 变量 ----------
export function promptVars(product, params = {}, ctx = {}) {
  const type = inferProductType(product);
  const T = PRODUCT_TYPES[type];
  const ing = ingredientInfo(product);
  const a = ctx.analysis || {};
  const spec = ctx.spec || {};
  const layout = spec.layout || 'none';
  const light = a.light || 'left';
  const productColors = a.colors?.length ? a.colors.join(', ') : 'the colors shown in Image 1';
  const brandColors = params.brand_colors || product.brand_colors;
  const palette =
    params.palette ||
    product.palette ||
    [ing.palette, brandColors ? `accents of ${brandColors}` : null].filter(Boolean).join(', ') ||
    'warm cream and soft stone neutrals';
  return {
    name: product.name,
    brand: product.brand || 'the brand',
    product_type: T.label,
    product_form: T.form,
    product_colors: productColors,
    hero_ingredients: ing.hero,
    ingredient_props: ing.props.length ? ing.props.join('; ') : 'a few fresh green botanical leaves and clear water droplets',
    ingredient_prop: ing.props[0] || 'a few fresh green leaves',
    key_benefit: lines(product.benefits)[0] || 'healthy-looking skin',
    benefit_mood: params.mood || mood(product),
    palette,
    audience: product.audience || 'adults 25-45 who like a minimalist, clean-beauty routine',
    scene: params.scene || product.scene || 'white Carrara marble bathroom vanity counter',
    texture_desc: params.texture ? `${params.texture} — ${T.swatch}` : T.swatch,
    texture_surface: T.swatchSurface,
    formula_color: params.formula_color || ing.formulaColor || 'translucent, near-clear',
    camera: CAMERA[ctx.angle] || CAMERA.front,
    light_side: SIDE[light],
    fill_side: OPP[light],
    shadow_side: `the ${OPP[light]} and slightly behind`,
    product_zone: productZone(spec),
    text_zone: TEXT_ZONE[layout] || 'none (no text on this image)',
    // 旧模板兼容
    texture: params.texture || 'lightweight translucent serum',
  };
}
export const fillVars = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

export function hardConstraints(vars, spec = {}) {
  const t = TEXT_ZONE[spec.layout || 'none'];
  return [
    '## HARD CONSTRAINTS',
    '- Image 1 is the layout reference: the real product photo is already composited at its final position on a white placeholder. Replace ONLY the white placeholder with the scene; the masked product area is locked.',
    '- Exactly one product in the frame: the one from Image 1. Do not duplicate or mirror it, and do not add any other bottles, jars, tubes, droppers, pumps, boxes or packaging, not even blurred in the background.',
    '- Do not redraw, restyle, resize, move, rotate or relabel the product. Keep its silhouette, label, logo, colors and cap exactly as in Image 1.',
    '- No text, letters, numbers, logos, brand marks, watermarks, signage or printed patterns anywhere in the scene.',
    '- No people, faces, hands or body parts.',
    '- The product rests physically on a surface (never floating), with a soft contact shadow that follows the scene light.',
    ...(t ? [`- Keep ${t} calm, evenly lit and free of props and strong detail, because text is overlaid there later.`] : []),
    '- Photorealistic result; no CGI look, no illustration, no frames or borders.',
  ].join('\n');
}

export function buildPrompt(template, vars, spec) {
  return `${fillVars(template, vars).trim()}\n\n${hardConstraints(vars, spec)}`;
}
export function splitSections(text) {
  const out = [];
  const re = /^##\s*(.+?)\s*$/gm;
  let m,
    last = null,
    lastIdx = 0;
  while ((m = re.exec(text))) {
    if (last) out.push({ name: last, body: text.slice(lastIdx, m.index).trim() });
    last = m[1];
    lastIdx = re.lastIndex;
  }
  if (last) out.push({ name: last, body: text.slice(lastIdx).trim() });
  return out;
}

// ---------- v2 模板正文 ----------
const SUBJECT = `## SUBJECT
Image 1 shows the real product, {name}: {product_form} (dominant tones: {product_colors}). It is a protected photographic cut-out, already at its final size and position. Build the scene around it so it looks like it was photographed there.`;
const STYLE = `## STYLE
High-end clean-beauty commercial photography for an Amazon listing aimed at {audience}. Realistic, true-to-life color and material texture (stone grain, glass, water), crisp focus on the product plane, gentle tonal contrast, mood: {benefit_mood}. Not CGI, not a 3D render, no heavy HDR or oversaturation.`;
export const PROMPTS_V2 = {
  PT01: `## PURPOSE
Amazon gallery image "key ingredients" for {name}. The layout engine will place text cards naming {hero_ingredients} on the left, so this background must tell the ingredient story visually with real, recognisable raw-ingredient props.

${SUBJECT}

## SCENE & SET
Seamless studio still life on a smooth surface with a soft vertical gradient backdrop in {palette}. Ingredient props grouped behind and beside the product on the right side: {ingredient_props}, plus a few glossy droplets of the formula on the surface. Props are fresh, realistically scaled and fewer rather than more (3-5 elements).

## CAMERA
{camera}. Moderate depth of field: props next to the product are sharp, props further back fall off softly.

## LIGHTING
Large softbox key light from the {light_side}, matching the light already on the product; white bounce fill from the {fill_side}; a subtle rim light from behind to separate the product edges. Glossy specular highlights on droplets, soft contact shadow toward {shadow_side}.

## COMPOSITION
Square frame. The product occupies {product_zone}. Text area: {text_zone} — keep it a clean, low-detail gradient. Props frame the product from behind and the right without covering it; leave a small breathing margin around the product.

${STYLE}`,
  PT03: `## PURPOSE
Amazon gallery "texture" image for {name}: answers "how does it feel on skin?" with a macro of the formula itself; a small product shot in the corner identifies it.

${SUBJECT}

## SCENE & SET
Hero element: {texture_desc}. Formula color: {formula_color}. Placed on {texture_surface}, filling the upper-left two-thirds of the frame. Nothing else in the frame besides the swatch, the surface and the one product; nothing standing behind or next to the product.

## CAMERA
Macro close-up look, 100mm macro lens, shallow depth of field with the swatch in sharp focus; the surface plane matches the perspective of the product in Image 1 ({camera}).

## LIGHTING
Soft diffused key light from the {light_side} with a crisp specular highlight that reveals gloss, bubbles and viscosity; clean white fill from the {fill_side}; bright, airy exposure. Soft contact shadow under the product toward {shadow_side}.

## COMPOSITION
Square frame. The product occupies {product_zone} (small, bottom-right). Text area: {text_zone} — keep it plain surface with no swatch running into it. The swatch must not touch the product.

${STYLE}`,
  PT04: `## PURPOSE
Amazon gallery "benefits" infographic background for {name}. Four short benefit callouts (led by "{key_benefit}") are overlaid by the layout engine around the product, so the set must be minimal and centred.

${SUBJECT}

## SCENE & SET
A single low, round podium (matte travertine or plaster) under the product, the product standing on the podium's top surface. Backdrop: seamless wall in {palette} with a soft radial glow behind the product and a faint, out-of-focus botanical shadow in one upper corner. No other props.

## CAMERA
{camera}. Deep enough depth of field for the podium and product to be sharp.

## LIGHTING
Soft frontal key from the {light_side} matching the product; even, bright fill; a gentle halo/backlight on the wall behind the product; soft contact shadow where the product meets the podium.

## COMPOSITION
Square, symmetrical. The product occupies {product_zone}; the podium top sits exactly at the product's base. Text areas: {text_zone} — keep them plain, evenly lit wall.

${STYLE}`,
  PT05: `## PURPOSE
Amazon gallery lifestyle image for {name}: show it in a believable, aspirational daily routine so shoppers picture it on their own vanity. No text is added to this image.

${SUBJECT}

## SCENE & SET
A {scene} in a bright, tidy bathroom. Secondary props, softly out of focus and never touching or overlapping the product: a folded natural-linen hand towel, a small ceramic dish, a trailing green plant in a matte pot. One subtle nod to the formula, beside (not in front of) the product: {ingredient_prop}. Palette: {palette}, harmonising with the product's {product_colors}.

## CAMERA
{camera}. Shallow depth of field (about f/2.8): the product plane is crisp, the background falls off into soft bokeh.

## LIGHTING
Soft morning window light as the key from the {light_side}, consistent with the light already on the product; gentle fill from the {fill_side}; warm daylight around 5200K. Soft contact shadow toward {shadow_side} and a faint, blurred reflection on the counter surface.

## COMPOSITION
Square frame. The product occupies {product_zone}, standing on the counter with its base fully resting on it. Background props follow the rule of thirds and keep a clear margin around the product; uncluttered, calm.

${STYLE}`,
  APLUS_HEADER: `## PURPOSE
Amazon A+ brand header (970x600) for {brand} {name}: the first brand-story visual below the fold. Headline and benefit text ("{key_benefit}") are overlaid on the left by the layout engine.

${SUBJECT}

## SCENE & SET
Warm architectural set: a raw travertine or limestone block on the right as a plinth under the product, the product standing on its top surface; behind it a smooth plaster wall in {palette} with a soft dappled botanical shadow (gobo). A small, delicate accent ({ingredient_prop}) at the far right edge only.

## CAMERA
{camera}. Wide banner framing; moderate depth of field.

## LIGHTING
Warm late-morning sun from the {light_side} raking across the wall and plinth, matching the product's light; soft fill; a crisp but soft-edged contact shadow on the plinth toward {shadow_side}.

## COMPOSITION
Wide landscape. The product occupies {product_zone}. Text area: {text_zone} — a calm, softly lit wall and floor with only a faint shadow pattern; no objects.

${STYLE}`,
  APLUS_BANNER: `## PURPOSE
Amazon A+ wide lifestyle banner (970x300) for {name}; one short line of copy is overlaid on the left.

${SUBJECT}

## SCENE & SET
A {scene} running the full width of the frame, a bright bathroom softly blurred behind it. Near the product only: a folded towel and a small plant, out of focus. Palette: {palette}.

## CAMERA
{camera}. Very wide, low banner framing; shallow depth of field.

## LIGHTING
Soft morning window light from the {light_side}, matching the product; gentle fill; soft contact shadow toward {shadow_side}.

## COMPOSITION
Panoramic 3:1. The product occupies {product_zone}. Text area: {text_zone} — keep it clean counter and softly blurred wall with no props.

${STYLE}`,
  APLUS_TILE: `## PURPOSE
Amazon A+ small square tile (300x300) for {name}; it must read instantly at thumbnail size.

${SUBJECT}

## SCENE & SET
Ultra-minimal: a smooth surface and seamless backdrop in {palette}, one large soft shadow shape from a window, nothing else.

## CAMERA
{camera}. Product sharp.

## LIGHTING
Soft directional light from the {light_side} matching the product, bright and airy, soft contact shadow toward {shadow_side}.

## COMPOSITION
Square. The product occupies {product_zone}; simple, bold tonal areas, no small details.

${STYLE}`,
};
