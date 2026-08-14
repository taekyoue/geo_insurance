/* ============================================================
   GEO 평가 대시보드 — Chart Rendering & Interactions (Daily History Support)
   ============================================================ */

(function () {
  'use strict';

  // --- Company Colors & Keys ---
  const COMPANY_COLORS = {
    'KB손해보험':  { main: '#F5A623', light: 'rgba(245,166,35,0.15)', key: 'kb' },
    '삼성화재':    { main: '#1A73E8', light: 'rgba(26,115,232,0.15)', key: 'samsung' },
    '현대해상':    { main: '#00A651', light: 'rgba(0,166,81,0.15)',   key: 'hyundai' },
    'DB손해보험':  { main: '#7B61FF', light: 'rgba(123,97,255,0.15)', key: 'db' },
    '메리츠화재':  { main: '#E53E3E', light: 'rgba(229,62,62,0.15)',  key: 'meritz' },
  };

  function getColor(company) {
    return COMPANY_COLORS[company] || { main: '#a0aec0', light: 'rgba(160,174,192,0.15)', key: 'unknown' };
  }

  function fmt(v, decimals = 2) {
    if (v == null) return '—';
    return Number(v).toFixed(decimals);
  }

  // --- Chart Instances Trackers ---
  const chartInstances = {};

  function destroyChart(id) {
    if (chartInstances[id]) {
      chartInstances[id].destroy();
      delete chartInstances[id];
    }
  }

  // --- Chart.js Global Config ---
  Chart.defaults.font.family = "'Pretendard', 'Inter', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#4a5568';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
  Chart.defaults.plugins.legend.labels.padding = 16;
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(26,32,44,0.92)';
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.titleFont = { weight: '600', size: 13 };
  Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };

  // --- Guard: check data ---
  if (typeof GEO_DATA === 'undefined') {
    document.getElementById('dashboard').innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📭</div>
        <p class="empty-state__text">
          대시보드 데이터가 없습니다.<br>
          <code style="font-size: 0.8rem; color: #a0aec0;">python build_dashboard.py</code>를 먼저 실행해주세요.
        </p>
      </div>`;
    return;
  }

  // Check if legacy single data vs history data
  let historyData = {};
  let availableDates = [];
  let currentDate = '';

  if (GEO_DATA.history) {
    historyData = GEO_DATA.history;
    availableDates = GEO_DATA.available_dates || Object.keys(historyData);
    currentDate = GEO_DATA.latest_date || availableDates[0];
  } else {
    // Backward compatibility
    currentDate = 'latest';
    availableDates = ['latest'];
    historyData['latest'] = GEO_DATA;
  }

  // ============================================================
  // Header Meta & Date Selector
  // ============================================================
  function renderMeta(activeDate) {
    const currentPayload = historyData[activeDate] || historyData[availableDates[0]];
    const { meta } = currentPayload;

    const el = document.getElementById('header-meta');
    const chips = [
      { icon: '🤖', text: meta.model, accent: false },
      { icon: '🔁', text: `${meta.runs} Runs`, accent: false },
      { icon: '📄', text: `${meta.total_records}건`, accent: true },
    ];
    if (meta.failed > 0) {
      chips.push({ icon: '⚠️', text: `실패 ${meta.failed}건`, accent: false });
    }

    const dateOptionsHtml = availableDates.map(d => 
      `<option value="${d}" ${d === activeDate ? 'selected' : ''}>📅 ${d}</option>`
    ).join('');

    const html = `
      <select id="select-date" class="select-date">
        ${dateOptionsHtml}
      </select>
      ${chips.map(c => `
        <span class="meta-chip ${c.accent ? 'meta-chip--accent' : ''}">
          <span class="meta-chip__icon">${c.icon}</span>${c.text}
        </span>
      `).join('')}
      <button id="btn-refresh" class="btn-refresh" title="화면 새로고침">🔄 새로고침</button>
    `;

    el.innerHTML = html;

    document.getElementById('select-date').addEventListener('change', (e) => {
      currentDate = e.target.value;
      renderDashboard(currentDate);
    });

    document.getElementById('btn-refresh').addEventListener('click', () => {
      window.location.reload();
    });

    document.getElementById('footer-date').textContent = meta.generated_at;
  }

  // ============================================================
  // Section 1: Rank Cards
  // ============================================================
  function renderRankCards(summary) {
    const el = document.getElementById('rank-cards');
    el.innerHTML = summary.map(s => {
      const c = getColor(s.company);
      const isFirst = s.rank === 1;
      return `
        <div class="rank-card ${isFirst ? 'rank-card--1st' : ''}">
          <div class="rank-card__badge rank-card__badge--${Math.min(s.rank, 5)}">${s.rank}</div>
          <div class="rank-card__company">${s.company}</div>
          <div class="rank-card__score score-color--${c.key}">${fmt(s.geo_index)}점</div>
          <div class="rank-card__breakdown">
            <div class="rank-card__breakdown-item">
              <span class="rank-card__breakdown-label">Mention</span>
              <span class="rank-card__breakdown-value">${fmt(s.mention_score)}</span>
            </div>
            <div class="rank-card__breakdown-item">
              <span class="rank-card__breakdown-label">Citation</span>
              <span class="rank-card__breakdown-value">${fmt(s.citation_score)}</span>
            </div>
            <div class="rank-card__breakdown-item">
              <span class="rank-card__breakdown-label">M Rate</span>
              <span class="rank-card__breakdown-value">${fmt(s.mention_rate)}%</span>
            </div>
            <div class="rank-card__breakdown-item">
              <span class="rank-card__breakdown-label">C Rate</span>
              <span class="rank-card__breakdown-value">${fmt(s.citation_rate)}%</span>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // ============================================================
  // Section 1: GEO Index Bar Chart
  // ============================================================
  function renderGeoBarChart(summary) {
    destroyChart('geo-bar');
    const sorted = [...summary].sort((a, b) => b.geo_index - a.geo_index);
    const ctx = document.getElementById('chart-geo-bar').getContext('2d');

    chartInstances['geo-bar'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.map(s => s.company),
        datasets: [{
          label: 'GEO Index',
          data: sorted.map(s => s.geo_index),
          backgroundColor: sorted.map(s => getColor(s.company).main),
          borderRadius: 6,
          borderSkipped: false,
          barPercentage: 0.6,
          categoryPercentage: 0.7,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1.6,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${fmt(ctx.parsed.x)}점 / 100`,
            },
          },
        },
        scales: {
          x: {
            max: 100,
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: { callback: v => v + '점' },
          },
          y: {
            grid: { display: false },
            ticks: { font: { weight: '600' } },
          },
        },
        animation: { duration: 600, easing: 'easeOutQuart' },
      },
    });
  }

  // ============================================================
  // Section 1: Score Stack Chart
  // ============================================================
  function renderScoreStackChart(summary) {
    destroyChart('score-stack');
    const ctx = document.getElementById('chart-score-stack').getContext('2d');
    const labels = summary.map(s => s.company);

    chartInstances['score-stack'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Mention Score (/50)',
            data: summary.map(s => s.mention_score),
            backgroundColor: 'rgba(43,108,176,0.7)',
            borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 6, bottomRight: 6 },
            borderSkipped: false,
          },
          {
            label: 'Citation Score (/50)',
            data: summary.map(s => s.citation_score),
            backgroundColor: 'rgba(245,166,35,0.7)',
            borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 },
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1.6,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, max: 100, grid: { color: 'rgba(0,0,0,0.04)' } },
        },
        animation: { duration: 600, easing: 'easeOutQuart' },
      },
    });
  }

  // ============================================================
  // Section 2: Radar Chart
  // ============================================================
  function renderRadarChart(summary) {
    destroyChart('radar');
    const ctx = document.getElementById('chart-radar').getContext('2d');
    const labels = ['Mention Rate (%)', 'Mention SOV (%)', 'Citation Rate (%)', 'Citation SOV (%)'];

    const datasets = summary.map(s => {
      const c = getColor(s.company);
      return {
        label: s.company,
        data: [s.mention_rate, s.mention_sov, s.citation_rate, s.citation_sov],
        borderColor: c.main,
        backgroundColor: c.light,
        pointBackgroundColor: c.main,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
      };
    });

    // 값이 작을 때 그래프가 점처럼 보이지 않도록 축 상한을 데이터에 맞춰 조정
    const peak = Math.max(0, ...datasets.flatMap(d => d.data.map(v => Number(v) || 0)));
    const axisMax = Math.min(100, Math.max(20, Math.ceil((peak * 1.15) / 10) * 10));
    const step = axisMax / 2; // 눈금 3개(0·중간·최대)만 남겨 작은 화면에서 겹치지 않게

    chartInstances['radar'] = new Chart(ctx, {
      type: 'radar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1.1,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
        scales: {
          r: {
            beginAtZero: true,
            max: axisMax,
            ticks: { stepSize: step, font: { size: 10 }, backdropColor: 'transparent' },
            pointLabels: { font: { size: 11, weight: '500' } },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
        },
        animation: { duration: 600, easing: 'easeOutQuart' },
      },
    });
  }

  // ============================================================
  // Section 2: Detail Table
  // ============================================================
  function renderDetailTable(summary) {
    const table = document.getElementById('table-detail');
    const headers = [
      '보험사', 'M Rate (%)', 'M SOV (%)',
      'M Rate Score', 'M SOV Score', 'Mention (/50)',
      'C Rate (%)', 'C SOV (%)',
      'C Rate Score', 'C SOV Score', 'Citation (/50)',
      'GEO Index', '순위',
    ];

    let html = '<thead><tr>';
    headers.forEach((h, i) => {
      html += `<th${i > 0 ? ' class="align-right"' : ''}>${h}</th>`;
    });
    html += '</tr></thead><tbody>';

    summary.forEach(s => {
      const isKb = s.company === 'KB손해보험';
      const c = getColor(s.company);
      html += `<tr class="${isKb ? 'row--kb' : ''}">`;
      html += `<td><span class="company-name"><span class="company-dot" style="background:${c.main}"></span>${s.company}</span></td>`;
      html += `<td class="align-right tabular-nums">${fmt(s.mention_rate)}</td>`;
      html += `<td class="align-right tabular-nums">${fmt(s.mention_sov)}</td>`;
      html += `<td class="align-right tabular-nums">${fmt(s.mention_rate_score)}</td>`;
      html += `<td class="align-right tabular-nums">${fmt(s.mention_sov_score)}</td>`;
      html += `<td class="align-right tabular-nums" style="font-weight:700">${fmt(s.mention_score)}</td>`;
      html += `<td class="align-right tabular-nums">${fmt(s.citation_rate)}</td>`;
      html += `<td class="align-right tabular-nums">${fmt(s.citation_sov)}</td>`;
      html += `<td class="align-right tabular-nums">${fmt(s.citation_rate_score)}</td>`;
      html += `<td class="align-right tabular-nums">${fmt(s.citation_sov_score)}</td>`;
      html += `<td class="align-right tabular-nums" style="font-weight:700">${fmt(s.citation_score)}</td>`;
      html += `<td class="align-right tabular-nums" style="font-weight:800; color:${c.main}">${fmt(s.geo_index)}</td>`;
      html += `<td class="align-right tabular-nums" style="font-weight:700">${s.rank}</td>`;
      html += '</tr>';
    });

    html += '</tbody>';
    table.innerHTML = html;
  }

  // ============================================================
  // Section 2: 유형별 GEO Index (순위 포함)
  // ============================================================
  const TYPE_EMOJI = { '비교추천': '⚖️', '정보성': 'ℹ️', '브랜드': '🏷️' };
  const TYPE_DESC = {
    '비교추천': '“어디가 좋아?”처럼 보험사를 비교·추천받는 질문',
    '정보성': '보험 지식·절차를 묻는 질문 (브랜드 무관)',
  };

  function medal(rank) {
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
  }

  function renderTypeCards(by_type) {
    const container = document.getElementById('type-cards');
    // 브랜드는 별도 섹션에서 다루므로 유형별 인덱스에서는 제외
    const typeNames = Object.keys(by_type).filter(t => t !== '브랜드');

    // 이전 형식(순위·GEO Index 없음)으로 저장된 날짜 데이터 방어
    const isLegacy = typeNames.length > 0 &&
      typeNames.some(t => (by_type[t] || []).some(d => d.geo_index == null));
    if (typeNames.length === 0 || isLegacy) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-state__icon">🗂️</div>
          <p class="empty-state__text">
            이 날짜의 데이터는 이전 형식으로 저장되어 유형별 순위를 표시할 수 없습니다.<br>
            <code style="font-size: 0.8rem; color: #a0aec0;">python3 build_dashboard.py</code>를 다시 실행하면 갱신됩니다.
          </p>
        </div>`;
      return;
    }

    container.innerHTML = typeNames.map((typeName, idx) => {
      const data = [...by_type[typeName]].sort((a, b) => a.rank - b.rank);
      const total = data[0]?.total || 0;
      const emoji = TYPE_EMOJI[typeName] || '📋';

      let tableHtml = `<div class="table-scroll"><table class="data-table"><thead><tr>
        <th class="align-center">순위</th>
        <th>보험사</th>
        <th class="align-right">GEO Index</th>
        <th class="align-right col-optional">Mention</th>
        <th class="align-right col-optional">Citation</th>
      </tr></thead><tbody>`;

      data.forEach(d => {
        const c = getColor(d.company);
        const isKb = d.company === 'KB손해보험';
        tableHtml += `<tr class="${isKb ? 'row--kb' : ''}">`;
        tableHtml += `<td class="align-center"><span class="rank-pill rank-pill--${Math.min(d.rank, 5)}">${d.rank}</span><span class="rank-medal">${medal(d.rank)}</span></td>`;
        tableHtml += `<td><span class="company-name"><span class="company-dot" style="background:${c.main}"></span>${d.company}</span></td>`;
        tableHtml += `<td class="align-right">
          <div class="score-bar">
            <span class="score-bar__value tabular-nums" style="font-weight:800; color:${c.main}">${fmt(d.geo_index)}</span>
            <div class="score-bar__track"><div class="score-bar__fill" style="width:${Math.min(d.geo_index || 0, 100)}%; background:${c.main}"></div></div>
          </div>
        </td>`;
        tableHtml += `<td class="align-right tabular-nums col-optional">${fmt(d.mention_score)}<span class="unit">/50</span></td>`;
        tableHtml += `<td class="align-right tabular-nums col-optional">${fmt(d.citation_score)}<span class="unit">/50</span></td>`;
        tableHtml += '</tr>';
      });

      tableHtml += '</tbody></table></div>';

      return `
        <div class="type-card">
          <div class="type-card__header">
            <span class="type-card__label">${emoji} ${typeName}</span>
            <span class="type-card__count">${total}건</span>
          </div>
          <div class="type-card__body">
            <p class="type-card__desc">${TYPE_DESC[typeName] || ''}</p>
            <div class="type-card__chart">
              <canvas id="chart-type-${idx}"></canvas>
            </div>
            ${tableHtml}
          </div>
        </div>`;
    }).join('');

    typeNames.forEach((typeName, idx) => {
      const chartId = `type-${idx}`;
      destroyChart(chartId);
      const data = [...by_type[typeName]].sort((a, b) => a.rank - b.rank);
      const canvas = document.getElementById(`chart-type-${idx}`);
      if (!canvas) return;

      chartInstances[chartId] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: data.map(d => `${d.rank}. ${d.company}`),
          datasets: [
            {
              label: 'Mention Score (/50)',
              data: data.map(d => d.mention_score),
              backgroundColor: 'rgba(43,108,176,0.7)',
              borderRadius: 4,
              barPercentage: 0.72,
            },
            {
              label: 'Citation Score (/50)',
              data: data.map(d => d.citation_score),
              backgroundColor: 'rgba(245,166,35,0.7)',
              borderRadius: 4,
              barPercentage: 0.72,
            },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: 'bottom', labels: { font: { size: 10 }, padding: 8 } },
            tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.x)}` } },
          },
          scales: {
            x: { stacked: true, max: 100, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 10 } } },
            y: { stacked: true, grid: { display: false }, ticks: { font: { size: 10, weight: '600' } } },
          },
          animation: { duration: 600, easing: 'easeOutQuart' },
        },
      });
    });
  }

  // ============================================================
  // Section 3: 브랜드 문항 (자사 단독)
  // ============================================================
  function shortUrl(u) {
    try {
      const p = new URL(u);
      const path = p.pathname.length > 24 ? p.pathname.slice(0, 24) + '…' : p.pathname;
      return p.hostname.replace(/^www\./, '') + path;
    } catch (e) { return u; }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));
  }

  function renderBrand(brand) {
    const section = document.getElementById('section-brand');
    const el = document.getElementById('brand-body');
    if (!section || !el) return;

    if (!brand || !brand.total_answers) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';

    const c = getColor(brand.company);
    const sub = document.getElementById('brand-subtitle');
    if (sub) sub.textContent = `${brand.company} 단독 지표 · 종합 점수 미반영`;

    const mentionValue = brand.mention_judged
      ? `${fmt(brand.mention_rate)}<span class="unit">%</span>`
      : `<span class="stat-tile__na">미판정</span>`;

    const statsHtml = `
      <div class="brand-stats">
        <div class="stat-tile stat-tile--accent" style="--tile-accent:${c.main}">
          <span class="stat-tile__label">Citation Rate</span>
          <span class="stat-tile__value" style="color:${c.main}">${fmt(brand.citation_rate)}<span class="unit">%</span></span>
          <span class="stat-tile__sub">${brand.citation_count} / ${brand.total_answers} 답변에서 자사 출처 인용</span>
        </div>
        <div class="stat-tile">
          <span class="stat-tile__label">브랜드 문항 수</span>
          <span class="stat-tile__value">${brand.total_questions}<span class="unit">문항</span></span>
          <span class="stat-tile__sub">Run 포함 총 ${brand.total_answers}개 답변</span>
        </div>
        <div class="stat-tile">
          <span class="stat-tile__label">Citation SOV</span>
          <span class="stat-tile__value">${fmt(brand.citation_sov)}<span class="unit">%</span></span>
          <span class="stat-tile__sub">브랜드 문항 인용 중 자사 비중</span>
        </div>
        <div class="stat-tile">
          <span class="stat-tile__label">Mention Rate</span>
          <span class="stat-tile__value">${mentionValue}</span>
          <span class="stat-tile__sub">${brand.mention_judged ? '브랜드 문항 내 자사 언급률' : '브랜드 문항은 언급 판정 대상 아님'}</span>
        </div>
      </div>`;

    const rows = (brand.questions || []).map(q => {
      const hit = q.citation_hits > 0;
      const label = q.question ? q.question : `(질문 원문 없음 · ${q.question_id})`;
      const urls = (q.urls || []).length
        ? q.urls.map(u => `<a class="domain-url" href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(shortUrl(u))}</a>`).join('')
        : '<span style="color:var(--color-text-tertiary)">—</span>';
      return `<tr>
        <td class="tabular-nums brand-id">${escapeHtml(q.question_id)}</td>
        <td class="brand-q">${escapeHtml(label)}</td>
        <td class="align-center">
          <span class="pill ${hit ? 'pill--ok' : 'pill--no'}">${hit ? '인용 O' : '인용 X'}</span>
          <span class="pill-sub tabular-nums">${q.citation_hits}/${q.runs}</span>
        </td>
        <td class="brand-urls">${urls}</td>
      </tr>`;
    }).join('');

    const tableHtml = `
      <div class="data-table-wrap" style="margin-top: var(--space-5);">
        <div class="data-table-wrap__header">
          <h3 class="data-table-wrap__title">브랜드 문항별 인용 현황</h3>
          <p class="data-table-wrap__desc">Run 중 몇 번이나 자사 출처가 인용됐는지 보여줍니다</p>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>ID</th><th>질문</th><th class="align-center">인용</th><th>인용된 자사 URL</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    el.innerHTML = statsHtml + tableHtml;
  }

  // ============================================================
  // Section 4: Domains
  // ============================================================
  function renderDomains(domains) {
    destroyChart('domain-doughnut');
    const byCo = {};
    domains.forEach(d => {
      if (d.company && d.company !== '-') {
        byCo[d.company] = (byCo[d.company] || 0) + d.count;
      }
    });

    const coNames = Object.keys(byCo);
    if (coNames.length > 0) {
      const ctx = document.getElementById('chart-domain-doughnut').getContext('2d');
      chartInstances['domain-doughnut'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: coNames,
          datasets: [{
            data: coNames.map(c => byCo[c]),
            backgroundColor: coNames.map(c => getColor(c).main),
            borderWidth: 2,
            borderColor: '#fff',
            hoverOffset: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 1.3,
          cutout: '55%',
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                  const pct = ((ctx.parsed / total) * 100).toFixed(1);
                  return ` ${ctx.label}: ${ctx.parsed}회 (${pct}%)`;
                },
              },
            },
          },
          animation: { animateRotate: true, duration: 600 },
        },
      });
    }

    const table = document.getElementById('table-domains');
    let html = `<thead><tr>
      <th>도메인</th>
      <th>귀속 회사</th>
      <th>콘텐츠 유형</th>
      <th class="align-right">인용 횟수</th>
    </tr></thead><tbody>`;

    domains.forEach(d => {
      const isAssigned = d.company && d.company !== '-';
      html += `<tr>`;
      html += `<td><span class="domain-url" title="${d.example_url}">${d.domain}</span></td>`;
      html += `<td><span class="domain-tag ${isAssigned ? 'domain-tag--assigned' : ''}">${d.company || '-'}</span></td>`;
      html += `<td style="font-size: var(--text-xs); color: var(--color-text-tertiary)">${d.content_type || '-'}</td>`;
      html += `<td class="align-right tabular-nums" style="font-weight:600">${d.count}</td>`;
      html += `</tr>`;
    });

    html += '</tbody>';
    table.innerHTML = html;
  }

  // ============================================================
  // Master Render Function
  // ============================================================
  function renderDashboard(targetDate) {
    const payload = historyData[targetDate] || historyData[availableDates[0]];
    if (!payload) return;

    const { summary, by_type, brand, domains } = payload;

    renderMeta(targetDate);
    renderScopeNote(summary, brand);
    renderRankCards(summary);
    renderGeoBarChart(summary);
    renderScoreStackChart(summary);
    renderTypeCards(by_type || {});
    renderBrand(brand);
    renderRadarChart(summary);
    renderDetailTable(summary);
    renderDomains(domains);
  }

  function renderScopeNote(summary, brand) {
    const el = document.getElementById('summary-scope-note');
    if (!el) return;
    const s = summary && summary[0];
    if (!s) { el.textContent = ''; return; }
    const excluded = brand && brand.total_answers ? ` (제외된 브랜드 답변 ${brand.total_answers}건)` : '';
    el.innerHTML = `<br><span class="section__note-sub">채점 대상 답변 — Mention ${s.mention_total}건 · Citation ${s.citation_total}건${excluded}</span>`;
  }

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderDashboard(currentDate));
  } else {
    renderDashboard(currentDate);
  }

})();
