// ムシヨケ・ナビ：ルート周辺の公園・水辺・飲食店などを OpenStreetMap（Overpass API）から取得する中継API
// ブラウザから直接 Overpass に問い合わせると混雑や通信制限で失敗しやすいため、サーバー側で問い合わせる。

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UA = "mushiyoke-navi/0.2 (training prototype; https://mushiyoke-navi.vercel.app)";

const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 10;
}

function buildQuery({ s, w, n, e }) {
  const b = `${s},${w},${n},${e}`;
  return `[out:json][timeout:25];(
way["leisure"~"^(park|garden|playground|pitch|nature_reserve)$"](${b});
way["landuse"~"^(grass|forest|meadow|recreation_ground|cemetery|village_green)$"](${b});
way["natural"~"^(wood|scrub|water|wetland)$"](${b});
way["waterway"~"^(river|stream|canal|ditch|drain)$"](${b});
nwr["amenity"~"^(restaurant|fast_food|cafe|bar|pub|food_court|biergarten)$"](${b});
node["amenity"~"^(waste_disposal|recycling|waste_basket)$"](${b});
nwr["shop"="convenience"](${b});
node["amenity"="vending_machine"](${b});
);out geom qt;`;
}

async function fetchWithTimeout(url, opt, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...opt, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POSTのみ受け付けます。" });
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (tooMany(ip)) return res.status(429).json({ error: "短時間に検索しすぎです。1分ほど待ってからお試しください。" });

  let bb;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    bb = ["s", "w", "n", "e"].reduce((o, k) => {
      const v = Number(body?.[k]);
      if (!Number.isFinite(v)) throw new Error("bad");
      o[k] = +v.toFixed(5);
      return o;
    }, {});
    if (bb.s >= bb.n || bb.w >= bb.e) throw new Error("bad");
    if (bb.n - bb.s > 0.08 || bb.e - bb.w > 0.08) {
      return res.status(400).json({ error: "範囲が広すぎます。徒歩で行ける距離の2点を選んでください。" });
    }
  } catch {
    return res.status(400).json({ error: "送られたデータの形が正しくありません。" });
  }

  const q = buildQuery(bb);
  // 送り方を2通り試す（POSTフォーム → GETクエリ）。サーバーによって受け付ける形が違うため。
  const attempts = [];
  for (const url of MIRRORS) {
    attempts.push([url, { method: "POST", body: new URLSearchParams({ data: q }), headers: { "User-Agent": UA } }, url]);
    attempts.push([url + "?data=" + encodeURIComponent(q), { method: "GET", headers: { "User-Agent": UA } }, url + " (GET)"]);
  }
  const started = Date.now();
  for (const [u, opt, label] of attempts) {
    if (Date.now() - started > 45000) break;
    try {
      const r = await fetchWithTimeout(u, opt, 12000);
      if (!r.ok) {
        console.error("overpass", label, r.status, (await r.text().catch(() => "")).slice(0, 120));
        continue;
      }
      const j = await r.json();
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
      return res.status(200).json({ elements: j.elements || [] });
    } catch (e) {
      console.error("overpass", label, e?.name || e);
    }
  }
  return res.status(502).json({ error: "周辺施設のデータを取得できませんでした。" });
};
