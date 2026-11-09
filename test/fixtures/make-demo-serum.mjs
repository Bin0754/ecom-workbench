// Regenerates demo-serum.jpg: a synthetic, license-free "phone photo" of a fictional dropper bottle used by the API test.
import sharp from 'sharp';
const W = 900,
  H = 1200;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ECEAE6"/><stop offset="1" stop-color="#D9D5CF"/></linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5A2E0E"/><stop offset=".35" stop-color="#9B5A22"/><stop offset=".6" stop-color="#7A4115"/><stop offset="1" stop-color="#4A250B"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#bg)"/>
<ellipse cx="450" cy="1010" rx="190" ry="26" fill="#000" opacity=".18"/>
<rect x="400" y="300" width="100" height="70" rx="10" fill="#1d1d1d"/>
<rect x="415" y="250" width="70" height="60" rx="30" fill="#222"/>
<rect x="290" y="370" width="320" height="640" rx="46" fill="url(#glass)"/>
<rect x="320" y="560" width="260" height="300" rx="8" fill="#F7F5F0"/>
<text x="450" y="660" text-anchor="middle" font-family="DejaVu Sans" font-size="44" letter-spacing="8" fill="#222">DEMO</text>
<text x="450" y="730" text-anchor="middle" font-family="DejaVu Sans" font-size="26" fill="#444">Test Serum</text>
<text x="450" y="800" text-anchor="middle" font-family="DejaVu Sans" font-size="20" fill="#666">30 ml</text></svg>`;
await sharp(Buffer.from(svg))
  .jpeg({ quality: 90 })
  .toFile(new URL('./demo-serum.jpg', import.meta.url).pathname);
