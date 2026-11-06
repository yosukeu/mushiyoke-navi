// ムシヨケ・ナビ：AIおすすめAPI（Vercel Functions）
// - Gemini の APIキーは Vercel の環境変数 GEMINI_API_KEY にだけ置く（コードやGitHubには書かない）
// - ブラウザからは数値データだけを受け取り、プロンプトはサーバー側で組み立てる
//   → このAPIを「何でも聞けるGemini」として悪用されにくくする

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-3.6-flash"];
const ENDPOINT = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

// かんたんな回数制限（同じ人から1分に6回まで）。サーバーが再起動するとリセットされる簡易版。
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 6;
}

const str = (v, max = 40) => String(v ?? "").replace(/[\r\n`]/g, " ").slice(0, max);
const num = (v, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("bad number");
  return Math.min(hi, Math.max(lo, n));
};
const smallMap = (o, lo, hi) =>
  Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).slice(0, 8).map(([k, v]) => [str(k, 20), num(v, lo, hi)]));

function clean(body) {
  const c = body?.conditions || {};
  const routes = Array.isArray(body?.routes) ? body.routes.slice(0, 5) : [];
  if (!routes.length) throw new Error("no routes");
  return {
    conditions: {
      month: num(c.month, 1, 12),
      time: str(c.time, 6),
      temp: num(c.temp, -20, 50),
      hum: num(c.hum, 0, 100),
      rain: Boolean(c.rain),
      avoid: (Array.isArray(c.avoid) ? c.avoid : []).slice(0, 6).map((x) => str(x, 12)),
    },
    routes: routes.map((r) => ({
      ルート: `${str(r.id, 2)} ${str(r.name, 20)}`,
      説明: str(r.desc, 40),
      徒歩分: num(r.minutes, 0, 300),
      距離m: num(r.meters, 0, 50000),
      虫リスク0から100: num(r.score, 0, 100),
      通過する環境m: smallMap(r.features, 0, 50000),
      種類別リスク: smallMap(r.bugs, 0, 1000),
    })),
  };
}

function buildPrompt({ conditions: c, routes }) {
  return `あなたは「虫が苦手で、できるだけ虫を見たくない人」のための道案内AIです。
以下の条件とルートのデータを読み、虫に出会いにくいルートを1つ推奨してください。
ルール:
- 虫の姿・見た目・動きの描写は絶対にしないこと（ユーザーは虫が苦手です）。
- データにある数値と環境（川・公園・飲食街など）を根拠にすること。
- 所要時間の差も考慮し、差が小さければ虫の少なさを優先すること。
- やさしく、短く、日本語で。全体で250字以内。Markdownの記号（**や#）は使わないこと。
出力形式（この形のみ）:
おすすめ：〇〇ルート（一言）
理由：
・…
・…
・…
ひとこと：（この条件で気をつけるポイントを1つ）

条件: ${c.month}月 / ${c.time} / 気温${c.temp}℃ / 湿度${c.hum}% / ${c.rain ? "雨のあと" : "雨なし"}
特に避けたい虫: ${c.avoid.join("、") || "指定なし"}
ルートデータ:
${JSON.stringify(routes, null, 1)}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POSTのみ受け付けます。" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "サーバーにAPIキーが設定されていません。" });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (tooMany(ip)) return res.status(429).json({ error: "短時間に聞きすぎです。1分ほど待ってからお試しください。" });

  let data;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (JSON.stringify(body).length > 8000) throw new Error("too large");
    data = clean(body);
  } catch {
    return res.status(400).json({ error: "送られたデータの形が正しくありません。" });
  }

  // 混雑（503）や上限（429）のときは、別の無料モデルに切り替えて1回ずつ試す
  const models = [...new Set([MODEL, ...FALLBACK_MODELS])];
  const prompt = buildPrompt(data);
  let lastStatus = 0;
  for (const m of models) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 15000);
      const r = await fetch(ENDPOINT(m), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
        }),
        signal: c.signal,
      }).finally(() => clearTimeout(t));
      const j = await r.json().catch(() => ({}));
      lastStatus = r.status;
      if (!r.ok) {
        console.error("Gemini error", m, r.status, j?.error?.message);
        continue; // 次のモデルへ
      }
      const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
      if (!text) { console.error("Gemini empty", m); continue; }
      return res.status(200).json({ text, model: m });
    } catch (e) {
      console.error("Gemini fetch", m, e?.name || e);
      lastStatus = 504;
    }
  }
  if (lastStatus === 429) return res.status(429).json({ error: "AIの無料枠の上限に達しました。少し待ってからお試しください。" });
  return res.status(503).json({ error: "AIが混み合っています。少し待ってからもう一度お試しください。" });
};
