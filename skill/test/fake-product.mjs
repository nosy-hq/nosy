// Fake product "Cargo": sets up a deterministic trial target to hermetically test Nosy's 9 scripts
// (skill/tools/*.mjs) ("Nosy has no backend, no PR; a second trial product is needed").
//
// As a module:  import { fakeProductSetup } from "./fake-product.mjs"; const K = await fakeProductSetup(target);
// As a CLI:     node fake-product.mjs [target-folder]   -> prints the paths it created as JSON.
//
// Locale variants (28 Sep 2026, language-independence audit, pm/log.md): fakeProductSetup(goal, { locale })
// also accepts "de" and "ja" - same repo/commit/ref/K-number/§-number structure as the English "Cargo", but
// with the PRODUCT's own free-text content (decisions prose, request-doc prose, dropped-comment reasons,
// commit descriptions, PR/issue titles+bodies, pm/*.md, rival docs) translated into German ("Kargo") or
// Japanese ("カーゴ"). Structural signals (K/§/# numbers, file paths, git dates, JSON shapes, status enum
// values like `exists`/`missing`/`partial`) are kept identical across locales on purpose - those are meant
// to be language-independent already; skill/test/lang-parity.test.mjs is what actually checks that. Two
// convenience wrappers are exported: buildFakeProductDe / buildFakeProductJa.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const Day = 86400000;

