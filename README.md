# 🔍 Logo Extractor (ロゴ自動取得 & 透過PNG変換)

URLを入力するだけで、対象Webサイトのロゴを自動検出・抽出し、**透過PNG形式**に変換してダウンロードできるWebアプリケーションです。

Vercel（サーバーレス関数）およびGitHubでの公開に完全対応しています。

---

## ✨ 主な機能

- 🎯 **7段階のロゴ自動検出ロジック**
  1. `<img>` タグ解析（alt/class/id/src の `logo` キーワード検索、header優先、srcset対応）
  2. インライン `<svg>` ロゴ抽出（ヘッダー・ナビゲーション内）
  3. `<link rel="apple-touch-icon">` （高解像度アイコン）
  4. Open Graph 画像 (`og:image`) / Twitter Card (`twitter:image`)
  5. Favicon (`<link rel="icon">` - SVG優先)
  6. Web App Manifest (`manifest.json` 内のアイコン)
  7. デフォルトパス (`/favicon.ico`, `/logo.png`) & Google Favicon API (フォールバック)
- 🎨 **全フォーマット透過PNG変換**
  - **SVG**: ベクターデータを高解像度PNG（1024x1024等）へ高精細ラスタライズ
  - **JPG / JPEG**: 4隅・エッジピクセルの背景色を自動検出し、エッジにアンチエイリアス処理を施しながら透過化
  - **PNG / WebP / ICO**: 透過情報を保持したままPNGにフォーマット変換
- 💎 **洗練されたモダンUI**
  - ダークモードベース ＋ グラスモーフィズムデザイン
  - 透明背景がひと目でわかる市松模様プレビュー
  - レスポンシブ対応（PC・スマホ両対応）

---

## 🚀 GitHub & Vercel へのデプロイ手順

### 1. GitHub にリポジトリを作成してプッシュする

プロジェクトディレクトリで以下のコマンドを実行します：

```bash
cd logo-extractor

# Git リポジトリの初期化
git init
git add .
git commit -m "Initial commit: Logo Extractor web application"

# GitHub上の新しいリポジトリにプッシュ
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/logo-extractor.git
git push -u origin main
```

### 2. Vercel にデプロイする

1. [Vercel](https://vercel.com/) にログインし、**「Add New...」 -> 「Project」** を選択します。
2. GitHubアカウントを連携し、作成した `logo-extractor` リポジトリを選択します。
3. Framework Preset は **「Other」**（デフォルトのまま）でOKです。
4. **「Deploy」** ボタンを押すだけで、自動的にVercel Serverless Functionとしてビルド・デプロイされます！

---

## 💻 ローカル環境での起動方法

Node.js がインストールされている環境で以下を実行します：

```bash
# 依存パッケージのインストール
npm install

# ローカル開発サーバーの起動
node dev-server.js
```

ブラウザで `http://localhost:3000` にアクセスしてください。

---

## 🛠 技術構成

- **フロントエンド**: HTML5, CSS3 (Vanilla CSS with Design Tokens & Glassmorphism), JavaScript (ES6+)
- **バックエンド**: Node.js, Vercel Serverless Functions (`api/extract-logo.js`)
- **HTML解析**: `cheerio`, `axios`
- **画像処理**: `sharp` (SVG/JPG/PNG/ICO/WebP 透過PNG変換エンジン)

---

## 📄 ライセンス

MIT License
