// 模拟通道：不调用任何外部模型，按提示词关键词用程序画一张背景，方便无 key 时走通全流程。
import sharp from 'sharp';

function hash(s) {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed) {
  let s = seed || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
}
const PALETTES = [
  ['#FBEFE6', '#F3D9C6', '#E8B999'],
  ['#EEF4EF', '#D6E6DA', '#A9C8B2'],
  ['#F2EEF8', '#E0D8F0', '#BDB0DD'],
  ['#EEF3F8', '#D7E3EF', '#A8C1DA'],
  ['#FAF6EC', '#EFE5CC', '#D8C597'],
];

export default {
  id: 'mock',
  type: 'mock',
  capabilities: () => ({ ops: ['txt2img', 'img2img'], maxSize: 4096, pricing: '免费（模拟）' }),
  async generate({ prompt, size, seed }) {
    const [w, h] = size.split('x').map(Number);
    const p = prompt.toLowerCase();
    const sd = seed ?? hash(prompt);
    const r = rng(sd);
    const pal = PALETTES[sd % PALETTES.length];
    let body = '';
    if (/bathroom|vanity|counter|\bspa\b/.test(p)) {
      // 浴室台面：瓷砖墙 + 台面 + 窗光
      const tile = Math.round(w / 9);
      let tiles = '';
      for (let y = 0; y < h * 0.62; y += tile)
        for (let x = 0; x < w; x += tile)
          tiles += `<rect x="${x + 2}" y="${y + 2}" width="${tile - 4}" height="${tile - 4}" rx="4" fill="${r() > 0.5 ? '#E4EEEA' : '#DCE8E3'}"/>`;
      body = `<rect width="100%" height="100%" fill="#CFDDD7"/>${tiles}
        <rect y="${h * 0.62}" width="${w}" height="${h * 0.38}" fill="url(#counter)"/>
        <rect y="${h * 0.62}" width="${w}" height="${h * 0.012}" fill="#ffffff" opacity="0.8"/>
        <ellipse cx="${w * 0.12}" cy="${h * 0.5}" rx="${w * 0.07}" ry="${h * 0.16}" fill="#7FA88C" opacity="0.55" filter="url(#blur)"/>
        <rect x="${w * 0.78}" y="${h * 0.5}" width="${w * 0.18}" height="${h * 0.13}" rx="12" fill="#F7F4EE" filter="url(#blur)"/>
        <rect width="100%" height="100%" fill="url(#light)"/>`;
    } else if (/macro|swatch|texture/.test(p)) {
      // 膏体质地：几条柔和的涂抹弧线
      let strokes = '';
      for (let i = 0; i < 5; i++) {
        const y = h * (0.25 + i * 0.1 + r() * 0.04);
        strokes += `<path d="M ${w * 0.08} ${y} C ${w * 0.35} ${y - h * 0.12}, ${w * 0.6} ${y + h * 0.14}, ${w * 0.9} ${y - h * 0.03}" stroke="${i % 2 ? '#FFFFFF' : pal[1]}" stroke-width="${w * (0.05 + r() * 0.04)}" stroke-linecap="round" fill="none" opacity="${0.75 + r() * 0.2}" filter="url(#soft)"/>`;
      }
      body = `<rect width="100%" height="100%" fill="${pal[0]}"/>${strokes}<rect width="100%" height="100%" fill="url(#light)"/>`;
    } else {
      // 通用棚拍背景：渐变 + 柔光圆 + 台座
      let blobs = '';
      for (let i = 0; i < 6; i++)
        blobs += `<circle cx="${w * r()}" cy="${h * r() * 0.7}" r="${Math.min(w, h) * (0.08 + r() * 0.18)}" fill="${pal[2]}" opacity="${0.12 + r() * 0.15}" filter="url(#blur)"/>`;
      body = `<rect width="100%" height="100%" fill="url(#bg)"/>${blobs}
        <ellipse cx="${w * 0.5}" cy="${h * 0.86}" rx="${w * 0.6}" ry="${h * 0.12}" fill="${pal[1]}" opacity="0.9"/>
        <rect width="100%" height="100%" fill="url(#light)"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal[0]}"/><stop offset="1" stop-color="${pal[1]}"/></linearGradient>
        <linearGradient id="counter" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F4F2EE"/><stop offset="1" stop-color="#DAD6CF"/></linearGradient>
        <radialGradient id="light" cx="0.25" cy="0.15" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="${Math.round(w / 40)}"/></filter>
        <filter id="soft"><feGaussianBlur stdDeviation="${Math.round(w / 300)}"/></filter>
      </defs>${body}
      <rect x="${w * 0.02}" y="${h * 0.02}" width="${w * 0.16}" height="${h * 0.05}" rx="${h * 0.01}" fill="#C0392B" opacity="0.85"/><text x="${w * 0.1}" y="${h * 0.055}" text-anchor="middle" font-size="${h * 0.03}" font-family="'Noto Sans','DejaVu Sans',sans-serif" fill="#fff">MOCK</text></svg>`;
    await new Promise((res) => setTimeout(res, 400 + Math.random() * 600));
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return { buffer, model: 'mock-procedural-v1', seed: sd, usage: null, cost: 0 };
  },
};
