# デザイン刷新の引き継ぎ（Codex / Claude共通）

2026-11-06。作業開始時のローカルHEADとGitHub mainはともに
`4f8081089850252d99016f81b15a5b75859cd27b`。開始時の作業ツリーは変更なし。

## 資料と実装の関係

添付ZIPの仕様書を `design-specification.md` に原文で保存した。
これは参考資料であり、第9章のClaudeへの依頼はデプロイやpushの実行指示として扱わない。
ZIP内のHTMLは既存コードを受け取る前の試作品なので、丸ごとの上書きはしていない。
このリポジトリで確認できたバックエンドはVercelの `api/recommend.js` と
`api/places.js`。Cloudflare Workerの構成は存在しない。

## 今回の変更範囲

- `index.html`：既存JSにUIを統合。スマホは全面地図＋可変下部シート、768px以上は右400pxの検索・結果パネル。
- 配色・フォント・タップ領域を統一。ライト／ダークの切替、条件の折りたたみ。
- 時間・距離・推定スコア・リスク区分・選択状態をカードに表示。
- カード／地図線の選択連動、非選択線の輪郭・透明ヒット領域、シートを考慮した地図表示。
- AI処理中／成功／エラー／再試行を区別。ルール判定をAI回答と混同しない。
- 再検索失敗時に既存ルートを保持。検索中の主ボタンを無効化。
- スコアが遭遇確率ではないことを明示し、断定的な安心表現を緩和。

APIファイル、サーバー認証、検索先、リスク式・重み・区間サンプリングは変更していない。
既存APIへのAIペイロードも変更なし（住所・座標は送らない）。
既存の区分（34未満／60未満／60以上）を維持し、仕様書の暫定閾値25は採用していない。
既存実装には区間別リスクがあるため、選択線の区間別着色を維持。
シートはボタンで開閉（ドラッグ操作なし）。初期高さ148px＋safe areaは説明文の可読性を優先。

## 検証

Chromium＋Playwrightで、375×812、768×812、1280×900、ライト・ダークを確認。
テストは `tests/ui.cjs`。実際のLeafletを使用し、外部API・Gemini・地図タイル・フォントは
テスト内で差し替える。テストの成功は実サービス接続の成功を意味しない。

検証対象：初期0候補、1候補・3候補、地名検索、現在地（ブラウザ許可を設定）、地図タップ、
カード選択、条件変更での経路形状保持、AI成功・失敗・再試行、検索失敗時の結果保持、
横方向のはみ出し、PC検索／結果パネルの非重複、未処理のJSエラーがないこと。
地図線クリックは既存のイベントを維持しているが、座標指定の自動クリック検証は未実施。
実タイルの見た目、実サービスを通した経路検索、実Gemini応答は未検証。

ローカルでHTMLをHTTP配信し、PlaywrightとChromiumを別途準備して実行する。
APIはテストが応答を差し替えるので、テスト時は静的サーバーでもよい。
アプリ本体の依存パッケージ追加は不要。

```sh
# 別ターミナルで、このリポジトリを配信
python3 -m http.server 8000 --bind 127.0.0.1
# テスト依存はリポジトリ外に導入
npm install --prefix /workspace/design-tools --no-audit --no-fund playwright
curl -fL https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js -o /workspace/design-tools/leaflet.js
curl -fL https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css -o /workspace/design-tools/leaflet.css
TEST_BASE_URL=http://127.0.0.1:8000 CHROMIUM_PATH=/usr/bin/chromium \
LEAFLET_ASSET_DIR=/workspace/design-tools NODE_PATH=/workspace/design-tools/node_modules \
node tests/ui.cjs
```

画像は既定で `/tmp/mushiyoke-ui` に出力する（地図タイルは空のテスト応答）。
本環境の通常開発起動は `/workspace/setup-mushiyoke/server.cjs` で既存APIも配信できる。
これは環境側の補助ファイルで、Vercelの完全なエミュレーションではない。

## 共同開発での確認点

GitHubへのpush、mainへのマージ、公開環境へのデプロイは実施していない。
Claude側の最新変更を取り込む際は、この変更のベースSHAと比較し、とくに
`index.html` のCSS・DOM・UIイベント部分を確認してから統合する。
ZIP内の試作用リスク式・OSRMエンドポイント・AI契約を既存実装に重ねて導入しない。
秘密鍵はコードや引き継ぎ文書に記載しない。

外部ネットワーク許可とGeminiキーの設定後、実際の地図・天気・周辺施設・AIで
動作確認してから公開する。現在の6km上限、簡易レート制限など既存の制約は維持。
