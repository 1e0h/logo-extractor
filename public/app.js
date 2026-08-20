/* ════════════════════════════════════════════════
   Logo Extractor — Client-side Application Logic
   ════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── DOM References ────────────────────────────
  const form = document.getElementById('extract-form');
  const urlInput = document.getElementById('url-input');
  const btnExtract = document.getElementById('btn-extract');
  const inputHint = document.getElementById('input-hint');

  const loadingSection = document.getElementById('loading-section');
  const loadingStatus = document.getElementById('loading-status');
  const loadingProgressBar = document.getElementById('loading-progress-bar');

  const errorSection = document.getElementById('error-section');
  const errorMessage = document.getElementById('error-message');
  const btnRetry = document.getElementById('btn-retry');

  const resultsSection = document.getElementById('results-section');
  const resultsDomain = document.getElementById('results-domain');
  const resultsGrid = document.getElementById('results-grid');
  const deepSearch = document.getElementById('deep-search');
  const btnDeepSearch = document.getElementById('btn-deep-search');
  const deepSearchHint = document.getElementById('deep-search-hint');

  const btnNewSearch = document.getElementById('btn-new-search');

  // ── State ─────────────────────────────────────
  let isLoading = false;
  let progressInterval = null;
  let currentSourceUrl = '';
  let currentLogos = [];
  let deepSearchDone = false;

  // ── Loading Progress Simulation ───────────────
  const statusMessages = [
    'Webページを取得しています...',
    'HTMLを解析中...',
    'ロゴ候補を検出しています...',
    '画像を取得中...',
    '透過PNGに変換中...',
    '仕上げ中...',
  ];

  const deepStatusMessages = [
    'ページを再解析しています...',
    'ヘッダー画像を広く収集中...',
    '追加の候補を探しています...',
    '画像を変換中...',
  ];

  function startLoadingProgress(messages) {
    const msgs = messages || statusMessages;
    let progress = 0;
    let messageIndex = 0;

    loadingProgressBar.style.width = '0%';
    loadingStatus.textContent = msgs[0];

    progressInterval = setInterval(() => {
      if (progress < 70) {
        progress += Math.random() * 8 + 2;
      } else if (progress < 90) {
        progress += Math.random() * 2 + 0.5;
      }
      progress = Math.min(progress, 92);

      loadingProgressBar.style.width = `${progress}%`;

      const newIndex = Math.min(
        Math.floor(progress / (92 / msgs.length)),
        msgs.length - 1
      );
      if (newIndex !== messageIndex) {
        messageIndex = newIndex;
        loadingStatus.textContent = msgs[messageIndex];
      }
    }, 300);
  }

  function stopLoadingProgress(success) {
    clearInterval(progressInterval);
    progressInterval = null;
    loadingProgressBar.style.width = success ? '100%' : '0%';
  }

  // ── Section Visibility ────────────────────────
  function showSection(section) {
    loadingSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    resultsSection.classList.add('hidden');

    if (section) {
      section.classList.remove('hidden');
    }
  }

  // ── Format File Size ──────────────────────────
  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ── Source Label Mapping ──────────────────────
  function getSourceLabel(source) {
    const labels = {
      'img-logo': 'HTMLロゴ画像',
      'img-logo-parent': 'HTMLロゴ画像',
      'img-logo-srcset': 'HTMLロゴ画像 (高解像度)',
      'inline-svg': 'インラインSVG',
      'studio-header-logo': 'Studioヘッダーロゴ',
      'studio-page-image': 'Studioページ画像',
      'deep-header-img': 'ヘッダー画像（詳細）',
      'deep-srcset': '高解像度候補（詳細）',
      'deep-css-bg': 'CSS背景（詳細）',
      'deep-default-path': '追加パス（詳細）',
      'apple-touch-icon': 'Apple Touch Icon',
      'og:image': 'OGP画像',
      'twitter:image': 'Twitter Card',
      'favicon': 'Favicon',
      'manifest-icon': 'Webマニフェスト',
      'ms-tile': 'Microsoft Tile',
      'default-favicon': 'デフォルトFavicon',
      'default-logo-path': 'デフォルトパス',
      'google-favicon-api': 'Google Favicon API',
    };
    return labels[source] || source;
  }

  function getBaseDir() {
    return window.location.pathname.includes('logo-extractor') ? '/logo-extractor' : '';
  }

  function buildDownloadShareUrl(sourceUrl, index) {
    const params = new URLSearchParams({
      url: sourceUrl,
      index: String(index),
    });
    return `${window.location.origin}${getBaseDir()}/api/download-logo?${params.toString()}`;
  }

  // ── Create Logo Card ──────────────────────────
  function createLogoCard(logo, index, domain, sourceUrl, options = {}) {
    const card = document.createElement('div');
    card.className = 'logo-card';
    card.style.animationDelay = `${index * 80}ms`;

    const isBest = index === 0 && !options.isAdditional;
    const isAdditional = Boolean(options.isAdditional);

    card.innerHTML = `
      <div class="logo-card__preview">
        ${isBest ? `<div class="logo-card__best-badge">おすすめ</div>` : ''}
        ${isAdditional ? `<div class="logo-card__extra-badge">追加候補</div>` : ''}
        <img src="${logo.base64}" alt="${domain} logo" loading="lazy">
      </div>
      <div class="logo-card__info">
        <div class="logo-card__meta">
          <span class="logo-card__source">${getSourceLabel(logo.source)}</span>
          <span class="logo-card__size">${formatFileSize(logo.fileSize)}</span>
        </div>
        <div class="logo-card__dimensions">${logo.width} × ${logo.height} px</div>
        <div class="logo-card__actions">
          <button type="button" class="btn btn--tint" data-action="download">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            ダウンロード
          </button>
          <button type="button" class="btn btn--share" data-action="share">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3"/>
              <circle cx="6" cy="12" r="3"/>
              <circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            共有
          </button>
        </div>
      </div>
    `;

    card.querySelector('[data-action="download"]').addEventListener('click', () => downloadLogo(logo, domain));
    card.querySelector('[data-action="share"]').addEventListener('click', () => shareLogo(domain, sourceUrl, index));

    return card;
  }

  function downloadLogo(logo, domain) {
    const link = document.createElement('a');
    link.href = logo.base64;
    link.download = `${domain.replace(/\./g, '_')}_logo.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function shareLogo(domain, sourceUrl, index) {
    const shareUrl = buildDownloadShareUrl(sourceUrl, index);
    const title = `${domain} のロゴ`;
    const text = `${domain} の透過PNGロゴ（タップでダウンロード）`;

    try {
      if (navigator.share) {
        await navigator.share({ title, text, url: shareUrl });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.error('Share API error:', err);
    }

    const lineUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}`;
    window.open(lineUrl, '_blank', 'noopener,noreferrer');
  }

  function renderLogoGrid(logos, domain, sourceUrl, options = {}) {
    const { append = false, additionalFrom = 0 } = options;
    if (!append) {
      resultsGrid.innerHTML = '';
    }

    logos.forEach((logo, i) => {
      const index = append ? additionalFrom + i : i;
      const card = createLogoCard(logo, index, domain, sourceUrl, {
        isAdditional: append,
      });
      resultsGrid.appendChild(card);
    });
  }

  function resetDeepSearchUi() {
    deepSearchDone = false;
    deepSearch.classList.remove('hidden');
    btnDeepSearch.disabled = false;
    btnDeepSearch.classList.remove('loading');
    deepSearchHint.classList.add('hidden');
    deepSearchHint.textContent = '';
  }

  function displayResults(data, sourceUrl) {
    currentSourceUrl = sourceUrl;
    currentLogos = data.logos.slice();
    resultsDomain.textContent = data.domain;
    renderLogoGrid(currentLogos, data.domain, sourceUrl);
    resetDeepSearchUi();
    showSection(resultsSection);
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function displayError(message) {
    errorMessage.textContent = message;
    showSection(errorSection);
  }

  async function extractLogo(url) {
    if (isLoading) return;
    isLoading = true;

    btnExtract.classList.add('loading');
    btnExtract.disabled = true;
    inputHint.textContent = 'ホームページのURLを入力してください';
    inputHint.classList.remove('error');
    showSection(loadingSection);
    startLoadingProgress();

    try {
      const response = await fetch(`${getBaseDir()}/api/extract-logo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();
      stopLoadingProgress(data.success);
      await new Promise((r) => setTimeout(r, 300));

      if (!data.success) {
        displayError(data.error || 'ロゴの取得に失敗しました。');
        return;
      }

      displayResults(data, url);
    } catch (err) {
      stopLoadingProgress(false);
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        displayError('サーバーに接続できません。ネットワーク接続を確認してください。');
      } else {
        displayError(`予期しないエラーが発生しました: ${err.message}`);
      }
    } finally {
      isLoading = false;
      btnExtract.classList.remove('loading');
      btnExtract.disabled = false;
    }
  }

  async function runDeepSearch() {
    if (isLoading || deepSearchDone || !currentSourceUrl) return;
    isLoading = true;

    btnDeepSearch.classList.add('loading');
    btnDeepSearch.disabled = true;
    deepSearchHint.classList.add('hidden');

    // Keep results visible; show inline busy state on the button
    const excludeUrls = currentLogos
      .map((l) => l.originalUrl)
      .filter((u) => u && u !== '(inline)');

    try {
      const response = await fetch(`${getBaseDir()}/api/extract-logo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: currentSourceUrl,
          deep: true,
          excludeUrls,
        }),
      });

      const data = await response.json();

      if (!data.success || !data.logos || data.logos.length === 0) {
        deepSearchHint.textContent = '追加の候補は見つかりませんでした。';
        deepSearchHint.classList.remove('hidden');
        deepSearchDone = true;
        return;
      }

      const startIndex = currentLogos.length;
      currentLogos = currentLogos.concat(data.logos);
      renderLogoGrid(data.logos, data.domain || resultsDomain.textContent, currentSourceUrl, {
        append: true,
        additionalFrom: startIndex,
      });

      deepSearchHint.textContent = `${data.logos.length}件の追加候補を表示しました。`;
      deepSearchHint.classList.remove('hidden');
      deepSearchDone = true;

      deepSearch.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      console.error('Deep search error:', err);
      deepSearchHint.textContent = '詳細検索に失敗しました。もう一度お試しください。';
      deepSearchHint.classList.remove('hidden');
      btnDeepSearch.disabled = false;
    } finally {
      isLoading = false;
      btnDeepSearch.classList.remove('loading');
      if (deepSearchDone) {
        btnDeepSearch.disabled = true;
      }
    }
  }

  // ── Event Handlers ────────────────────────────
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();

    if (!url) {
      inputHint.textContent = 'URLを入力してください';
      inputHint.classList.add('error');
      urlInput.focus();
      return;
    }

    const urlPattern = /^(https?:\/\/)?[\w.-]+\.\w{2,}/i;
    if (!urlPattern.test(url)) {
      inputHint.textContent = '有効なURLを入力してください（例: apple.com）';
      inputHint.classList.add('error');
      urlInput.focus();
      return;
    }

    extractLogo(url);
  });

  btnRetry.addEventListener('click', () => {
    showSection(null);
    urlInput.focus();
  });

  btnNewSearch.addEventListener('click', () => {
    showSection(null);
    urlInput.value = '';
    currentSourceUrl = '';
    currentLogos = [];
    deepSearchDone = false;
    urlInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  btnDeepSearch.addEventListener('click', () => {
    runDeepSearch();
  });

  urlInput.addEventListener('input', () => {
    if (inputHint.classList.contains('error')) {
      inputHint.textContent = 'ホームページのURLを入力してください';
      inputHint.classList.remove('error');
    }
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });

  urlInput.focus();
})();