function git(repoDir, args, env) {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8", env: { ...process.env, ...env } });
}
function filesOfWrite(repoDir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(repoDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}
// A date RELATIVE to the moment it runs: "day" days ago, at a fixed hour (so tests don't break across a midnight boundary).
function relativeDate(now, day, hour = 10) {
  const t = new Date(now - day * Day);
  t.setUTCHours(hour, 0, 0, 0);
  return t;
}
function commitEt(repoDir, now, { day, hour, author, email, message, files }) {
  filesOfWrite(repoDir, files);
  const iso = relativeDate(now, day, hour).toISOString();
  git(repoDir, ["add", "-A"]);
  git(repoDir, ["commit", "-q", "-m", message], {
    GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: iso,
  });
  return { hash: git(repoDir, ["rev-parse", "HEAD"]).trim(), day, author, email, message, date: iso };
}

const ALICE = ["Alice Moore", "alice@cargo.test"];
const BEN = ["Ben Carter", "ben@cargo.test"];
const CARA = ["Cara Ellis", "cara@cargo.test"];
const BOT = ["dependabot[bot]", "dependabot@cargo.test"];

// --- per-locale product content ------------------------------------------------------------------------
// Only PRODUCT prose is translated (decisions, request doc, dropped-comment reasons, commit descriptions,
// PR/issue titles+bodies, pm/*.md, rival docs). Kept identical across locales: K/§/#-numbers, m.N sub-item
// numbers, file paths, "feat:"/"fix:"/"chore:"/"docs:"/"refactor:"/"test:" conventional-commit prefixes
// (a convention that stays in English regardless of the product's language in real-world repos), status
// enum tokens (`exists`/`missing`/`partial` - config-chosen codes, not prose), and endpoint paths.
const PRODUCT_NAME = { en: "Cargo", de: "Kargo", ja: "カーゴ" };

const L = {
  en: {
    decisionsMd: `# Decisions

## K10 (3 Sep, Alex): Cargo's first release ships with the shipment and billing modules.

## K11 (5 Sep, Alex): We're not doing route optimization for now; manual assignment is enough.

## K12 (10 Sep, Alex): Moving shipment files between stages should be automated.
- m.1: listing API
- m.4: file-move backend
- m.6: MCP integration

## K20 (12 Sep, Alex): Route report export is prioritized.

## K30 (14 Sep, Alex): Shipment bulk export screen ships this sprint.
- m.2: wire up the screen and API

## K40 (20 Sep, Alex): Barcode scanning becomes mandatory for the shipment intake flow. Manual
intake closes without barcode scanner integration; an error screen shows if the barcode can't be read.
`,
    backendNeedsMd: "# Backend ready but screenless\n\n" +
      "Tracks the parts Cargo's backend serves but that aren't wired to a screen yet, or whose status is unclear.\n\n" +
      "### 1. Shipment list\n\n" +
      "**Status:** `exists`\n" +
      "**Endpoint:** `GET /api/shipments`\n" +
      "**UI:** wired, live on the /shipments page.\n\n" +
      "### 3. Bulk export\n\n" +
      "**Status:** `exists`\n" +
      "**Endpoint:** `POST /api/shipments/export`\n" +
      "Backend is ready but no screen for this yet; the user can only try it via the API.\n" +
      "**UI:** not started.\n\n" +
      "### 5. Invoice PDF archive\n\n" +
      "**Status:** `missing`\n" +
      "checked 20 Sep — the archive endpoint is planned, not written yet.\n\n" +
      "### 7. Barcode report\n\n" +
      "**Status:** `partial`\n" +
      "measured 12 Sep — only raw data exists, no summary report.\n\n" +
      "### 9. Route optimization\n\n" +
      "**Status:** `missing`\n" +
      "The backend plan was put on hold for now by decision K11.\n",
    droppedList: `// Shipment list page.
export function ShipmentList() {
  // dropped: §21 shipment bulk-cancel endpoint ready, not on screen
  return null;
}
`,
    droppedPanel: `// Reports panel.
export function ReportsPanel() {
  // dropped: §22 route report export ready, screen not wired
  return null;
}
`,
    droppedSummary: `// Invoice summary page.
export function InvoiceSummary() {
  // dropped: §23 bulk billing UI ready but deliberately left out of scope (intentionally)
  return null;
}
`,
    commitMsgs: {
      c1: "feat: project skeleton, first version of DECISIONS and BACKEND-NEEDS",
      c2: "feat: K12 m.1 shipment list API (#80)",
      c3: "chore(deps): bump semver from 7.5.0 to 7.5.4 (#101)",
      c4: "refactor: shipment service cleanup",
      c5: "chore(deps): bump undici from 6.2.0 to 6.2.1 (#103)",
      c6: "feat: §7 barcode report draft integration",
      c7: "feat: K12 m.4 shipment file-move backend",
      c8: "feat: §22 route report export backend (K30 m.2)",
      c9: "chore: lint fixes",
      c10: "fix: K30 m.2 shipment bulk export screen wired up (§3)",
      c11: "test: shipment service unit tests",
      c12: "feat: K12 m.6 MCP integration draft",
      c13: "docs: §99 add ADR directory (for read-decisions.mjs testing)",
    },
    adr1: "# ADR-0001: Shipment list API contract\n\nStatus: Accepted\n\nThe shipment list endpoint supports pagination.\n",
    adr2: "# ADR-0002: Bulk export format\n\nStatus: Accepted\n\nBulk export only produces CSV; no other format.\n",
    adr3: "# ADR-0003: Route optimization\n\nStatus: Rejected\n\nRoute optimization was left out of scope for this release.\n",
    productMd: "# Cargo\n\n- **Page name:** Cargo\n- **What:** Shipment and invoice tracking for small logistics teams.\n",
    summaryMd: "Cargo is a fake test product set up to test Nosy's scripts (internal request 27).\n",
    logMd: "## Test\n- Set up with fake-product.mjs; not edited by hand.\n",
    decisionsPmMd: "- **Test decision (Alex):** Cargo only exists for Nosy's tests, not a real product.\n",
    rivalSevkpro: `# SevkPro

**Category:** logistics SaaS
**Site:** https://sevkpro.example (Sep 28)

## Loop matrix

| # | Step | Code | Evidence |
|---|---|---|---|
| 1 | Shipment list | y | on the main screen (Sep 28) |
| 2 | Bulk export | y | CSV export exists (Sep 28) |
| 3 | Barcode scanning | y | in the mobile app (Sep 28) |
| 4 | Invoice archive | p | last 90 days only (Sep 28) |
`,
    rivalYolcu360: `# Yolcu360

**Category:** fleet management
**Site:** https://yolcu360.example (Sep 28)

## Loop matrix

| # | Step | Code | Evidence |
|---|---|---|---|
| 1 | Shipment list | y | (Sep 28) |
| 2 | Bulk export | y | CSV and Excel (Sep 28) |
| 3 | Barcode scanning | y | (Sep 28) |
| 4 | Invoice archive | y | (Sep 28) |
`,
    usNotes: { 1: "main flow", 2: "partial, API exists no screen", 3: "not yet", 4: "exists" },
    matrixLines: [
      { feature: "Bulk export", not: "§3 backend ready, no screen" },
      { feature: "Barcode scanning", not: "K40 decision, not done yet" },
      { feature: "Route optimization", not: "K11: not doing" },
      { feature: "SLA report", not: "partially exists, fields missing" },
    ],
    gh: {
      pr615Title: "K12 m.9 I'm extending the file-move screen, also broadening th…",
      pr615Body: "…e scope; also fixed its link to §22 (#777).\n\nDetails here.",
      pr616Headline: "wip: invoice archive draft",
      pr601Title: "WIP: §22 route report screen",
      pr601Body: "Backend ready, wiring up the screen.",
      pr610Title: "Debug: shipment logging improvement",
      pr610Body: "Added console.log(card) for debugging; unrelated to K12 m.1.",
      pr611Title: "K12 m.6 MCP integration screen",
      pr611Body: "Adding the screen for K12 m.6.",
      issue701Title: "[cargo] Bulk shipment export request",
      issue701Body: "1. Pick a date range\n2. Download CSV",
      issue702Title: "General infrastructure improvement",
      issue702Body: "Server upgrade needed.",
      issue650Title: "An old request",
      commentLookingInto: "Looking into it.",
      pr501Title: "Shipment bulk-cancel screen",
      pr502Title: "Invoice archive fix",
      pr503Title: "(auto-section test)",
    },
  },
  de: {
    decisionsMd: `# Entscheidungen

## K10 (3. Sep, Alex): Kargos erste Version erscheint mit den Modulen Sendungen und Abrechnung.

## K11 (5. Sep, Alex): Wir machen die Routenoptimierung vorerst nicht; manuelle Zuweisung reicht aus.

## K12 (10. Sep, Alex): Das Verschieben von Sendungsdateien zwischen Phasen soll automatisiert werden.
- m.1: Listen-API
- m.4: Backend für Dateiverschiebung
- m.6: MCP-Integration

## K20 (12. Sep, Alex): Der Export des Routenberichts hat Priorität.

## K30 (14. Sep, Alex): Der Bildschirm für den Massenexport von Sendungen erscheint in diesem Sprint.
- m.2: Bildschirm und API anbinden

## K40 (20. Sep, Alex): Die Barcode-Erfassung wird für den Sendungseingang verpflichtend. Die manuelle
Erfassung schließt ohne Barcode-Scanner-Integration; ein Fehlerbildschirm erscheint, wenn der Barcode nicht gelesen werden kann.
`,
    backendNeedsMd: "# Backend fertig, aber ohne Bildschirm\n\n" +
      "Erfasst die Teile, die Kargos Backend bereits liefert, aber die noch keinem Bildschirm zugeordnet sind, oder deren Status unklar ist.\n\n" +
      "### 1. Sendungsliste\n\n" +
      "**Status:** `exists`\n" +
      "**Endpoint:** `GET /api/shipments`\n" +
      "**UI:** angebunden, live auf der Seite /shipments.\n\n" +
      "### 3. Massenexport\n\n" +
      "**Status:** `exists`\n" +
      "**Endpoint:** `POST /api/shipments/export`\n" +
      "Das Backend ist fertig, aber es gibt noch keinen Bildschirm dafür; die Nutzerin kann es nur über die API ausprobieren.\n" +
      "**UI:** noch nicht begonnen.\n\n" +
      "### 5. Rechnungs-PDF-Archiv\n\n" +
      "**Status:** `missing`\n" +
      "geprüft am 20. Sep — der Archiv-Endpunkt ist geplant, aber noch nicht geschrieben.\n\n" +
      "### 7. Barcode-Bericht\n\n" +
      "**Status:** `partial`\n" +
      "gemessen am 12. Sep — es gibt nur Rohdaten, keinen Übersichtsbericht.\n\n" +
      "### 9. Routenoptimierung\n\n" +
      "**Status:** `missing`\n" +
      "Der Backend-Plan wurde durch Entscheidung K11 vorerst zurückgestellt.\n",
    droppedList: `// Sendungslisten-Seite.
export function ShipmentList() {
  // dropped: §21 Endpunkt für Sammelstorno von Sendungen fertig, nicht auf dem Bildschirm
  return null;
}
`,
    droppedPanel: `// Berichte-Panel.
export function ReportsPanel() {
  // dropped: §22 Export des Routenberichts fertig, Bildschirm nicht angebunden
  return null;
}
`,
    droppedSummary: `// Rechnungsübersicht-Seite.
export function InvoiceSummary() {
  // dropped: §23 UI für Sammelrechnung fertig, aber bewusst außerhalb des Umfangs gelassen (absichtlich)
  return null;
}
`,
    commitMsgs: {
      c1: "feat: Projektgerüst, erste Version von DECISIONS und BACKEND-NEEDS",
      c2: "feat: K12 m.1 Sendungslisten-API (#80)",
      c3: "chore(deps): semver von 7.5.0 auf 7.5.4 angehoben (#101)",
      c4: "refactor: Bereinigung des Sendungsdienstes",
      c5: "chore(deps): undici von 6.2.0 auf 6.2.1 angehoben (#103)",
      c6: "feat: §7 Entwurf der Barcode-Berichtsintegration",
      c7: "feat: K12 m.4 Backend für Dateiverschiebung von Sendungen",
      c8: "feat: §22 Backend für Export des Routenberichts (K30 m.2)",
      c9: "chore: Lint-Korrekturen",
      c10: "fix: K30 m.2 Bildschirm für Sendungs-Massenexport angebunden (§3)",
      c11: "test: Unit-Tests für den Sendungsdienst",
      c12: "feat: K12 m.6 Entwurf der MCP-Integration",
      c13: "docs: §99 ADR-Verzeichnis hinzugefügt (für Tests von read-decisions.mjs)",
    },
    adr1: "# ADR-0001: API-Vertrag der Sendungsliste\n\nStatus: Accepted\n\nDer Sendungslisten-Endpunkt unterstützt Paginierung.\n",
    adr2: "# ADR-0002: Format des Massenexports\n\nStatus: Accepted\n\nDer Massenexport erzeugt nur CSV; kein anderes Format.\n",
    adr3: "# ADR-0003: Routenoptimierung\n\nStatus: Rejected\n\nDie Routenoptimierung wurde für diese Version bewusst ausgeklammert.\n",
    productMd: "# Kargo\n\n- **Seitenname:** Kargo\n- **Was:** Sendungs- und Rechnungsverfolgung für kleine Logistikteams.\n",
    summaryMd: "Kargo ist ein fiktives Testprodukt, das Nosys Skripte testet (interne Anfrage 27).\n",
    logMd: "## Test\n- Mit fake-product.mjs eingerichtet; nicht von Hand bearbeitet.\n",
    decisionsPmMd: "- **Testentscheidung (Alex):** Kargo existiert nur für Nosys Tests, kein echtes Produkt.\n",
    rivalSevkpro: `# SevkPro

**Kategorie:** Logistik-SaaS
**Seite:** https://sevkpro.example (28. Sep)

## Schleifenmatrix

| # | Schritt | Code | Beleg |
|---|---|---|---|
| 1 | Sendungsliste | y | auf dem Hauptbildschirm (28. Sep) |
| 2 | Massenexport | y | CSV-Export vorhanden (28. Sep) |
| 3 | Barcode-Erfassung | y | in der mobilen App (28. Sep) |
| 4 | Rechnungsarchiv | p | nur die letzten 90 Tage (28. Sep) |
`,
    rivalYolcu360: `# Yolcu360

**Kategorie:** Flottenmanagement
**Seite:** https://yolcu360.example (28. Sep)

## Schleifenmatrix

| # | Schritt | Code | Beleg |
|---|---|---|---|
| 1 | Sendungsliste | y | (28. Sep) |
| 2 | Massenexport | y | CSV und Excel (28. Sep) |
| 3 | Barcode-Erfassung | y | (28. Sep) |
| 4 | Rechnungsarchiv | y | (28. Sep) |
`,
    usNotes: { 1: "Hauptablauf", 2: "teilweise, API vorhanden, kein Bildschirm", 3: "noch nicht", 4: "vorhanden" },
    matrixLines: [
      { feature: "Massenexport", not: "§3 Backend fertig, kein Bildschirm" },
      { feature: "Barcode-Erfassung", not: "K40-Entscheidung, noch nicht fertig" },
      { feature: "Routenoptimierung", not: "K11: wird nicht gemacht" },
      { feature: "SLA-Bericht", not: "teilweise vorhanden, Felder fehlen" },
    ],
    gh: {
      pr615Title: "K12 m.9 Ich erweitere den Bildschirm für Dateiverschiebung, auch die Reichwe…",
      pr615Body: "…ite wird größer; außerdem den Link zu §22 repariert (#777).\n\nDetails hier.",
      pr616Headline: "wip: Entwurf für Rechnungsarchiv",
      pr601Title: "WIP: §22 Bildschirm für Routenbericht",
      pr601Body: "Backend fertig, Bildschirm wird angebunden.",
      pr610Title: "Debug: Verbesserung der Sendungsprotokollierung",
      pr610Body: "console.log(card) zum Debuggen hinzugefügt; steht nicht in Zusammenhang mit K12 m.1.",
      pr611Title: "K12 m.6 Bildschirm für MCP-Integration",
      pr611Body: "Bildschirm für K12 m.6 wird hinzugefügt.",
      issue701Title: "[kargo] Anfrage für Sendungs-Massenexport",
      issue701Body: "1. Zeitraum auswählen\n2. CSV herunterladen",
      issue702Title: "Allgemeine Infrastrukturverbesserung",
      issue702Body: "Serverupgrade erforderlich.",
      issue650Title: "Eine alte Anfrage",
      commentLookingInto: "Wir schauen uns das an.",
      pr501Title: "Bildschirm für Sendungs-Sammelstorno",
      pr502Title: "Korrektur des Rechnungsarchivs",
      pr503Title: "(Auto-Abschnitt-Test)",
    },
  },
  ja: {
    decisionsMd: `# 意思決定

## K10 (9月3日, Alex): カーゴの最初のリリースは、配送モジュールと請求モジュールと共に公開する。

## K11 (9月5日, Alex): ルート最適化は当面やらない。手動割り当てで十分。

## K12 (9月10日, Alex): 配送ファイルをステージ間で移動する作業を自動化するべきだ。
- m.1: 一覧API
- m.4: ファイル移動バックエンド
- m.6: MCP連携

## K20 (9月12日, Alex): ルートレポートのエクスポートを優先する。

## K30 (9月14日, Alex): 配送の一括エクスポート画面は今スプリントでリリースする。
- m.2: 画面とAPIをつなぐ

## K40 (9月20日, Alex): バーコードスキャンは配送受付フローで必須になる。バーコードスキャナー連携が
なければ手動受付は締め切る。バーコードが読み取れない場合はエラー画面を表示する。
`,
    backendNeedsMd: "# バックエンドは準備済みだが画面がない\n\n" +
      "カーゴのバックエンドがすでに提供しているが、まだ画面につながっていない、またはステータスが不明な部分をまとめる。\n\n" +
      "### 1. 配送一覧\n\n" +
      "**Status:** `exists`\n" +
      "**Endpoint:** `GET /api/shipments`\n" +
      "**UI:** 接続済み。/shipments ページで稼働中。\n\n" +
      "### 3. 一括エクスポート\n\n" +
      "**Status:** `exists`\n" +
      "**Endpoint:** `POST /api/shipments/export`\n" +
      "バックエンドは準備できているが、まだこの画面がない。ユーザーはAPI経由でしか試せない。\n" +
      "**UI:** 未着手。\n\n" +
      "### 5. 請求書PDFアーカイブ\n\n" +
      "**Status:** `missing`\n" +
      "9月20日確認 — アーカイブ用エンドポイントは計画中で、まだ書かれていない。\n\n" +
      "### 7. バーコードレポート\n\n" +
      "**Status:** `partial`\n" +
      "9月12日計測 — 生データのみ存在し、集計レポートはない。\n\n" +
      "### 9. ルート最適化\n\n" +
      "**Status:** `missing`\n" +
      "バックエンドの計画は決定K11により当面保留された。\n",
    droppedList: `// 配送一覧ページ。
export function ShipmentList() {
  // dropped: §21 配送の一括キャンセルエンドポイントは準備済み、画面はまだ
  return null;
}
`,
    droppedPanel: `// レポートパネル。
export function ReportsPanel() {
  // dropped: §22 ルートレポートのエクスポートは準備済み、画面は未接続
  return null;
}
`,
    droppedSummary: `// 請求書サマリーページ。
export function InvoiceSummary() {
  // dropped: §23 一括請求UIは準備済みだが意図的に対象外とした(intentionally)
  return null;
}
`,
    commitMsgs: {
      c1: "feat: プロジェクトの骨組み、DECISIONSとBACKEND-NEEDSの初版",
      c2: "feat: K12 m.1 配送一覧API (#80)",
      c3: "chore(deps): semverを7.5.0から7.5.4に更新 (#101)",
      c4: "refactor: 配送サービスの整理",
      c5: "chore(deps): undiciを6.2.0から6.2.1に更新 (#103)",
      c6: "feat: §7 バーコードレポートの試験的な連携",
      c7: "feat: K12 m.4 配送ファイル移動バックエンド",
      c8: "feat: §22 ルートレポートエクスポートのバックエンド (K30 m.2)",
      c9: "chore: lint修正",
      c10: "fix: K30 m.2 配送一括エクスポート画面を接続 (§3)",
      c11: "test: 配送サービスの単体テスト",
      c12: "feat: K12 m.6 MCP連携の試作",
      c13: "docs: §99 ADRディレクトリを追加 (read-decisions.mjsのテスト用)",
    },
    adr1: "# ADR-0001: 配送一覧APIの契約\n\nStatus: Accepted\n\n配送一覧エンドポイントはページネーションに対応する。\n",
    adr2: "# ADR-0002: 一括エクスポートの形式\n\nStatus: Accepted\n\n一括エクスポートはCSVのみを生成する。他の形式はない。\n",
    adr3: "# ADR-0003: ルート最適化\n\nStatus: Rejected\n\nルート最適化は今回のリリースでは対象外とした。\n",
    productMd: "# カーゴ\n\n- **ページ名:** カーゴ\n- **概要:** 小規模な物流チーム向けの配送・請求管理。\n",
    summaryMd: "カーゴはNosyのスクリプトをテストするために作られた架空のテスト製品である(社内リクエスト27)。\n",
    logMd: "## テスト\n- fake-product.mjsで作成。手で編集していない。\n",
    decisionsPmMd: "- **テスト用の意思決定 (Alex):** カーゴはNosyのテストのためだけに存在し、実際の製品ではない。\n",
    rivalSevkpro: `# SevkPro

**カテゴリ:** 物流SaaS
**サイト:** https://sevkpro.example (9月28日)

## ループマトリクス

| # | ステップ | コード | 根拠 |
|---|---|---|---|
| 1 | 配送一覧 | y | メイン画面にあり (9月28日) |
| 2 | 一括エクスポート | y | CSVエクスポートあり (9月28日) |
| 3 | バーコードスキャン | y | モバイルアプリにあり (9月28日) |
| 4 | 請求書アーカイブ | p | 直近90日分のみ (9月28日) |
`,
    rivalYolcu360: `# Yolcu360

**カテゴリ:** 車両管理
**サイト:** https://yolcu360.example (9月28日)

## ループマトリクス

| # | ステップ | コード | 根拠 |
|---|---|---|---|
| 1 | 配送一覧 | y | (9月28日) |
| 2 | 一括エクスポート | y | CSVとExcel (9月28日) |
| 3 | バーコードスキャン | y | (9月28日) |
| 4 | 請求書アーカイブ | y | (9月28日) |
`,
    usNotes: { 1: "メインフロー", 2: "一部のみ、APIはあるが画面なし", 3: "まだ", 4: "あり" },
    matrixLines: [
      { feature: "一括エクスポート", not: "§3 バックエンドは準備済み、画面なし" },
      { feature: "バーコードスキャン", not: "K40の決定、まだ未完了" },
      { feature: "ルート最適化", not: "K11: やらないことにした" },
      { feature: "SLAレポート", not: "一部のみ存在、フィールド不足" },
    ],
    gh: {
      pr615Title: "K12 m.9 ファイル移動画面を拡張中、対象範囲も広げて…",
      pr615Body: "…いる。§22へのリンクも直した (#777)。\n\n詳細はこちら。",
      pr616Headline: "wip: 請求書アーカイブの下書き",
      pr601Title: "WIP: §22 ルートレポート画面",
      pr601Body: "バックエンドは準備済み、画面を接続中。",
      pr610Title: "デバッグ: 配送ログの改善",
      pr610Body: "デバッグ用にconsole.log(card)を追加した。K12 m.1とは無関係。",
      pr611Title: "K12 m.6 MCP連携画面",
      pr611Body: "K12 m.6用の画面を追加中。",
      issue701Title: "[カーゴ] 配送一括エクスポートの要望",
      issue701Body: "1. 期間を選ぶ\n2. CSVをダウンロードする",
      issue702Title: "一般的なインフラ改善",
      issue702Body: "サーバーのアップグレードが必要。",
      issue650Title: "古い要望",
      commentLookingInto: "確認中です。",
      pr501Title: "配送一括キャンセル画面",
      pr502Title: "請求書アーカイブの修正",
      pr503Title: "(auto-section test)",
    },
  },
};

// pm/matrix.json - the OLD (Acme Books) shape lowhanging/verify-setup/gather-evidence expect for K.matris:
// {products:[name,...], lines:[{feature,not,decision,codes:{name:code}}]}. NOTE: this differs from the
// shape build-matrix.mjs PRODUCES (steps/products:[{name,codes:{no:{k,evidence}}}]) - verify-setup already
// flags this itself ("no lines field, lowhanging's 4th signal won't work"); see log.md internal request 18.
function oldMatrixJson(locale) {
  const [bulk, barcode, route, sla] = L[locale].matrixLines;
  const name = PRODUCT_NAME[locale];
  return {
    products: [name, "DispatchPro", "Yolcu360", "RotaPlus"],
    lines: [
      { feature: bulk.feature, not: bulk.not, decision: null,
        codes: { [name]: "b", DispatchPro: "y", Yolcu360: "n", RotaPlus: "y" } },
      { feature: barcode.feature, not: barcode.not, decision: null,
        codes: { [name]: "n", DispatchPro: "y", Yolcu360: "y", RotaPlus: "y" } },
      { feature: route.feature, not: route.not, decision: "notDoing",
        codes: { [name]: "n", DispatchPro: "p", Yolcu360: "y", RotaPlus: "n" } },
      { feature: sla.feature, not: sla.not, decision: null,
        codes: { [name]: "s", DispatchPro: "y", Yolcu360: "y", RotaPlus: "y" } },
    ],
  };
}

export async function fakeProductSetup(goal, opts = {}) {
  const locale = opts.locale || "en";
  const T = L[locale] || L.en;
  const name = PRODUCT_NAME[locale] || PRODUCT_NAME.en;
  const root = goal ? path.resolve(goal) : fs.mkdtempSync(path.join(os.tmpdir(), "nosy-cargo-"));
  fs.mkdirSync(root, { recursive: true });
  const now = Date.now();
  const repoPath = path.join(root, "repo");
  const barePath = path.join(root, "origin.git");
  const pmPath = path.join(root, "pm");

  fs.mkdirSync(repoPath, { recursive: true });
  git(repoPath, ["init", "-q", "-b", "main"]);
  git(repoPath, ["config", "user.name", "Cargo Test"]);
  git(repoPath, ["config", "user.email", "test@cargo.test"]);

  const c = [];
  c.push(commitEt(repoPath, now, { day: 25, author: ALICE[0], email: ALICE[1],
    message: T.commitMsgs.c1, files: {
      "frontend/README.md": `# ${name} frontend\n`,
      "DECISIONS.md": T.decisionsMd,
      "BACKEND-NEEDS.md": T.backendNeedsMd,
      "backend/shipments.js": "export function list() { return []; }\n",
      "backend/billing.js": "export function pdfDownload() { return null; }\n",
      "backend/routes.js": "export function routes() { return []; }\n",
      "frontend/shipments/pages/List.jsx": T.droppedList,
      "frontend/reports/pages/Panel.jsx": T.droppedPanel,
      "frontend/billing/pages/Summary.jsx": T.droppedSummary,
    } }));
  c.push(commitEt(repoPath, now, { day: 21, author: BEN[0], email: BEN[1],
    message: T.commitMsgs.c2, files: {
      "backend/shipments.js": "export function list() { return db.shipments.findAll(); }\n" } }));
  c.push(commitEt(repoPath, now, { day: 19, author: BOT[0], email: BOT[1],
    message: T.commitMsgs.c3, files: {
      "backend/package.json": '{"dependencies":{"semver":"7.5.4"}}\n' } }));
  c.push(commitEt(repoPath, now, { day: 17, author: BEN[0], email: BEN[1],
    message: T.commitMsgs.c4, files: {
      "backend/shipments.js": "export function list() { return db.shipments.findAll({ order: 'asc' }); }\n" } }));
  c.push(commitEt(repoPath, now, { day: 15, author: BOT[0], email: BOT[1],
    message: T.commitMsgs.c5, files: {
      "backend/package.json": '{"dependencies":{"semver":"7.5.4","undici":"6.2.1"}}\n' } }));
  c.push(commitEt(repoPath, now, { day: 13, author: CARA[0], email: CARA[1],
    message: T.commitMsgs.c6, files: {
      "backend/barcode.js": "export function summary() { return { count: 0 }; }\n" } }));
  c.push(commitEt(repoPath, now, { day: 11, author: BEN[0], email: BEN[1],
    message: T.commitMsgs.c7, files: {
      "backend/shipments.js": "export function move(id, stage) { return db.shipments.update(id, { stage }); }\n" } }));
  c.push(commitEt(repoPath, now, { day: 9, author: ALICE[0], email: ALICE[1],
    message: T.commitMsgs.c8, files: {
      "backend/routes.js": "export function reportExport() { return csv(); }\n" } }));
  c.push(commitEt(repoPath, now, { day: 7, author: ALICE[0], email: ALICE[1],
    message: T.commitMsgs.c9, files: {
      "backend/shipments.js": "export function list() { return db.shipments.findAll({ order: 'asc' }); } // lint\n" } }));
  c.push(commitEt(repoPath, now, { day: 5, author: BEN[0], email: BEN[1],
    message: T.commitMsgs.c10, files: {
      "backend/shipments.js": "export function bulkExport() { return csv(); }\n" } }));
  c.push(commitEt(repoPath, now, { day: 3, author: CARA[0], email: CARA[1],
    message: T.commitMsgs.c11, files: {
      "backend/shipments.test.js": "// tests here\n" } }));
  c.push(commitEt(repoPath, now, { day: 1, author: ALICE[0], email: ALICE[1],
    message: T.commitMsgs.c12, files: {
      "backend/shipments.js": "export function mcpConnect() { return true; }\n" } }));
  // docs/adr/: a backward-compatible addition (read-decisions.mjs tests). DECISIONS.md and
  // the tests reading it aren't affected; only a COPY of sources.json is used when preread.decisions is set
  // to "docs/adr". Referencing "§99": doesn't CHANGE collect-status.mjs's "commits without a ref" count (5)
  // (adding a referenced commit doesn't affect the refless counter); §99 doesn't collide with any other group.
  c.push(commitEt(repoPath, now, { day: 0.5, author: BEN[0], email: BEN[1],
    message: T.commitMsgs.c13, files: {
      "docs/adr/0001-shipment-list.md": T.adr1,
      "docs/adr/0002-bulk-export.md": T.adr2,
      "docs/adr/0003-route-optimization.md": T.adr3,
    } }));

  execFileSync("git", ["init", "-q", "--bare", barePath]);
  git(repoPath, ["remote", "add", "origin", barePath]);
  git(repoPath, ["push", "-q", "origin", "main"]);
  git(repoPath, ["fetch", "-q", "origin"]);

  // --- pm/ ---------------------------------------------------------------
  fs.mkdirSync(path.join(pmPath, "state"), { recursive: true });
  fs.mkdirSync(path.join(pmPath, "rivals"), { recursive: true });
  fs.writeFileSync(path.join(pmPath, "product.md"), T.productMd);
  fs.writeFileSync(path.join(pmPath, "summary.md"), T.summaryMd);
  fs.writeFileSync(path.join(pmPath, "log.md"), T.logMd);
  fs.writeFileSync(path.join(pmPath, "decisions.md"), T.decisionsPmMd);
  const usJson = { name, codes: { 1: "y", 2: "p", 3: "n", 4: "y" }, notes: T.usNotes };
  fs.writeFileSync(path.join(pmPath, "us.json"), JSON.stringify(usJson, null, 1));
  fs.writeFileSync(path.join(pmPath, "rivals", "sevkpro.md"), T.rivalSevkpro);
  fs.writeFileSync(path.join(pmPath, "rivals", "yolcu360.md"), T.rivalYolcu360);
  fs.writeFileSync(path.join(pmPath, "matrix.json"), JSON.stringify(oldMatrixJson(locale), null, 1));

  const issueRepo = "cargo-test/cargo";
  const sources = {
    repo: repoPath,
    ref: "origin/main",
    dropped: { path: "frontend", pattern: "// dropped:", opportunity: "ready", knowingly: "intentionally" },
    request: { path: "BACKEND-NEEDS.md", title: "^### (\\d+)\\. (.+)$",
      state: "\\*\\*Status:\\*\\*\\s*`([a-z]+)`", screen_missing: "no screen for this|not started", last_day: 14 },
    matrix: path.join(pmPath, "matrix.json"),
    issue: { repo: issueRepo, our: "^\\[cargo\\]" },
    preread: { decisions: "DECISIONS.md", stale_day: 5,
      never: [{ name: "logging the card number", pattern: "console\\.log\\([^)]*\\b(card|cvv)" }] },
  };
  fs.writeFileSync(path.join(pmPath, "sources.json"), JSON.stringify(sources, null, 1));

  // --- ready-made JSON fragments for the fake `gh` (dates are relative to THIS RUN) -------
  const iso = (dayOffset, hour = 10) => relativeDate(now, dayOffset, hour).toISOString();
  const gh = {
    repoView: { name: "cargo" },
    // collect-status: open PRs' commits (gh pr list --state open --limit 30, NO -R).
    // 615: GitHub's title cut off with "…" + the body's first line starting with "…" (internal request 20 test).
    prListNoR: [
      { number: 615, title: T.gh.pr615Title,
        author: { login: "alice" }, isDraft: false,
        commits: [{ oid: "aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11",
          messageHeadline: T.gh.pr615Title,
          messageBody: T.gh.pr615Body,
          committedDate: iso(2), authors: [{ login: "alice", name: "Alice Moore" }] }] },
      { number: 616, title: "First draft for the invoice archive", author: { login: "cara" }, isDraft: true,
        commits: [{ oid: "bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22",
          messageHeadline: T.gh.pr616Headline, messageBody: "",
          committedDate: iso(1), authors: [{ login: "cara", name: "Cara Ellis" }] }] },
    ],
    // lowhanging signal 1/5 (our own PR): covers §22 -> that ref should sink down as "in PR".
    prListAuthorMe: [
      { number: 601, title: T.gh.pr601Title, body: T.gh.pr601Body },
    ],
    // preread: 610 violates the never rule (console.log(card)), 611 is clean.
    prListFull: [
      { number: 610, title: T.gh.pr610Title, author: { login: "stajyer1" },
        updatedAt: iso(0.2), createdAt: iso(1),
        body: T.gh.pr610Body,
        files: [{ path: "backend/shipments.js" }], isDraft: false,
        statusCheckRollup: [{ conclusion: "SUCCESS", status: "COMPLETED" }], mergeable: "MERGEABLE" },
      { number: 611, title: T.gh.pr611Title, author: { login: "ben" },
        updatedAt: iso(1), createdAt: iso(4), body: T.gh.pr611Body,
        files: [{ path: "frontend/shipments/pages/List.jsx" }], isDraft: false,
        statusCheckRollup: [{ conclusion: null, status: "IN_PROGRESS" }], mergeable: "MERGEABLE" },
    ],
    issueListOpen: [
      { number: 701, title: T.gh.issue701Title, author: { login: "customer1" },
        updatedAt: iso(2), body: T.gh.issue701Body },
      { number: 702, title: T.gh.issue702Title, author: { login: "customer2" },
        updatedAt: iso(3), body: T.gh.issue702Body },
    ],
    issueListAll: [
      { number: 701, title: T.gh.issue701Title, author: { login: "customer1" },
        state: "OPEN", updatedAt: iso(2), createdAt: iso(10),
        body: T.gh.issue701Body,
        comments: [{ author: { login: "alice" }, createdAt: iso(1), body: T.gh.commentLookingInto }] },
      { number: 650, title: T.gh.issue650Title, author: { login: "customer3" }, state: "CLOSED",
        updatedAt: iso(40), createdAt: iso(50), body: "old", comments: [] },
    ],
    // find-stale: 501 is called "open" but has actually merged (should be found), 502/503 are mentioned
    // in an "on main"/auto-section context so they should never count as open (no false positive) - we
    // still return MERGED for them so the test proves the script really tells them apart from context
    // (not just from gh not knowing better).
    prView: {
      "501": { state: "MERGED", mergedAt: iso(1), closedAt: iso(1), title: T.gh.pr501Title },
      "502": { state: "MERGED", mergedAt: iso(6), closedAt: iso(6), title: T.gh.pr502Title },
      "503": { state: "MERGED", mergedAt: iso(2), closedAt: iso(2), title: T.gh.pr503Title },
    },
  };

  return { root, repo: repoPath, bare: barePath, pm: pmPath, sources: path.join(pmPath, "sources.json"),
    decisionsPath: "DECISIONS.md", requestPath: "BACKEND-NEEDS.md", issueRepo, now, commits: c, gh, locale };
}

// Convenience wrappers (language-independence audit, 28 Sep 2026): same shape as fakeProductSetup, fixed locale.
export const buildFakeProductDe = goal => fakeProductSetup(goal, { locale: "de" });
export const buildFakeProductJa = goal => fakeProductSetup(goal, { locale: "ja" });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await fakeProductSetup(process.argv[2], { locale: process.argv[3] });
  console.log(JSON.stringify(result, null, 1));
}
