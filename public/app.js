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

  const btnNewSearch = document.getElementById('btn-new-search');

  // ── State ─────────────────────────────────────
  let isLoading = false;
  let progressInterval = null;

  // ── Loading Progress Simulation ───────────────
  const statusMessages = [
    'Webページを取得しています...',
    'HTMLを解析中...',
    'ロゴ候補を検出しています...',
    '画像を取得中...',
    '透過PNGに変換中...',
    '仕上げ中...',
  ];

  function startLoadingProgress() {
    let progress = 0;
    let messageIndex = 0;

    loadingProgressBar.style.width = '0%';
    loadingStatus.textContent = statusMessages[0];

    progressInterval = setInterval(() => {
      // Ease up to ~90% then slow down
      if (progress < 70) {
        progress += Math.random() * 8 + 2;
      } else if (progress < 90) {
        progress += Math.random() * 2 + 0.5;
      }
      progress = Math.min(progress, 92);

      loadingProgressBar.style.width = `${progress}%`;

      // Update status messages
      const newIndex = Math.min(
        Math.floor(progress / (92 / statusMessages.length)),
        statusMessages.length - 1
      );
      if (newIndex !== messageIndex) {
        messageIndex = newIndex;
        loadingStatus.textContent = statusMessages[messageIndex];
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
    // Hide all sections
    loadingSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    resultsSection.classList.add('hidden');

    // Show the requested section
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

  /** Absolute URL that triggers a direct PNG download when opened (for LINE etc.) */
  function buildDownloadShareUrl(sourceUrl, index) {
    const params = new URLSearchParams({
      url: sourceUrl,
      index: String(index),
    });
    return `${window.location.origin}${getBaseDir()}/api/download-logo?${params.toString()}`;
  }

  // ── Create Logo Card ──────────────────────────
  function createLogoCard(logo, index, domain, sourceUrl) {
    const card = document.createElement('div');
    card.className = 'logo-card';
    card.style.animationDelay = `${index * 100}ms`;

    const isBest = index === 0;

    card.innerHTML = `
      <div class="logo-card__preview">
        ${isBest ? `
          <div class="logo-card__best-badge">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            Best Match
          </div>
        ` : ''}
        <img src="${logo.base64}" alt="${domain} logo" loading="lazy">
      </div>
      <div class="logo-card__info">
        <div class="logo-card__meta">
          <span class="logo-card__source">${getSourceLabel(logo.source)}</span>
          <span class="logo-card__size">${formatFileSize(logo.fileSize)}</span>
        </div>
        <div class="logo-card__dimensions">${logo.width} × ${logo.height} px</div>
        <div class="logo-card__actions">
          <button type="button" class="btn-download" data-index="${index}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            ダウンロード
          </button>
          <button type="button" class="btn-share" data-index="${index}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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

    card.querySelector('.btn-download').addEventListener('click', () => downloadLogo(logo, domain));
    card.querySelector('.btn-share').addEventListener('click', () => shareLogo(domain, sourceUrl, index));

    return card;
  }

  // ── Download Logo ─────────────────────────────
  function downloadLogo(logo, domain) {
    const link = document.createElement('a');
    link.href = logo.base64;
    link.download = `${domain.replace(/\./g, '_')}_logo.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ── Share download URL (LINE / native share sheet) ──
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
      // User cancelled share sheet — ignore
      if (err && err.name === 'AbortError') return;
      console.error('Share API error:', err);
    }

    // Fallback: open LINE share dialog with the download URL
    const lineUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}`;
    window.open(lineUrl, '_blank', 'noopener,noreferrer');
  }

  // ── Display Results ───────────────────────────
  function displayResults(data, sourceUrl) {
    resultsDomain.textContent = data.domain;
    resultsGrid.innerHTML = '';

    data.logos.forEach((logo, index) => {
      const card = createLogoCard(logo, index, data.domain, sourceUrl);
      resultsGrid.appendChild(card);
    });

    showSection(resultsSection);

    // Scroll to results smoothly
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Display Error ─────────────────────────────
  function displayError(message) {
    errorMessage.textContent = message;
    showSection(errorSection);
  }

  // ── Extract Logo (Main Logic) ─────────────────
  async function extractLogo(url) {
    if (isLoading) return;
    isLoading = true;

    // Update UI
    btnExtract.classList.add('loading');
    btnExtract.disabled = true;
    inputHint.textContent = 'ホームページのURLを入力してください';
    inputHint.classList.remove('error');
    showSection(loadingSection);
    startLoadingProgress();

    try {
      const apiEndpoint = `${getBaseDir()}/api/extract-logo`;

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      stopLoadingProgress(data.success);

      // Short delay for the progress bar to reach 100%
      await new Promise(r => setTimeout(r, 300));

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

    // Basic URL validation
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
    urlInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Clear error hint on input
  urlInput.addEventListener('input', () => {
    if (inputHint.classList.contains('error')) {
      inputHint.textContent = 'ホームページのURLを入力してください';
      inputHint.classList.remove('error');
    }
  });

  // Allow Enter key to submit
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });

  // Auto-focus the input
  urlInput.focus();
})();
