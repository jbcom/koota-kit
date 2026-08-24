import sharp from "sharp";

const { data, info } = await sharp("../docs/assets/koota-kit-hero.webp")
  .resize(400, 400, { fit: "inside" })
  .raw()
  .toBuffer({ resolveWithObject: true });

const buckets = new Map();
for (let i = 0; i < data.length; i += info.channels) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const luminance = (r + g + b) / 3;
  // Skip the cream/off-white background and near-black outlines so the
  // hero's two actual accent families (navy ink, brass/gold coins) surface.
  if (saturation < 0.3 || luminance < 20 || luminance > 235) continue;
  const key = `${r >> 4},${g >> 4},${b >> 4}`;
  buckets.set(key, (buckets.get(key) ?? 0) + 1);
}

const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
const toHex = (bucketKey) =>
  `#${bucketKey
    .split(",")
    .map((n) => (Number(n) * 16).toString(16).padStart(2, "0"))
    .join("")}`;

console.log("Saturated non-background colors, top 20 (used for Starlight theme in ../src/styles/custom.css):");
for (const [key, count] of sorted.slice(0, 20)) {
  console.log(`${toHex(key)}  (${count} px)`);
}
