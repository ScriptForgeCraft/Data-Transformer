/**
 * analytics.js — Hedonic Regression Analytics for Real Estate
 *
 * Mathematical Model (Semi-log / Log-linear Hedonic):
 *   ln(price_sqm) = β0 + β1·area + β2·floor + β3·floor² + Σ βi·location_dummy + ε
 *
 * This is the industry-standard form for apartment price analysis.
 * Log-transformation of the dependent variable reduces heteroskedasticity
 * and makes coefficients interpretable as % changes.
 *
 * Sources:
 *   - IMF Working Paper WP/16/213 (Hedonic Residential Property Price Indexes)
 *   - Handbook on RPPIs, Chapter 5 (Eurostat/IMF)
 *   - Sopranzetti (2010), "Hedonic Regression Analysis in Real Estate Markets: A Primer"
 */

import Chart from 'chart.js/auto';

// ─────────────────────────────────────────────────────────────────────────────
// Screen Management
// ─────────────────────────────────────────────────────────────────────────────

export function showAnalyticsScreen() {
    ['modeScreen', 'pipelineScreen', 'jsonConverterScreen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const analyticsScreen = document.getElementById('analyticsScreen');
    if (analyticsScreen) {
        analyticsScreen.style.display = 'block';
        const backBtn = document.getElementById('btnBackFromAnalytics');
        if (backBtn) backBtn.onclick = () => hideAnalyticsScreen('pipelineScreen');
    }
}

export function hideAnalyticsScreen(previousScreenId = 'pipelineScreen') {
    const analyticsScreen = document.getElementById('analyticsScreen');
    const prevScreen = document.getElementById(previousScreenId);
    if (analyticsScreen) analyticsScreen.style.display = 'none';
    if (prevScreen) prevScreen.style.display = 'block';
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────

let charts = {};

export function initAnalytics(mergedData) {
    if (!mergedData || !Array.isArray(mergedData) || mergedData.length === 0) {
        alert('No data available for analytics.');
        return;
    }

    const data = cleanData(mergedData);
    if (data.length < 10) {
        alert(`Only ${data.length} valid records found after cleaning. Need at least 10 for analysis.`);
        return;
    }

    renderCharts(data);
    runHedonicRegression(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Cleaning — handles your exact JSON structure
// ─────────────────────────────────────────────────────────────────────────────

const AMD_RATE = 400; // USD → AMD

function cleanData(rawData) {
    const cleaned = [];

    for (const item of rawData) {
        // ── Skip parking (floor < 0 or sheet contains parking keywords) ──
        const sheetName = String(item.sheet || '').toLowerCase();
        const isParkingSheet = sheetName.includes('կայան') || sheetName.includes('parking') || sheetName.includes('ավտո');
        if (isParkingSheet) continue;

        // ── Floor ──
        const floor = parseFloat(item.floor);
        if (isNaN(floor) || floor < 0 || floor > 45) continue;

        // ── Area ──
        const area = parseFloat(item.area ?? item.area_orig);
        if (isNaN(area) || area < 15 || area > 800) continue;

        // ── Currency detection ──
        const currency = String(item.currency || '').trim();
        const isUSD = currency === '$' || currency.toUpperCase() === 'USD';

        // ── Price resolution ──
        let totalPrice = parseFloat(item.price);
        let priceSqm = parseFloat(item.price_sqm);

        // Convert USD → AMD
        if (isUSD) {
            if (!isNaN(totalPrice)) totalPrice *= AMD_RATE;
            if (!isNaN(priceSqm))   priceSqm  *= AMD_RATE;
        }

        // Heuristic: Ani Premium stores price_sqm as 1450–1850 (thousands of AMD)
        // If price_sqm < 15000 and currency is null, it's in thousands → multiply
        if (!isUSD && !isNaN(priceSqm) && priceSqm > 0 && priceSqm < 15000) {
            priceSqm *= 1000;
        }

        // Cross-compute missing values
        if (isNaN(priceSqm) && !isNaN(totalPrice) && area > 0) {
            priceSqm = totalPrice / area;
        } else if (isNaN(totalPrice) && !isNaN(priceSqm) && area > 0) {
            totalPrice = priceSqm * area;
        }

        // ── Validation thresholds (Yerevan market: 300K–5M AMD/sqm) ──
        if (isNaN(priceSqm) || priceSqm < 300_000 || priceSqm > 5_000_000) continue;
        if (isNaN(totalPrice) || totalPrice < 5_000_000) continue;

        // ── Status: exclude clearly sold (avoid asking-vs-transaction bias) ──
        const status = String(item.status || '').toLowerCase().trim();
        const isSold = ['վաճaaռված', 'sold', 'продано'].some(s => status.includes(s));

        // ── Location encoding: building > sheet fallback ──
        const building = String(item.building || '').trim() || 'Unknown';
        const sheet    = String(item.sheet    || '').trim();
        const location = building; // primary grouping by project

        cleaned.push({
            area,
            floor,
            totalPrice,
            priceSqm,
            logPriceSqm: Math.log(priceSqm),  // log-transform for hedonic regression
            location,
            sheet,
            isSold,
            sizeCategory: area < 50 ? 'Small (<50m²)' : area < 90 ? 'Medium (50–90m²)' : 'Large (>90m²)',
        });
    }

    return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// OLS Linear Regression (pure JS, no external lib needed)
// Solves: X·β = y using normal equations β = (XᵀX)⁻¹·Xᵀy
// Handles arbitrary number of features including dummy variables
// ─────────────────────────────────────────────────────────────────────────────

function ols(X, y) {
    // X is n×k matrix (with intercept column), y is n×1 vector
    const n = X.length;
    const k = X[0].length;

    // Xᵀ·X
    const XtX = Array.from({ length: k }, (_, i) =>
        Array.from({ length: k }, (__, j) =>
            X.reduce((sum, row) => sum + row[i] * row[j], 0)
        )
    );

    // Xᵀ·y
    const Xty = Array.from({ length: k }, (_, i) =>
        X.reduce((sum, row, r) => sum + row[i] * y[r], 0)
    );

    // Invert XtX using Gauss-Jordan elimination
    const inv = invertMatrix(XtX);
    if (!inv) return null;

    // β = inv(XᵀX)·Xᵀy
    const beta = inv.map(row => row.reduce((s, v, j) => s + v * Xty[j], 0));

    // Residuals and R²
    const yHat = X.map(row => row.reduce((s, v, j) => s + v * beta[j], 0));
    const yMean = y.reduce((a, b) => a + b, 0) / n;
    const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
    const ssRes = y.reduce((s, v, i) => s + (v - yHat[i]) ** 2, 0);
    const rSquared = 1 - ssRes / ssTot;
    const adjR2 = 1 - (1 - rSquared) * (n - 1) / (n - k - 1);

    // Standard errors (√(σ² · diag(inv(XᵀX))))
    const sigma2 = ssRes / (n - k);
    const se = inv.map((row, i) => Math.sqrt(Math.abs(sigma2 * row[i])));

    // t-statistics
    const tStats = beta.map((b, i) => se[i] > 0 ? b / se[i] : 0);

    return { beta, yHat, rSquared, adjR2, se, tStats, ssRes, ssTot, n, k };
}

function invertMatrix(A) {
    const n = A.length;
    // Augment with identity
    const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);

    for (let col = 0; col < n; col++) {
        // Pivot
        let maxRow = col;
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
        }
        [M[col], M[maxRow]] = [M[maxRow], M[col]];

        const pivot = M[col][col];
        if (Math.abs(pivot) < 1e-12) return null; // singular

        for (let j = 0; j < 2 * n; j++) M[col][j] /= pivot;

        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const factor = M[row][col];
            for (let j = 0; j < 2 * n; j++) M[row][j] -= factor * M[col][j];
        }
    }

    return M.map(row => row.slice(n));
}

// ─────────────────────────────────────────────────────────────────────────────
// Hedonic Regression — Semi-log model
// ln(price/sqm) = β0 + β1·area + β2·floor + β3·floor² + Σ βi·location_i
// ─────────────────────────────────────────────────────────────────────────────

function runHedonicRegression(data) {
    const locations = [...new Set(data.map(d => d.location))].sort();
    const baseLocation = locations[0]; // reference category (dropped dummy)

    // Build design matrix X
    const X = data.map(d => {
        const row = [
            1,          // intercept
            d.area,     // continuous: area
            d.floor,    // continuous: floor
            d.floor ** 2, // floor squared (captures nonlinear floor premium)
        ];
        // Location dummies (omit base location to avoid multicollinearity)
        locations.slice(1).forEach(loc => row.push(d.location === loc ? 1 : 0));
        return row;
    });

    const y = data.map(d => d.logPriceSqm);
    const result = ols(X, y);

    if (!result) {
        console.warn('OLS failed — singular matrix. Check for duplicate dummy variables.');
        return;
    }

    const { beta, yHat, rSquared, adjR2, tStats } = result;

    // Feature labels
    const featureNames = ['Intercept', 'Area (m²)', 'Floor', 'Floor²',
        ...locations.slice(1).map(l => `Location: ${l}`)];

    // Residuals for analysis
    const residuals = data.map((d, i) => ({
        actual: d.priceSqm,
        predicted: Math.exp(yHat[i]),
        diff: d.priceSqm - Math.exp(yHat[i]),
        pctDiff: (d.priceSqm - Math.exp(yHat[i])) / Math.exp(yHat[i]) * 100,
        area: d.area,
        floor: d.floor,
        location: d.location,
    }));

    renderReport(data, result, beta, featureNames, tStats, locations, baseLocation, residuals);
    renderResidualsChart(residuals);
    renderFloorPremiumChart(data, beta);
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderReport(data, result, beta, featureNames, tStats, locations, baseLocation, residuals) {
    const reportContainer = document.getElementById('regressionReport');
    if (!reportContainer) return;

    const { rSquared, adjR2 } = result;

    // Floor premium: derivative of ln(price) wrt floor = β2 + 2·β3·floor
    // At median floor
    const medianFloor = [...data.map(d => d.floor)].sort((a, b) => a - b)[Math.floor(data.length / 2)];
    const floorEffect = beta[2] + 2 * beta[3] * medianFloor;
    const floorPctPerFloor = (Math.exp(floorEffect) - 1) * 100;

    // Area effect: β1 per m² (% change in price/sqm per 1m² increase in total area)
    const areaPct = (Math.exp(beta[1]) - 1) * 100;

    // Location premiums vs base
    const locationPremiums = locations.slice(1).map((loc, i) => ({
        name: loc,
        coef: beta[4 + i],
        pct: (Math.exp(beta[4 + i]) - 1) * 100,
        tStat: tStats[4 + i],
        significant: Math.abs(tStats[4 + i]) > 1.96,
    })).sort((a, b) => b.pct - a.pct);

    // Descriptive stats by location
    const locStats = {};
    data.forEach(d => {
        if (!locStats[d.location]) locStats[d.location] = { prices: [], floors: [], areas: [], count: 0 };
        locStats[d.location].prices.push(d.priceSqm);
        locStats[d.location].floors.push(d.floor);
        locStats[d.location].areas.push(d.area);
        locStats[d.location].count++;
    });

    const locRows = Object.entries(locStats).map(([loc, s]) => {
        const avgP = mean(s.prices);
        const medP = median(s.prices);
        const premium = locationPremiums.find(l => l.name === loc);
        const pct = premium ? premium.pct.toFixed(1) : '0.0 (base)';
        return `
            <tr>
                <td style="padding:6px 10px;">${loc}</td>
                <td style="padding:6px 10px;">${s.count}</td>
                <td style="padding:6px 10px;">${fmtAMD(avgP)}</td>
                <td style="padding:6px 10px;">${fmtAMD(medP)}</td>
                <td style="padding:6px 10px; color:${premium ? (premium.pct > 0 ? '#4ade80' : '#f87171') : '#71717a'}">
                    ${typeof pct === 'string' ? pct : (pct > 0 ? '+' : '') + pct + '%'}
                </td>
            </tr>`;
    }).join('');

    // Coefficient table
    const coefRows = featureNames.map((name, i) => {
        const sig = Math.abs(tStats[i]) > 1.96 ? '✓' : '·';
        const color = Math.abs(tStats[i]) > 1.96 ? '#4ade80' : '#71717a';
        return `
            <tr>
                <td style="padding:5px 10px; color:var(--accent)">${name}</td>
                <td style="padding:5px 10px">${beta[i].toFixed(5)}</td>
                <td style="padding:5px 10px">${tStats[i].toFixed(2)}</td>
                <td style="padding:5px 10px; color:${color}">${sig}</td>
            </tr>`;
    }).join('');

    // Underpriced / overpriced
    const underpriced = residuals.filter(r => r.pctDiff < -10).length;
    const overpriced  = residuals.filter(r => r.pctDiff > 10).length;
    const fairlyPriced = residuals.length - underpriced - overpriced;

    reportContainer.innerHTML = `
    <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; line-height: 1.7; color: var(--text);">

        <!-- Model Quality -->
        <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius:10px; padding:16px; margin-bottom:16px;">
            <div style="color: var(--primary); font-weight: bold; font-size: 1rem; margin-bottom: 10px;">📐 Model: Semi-log Hedonic Regression</div>
            <div style="font-size:0.75rem; color:#71717a; margin-bottom:10px;">
                <code>ln(price/m²) = β₀ + β₁·area + β₂·floor + β₃·floor² + Σβᵢ·location_dummies</code>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; text-align:center;">
                <div style="background:rgba(255,255,255,0.05); border-radius:8px; padding:10px;">
                    <div style="color:#71717a; font-size:0.7rem;">R²</div>
                    <div style="color:${rSquared > 0.7 ? '#4ade80' : '#fb923c'}; font-size:1.3rem; font-weight:bold;">${(rSquared*100).toFixed(1)}%</div>
                </div>
                <div style="background:rgba(255,255,255,0.05); border-radius:8px; padding:10px;">
                    <div style="color:#71717a; font-size:0.7rem;">Adj R²</div>
                    <div style="color:${adjR2 > 0.65 ? '#4ade80' : '#fb923c'}; font-size:1.3rem; font-weight:bold;">${(adjR2*100).toFixed(1)}%</div>
                </div>
                <div style="background:rgba(255,255,255,0.05); border-radius:8px; padding:10px;">
                    <div style="color:#71717a; font-size:0.7rem;">Observations</div>
                    <div style="color:var(--text); font-size:1.3rem; font-weight:bold;">${data.length}</div>
                </div>
            </div>
        </div>

        <!-- Key Insights -->
        <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius:10px; padding:16px; margin-bottom:16px;">
            <div style="color: var(--primary); font-weight: bold; font-size: 1rem; margin-bottom: 12px;">🔑 Key Insights</div>

            <div style="margin-bottom:12px; padding:10px; background:rgba(74,222,128,0.08); border-left:3px solid #4ade80; border-radius:4px;">
                <strong style="color:#4ade80;">🏢 Floor Effect (at floor ${medianFloor}):</strong><br>
                Going up 1 floor changes price/m² by <strong>${floorPctPerFloor > 0 ? '+' : ''}${floorPctPerFloor.toFixed(2)}%</strong>
                (coefficient has quadratic term → effect varies by floor level).
            </div>

            <div style="padding:10px; background:rgba(56,189,248,0.08); border-left:3px solid #38bdf8; border-radius:4px;">
                <strong style="color:#38bdf8;">📐 Area Effect:</strong><br>
                Each additional m² of total area changes price/m² by <strong>${areaPct > 0 ? '+' : ''}${areaPct.toFixed(3)}%</strong>
                ${areaPct < 0 ? '(larger apartments have lower price per m² — typical in this market)' : ''}.
            </div>
        </div>

        <!-- Location Table -->
        <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius:10px; padding:16px; margin-bottom:16px;">
            <div style="color: var(--primary); font-weight: bold; font-size: 1rem; margin-bottom: 10px;">📍 Location Analysis <span style="font-size:0.7rem; color:#71717a;">(base: ${baseLocation})</span></div>
            <table style="width:100%; border-collapse:collapse; font-size:0.78rem;">
                <thead>
                    <tr style="border-bottom:1px solid var(--border); color:#71717a;">
                        <th style="padding:6px 10px; text-align:left">Project</th>
                        <th style="padding:6px 10px; text-align:left">Count</th>
                        <th style="padding:6px 10px; text-align:left">Avg ֏/m²</th>
                        <th style="padding:6px 10px; text-align:left">Median ֏/m²</th>
                        <th style="padding:6px 10px; text-align:left">Premium vs base</th>
                    </tr>
                </thead>
                <tbody>${locRows}</tbody>
            </table>
        </div>

        <!-- Pricing Distribution -->
        <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius:10px; padding:16px; margin-bottom:16px;">
            <div style="color: var(--primary); font-weight: bold; font-size: 1rem; margin-bottom: 10px;">💰 Pricing vs Model (±10% tolerance)</div>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; text-align:center;">
                <div style="background:rgba(74,222,128,0.1); border-radius:8px; padding:10px;">
                    <div style="color:#71717a; font-size:0.7rem;">Underpriced</div>
                    <div style="color:#4ade80; font-size:1.2rem; font-weight:bold;">${underpriced}</div>
                    <div style="font-size:0.65rem; color:#71717a;">Good deals</div>
                </div>
                <div style="background:rgba(255,255,255,0.05); border-radius:8px; padding:10px;">
                    <div style="color:#71717a; font-size:0.7rem;">Fair price</div>
                    <div style="font-size:1.2rem; font-weight:bold;">${fairlyPriced}</div>
                    <div style="font-size:0.65rem; color:#71717a;">Market rate</div>
                </div>
                <div style="background:rgba(248,113,113,0.1); border-radius:8px; padding:10px;">
                    <div style="color:#71717a; font-size:0.7rem;">Overpriced</div>
                    <div style="color:#f87171; font-size:1.2rem; font-weight:bold;">${overpriced}</div>
                    <div style="font-size:0.65rem; color:#71717a;">Above market</div>
                </div>
            </div>
        </div>

        <!-- Coefficient Table -->
        <details style="margin-bottom:8px;">
            <summary style="cursor:pointer; color:var(--accent); padding:8px 0; font-size:0.8rem;">▶ Full Regression Coefficients</summary>
            <table style="width:100%; border-collapse:collapse; font-size:0.75rem; margin-top:8px;">
                <thead>
                    <tr style="border-bottom:1px solid var(--border); color:#71717a;">
                        <th style="padding:5px 10px; text-align:left">Variable</th>
                        <th style="padding:5px 10px; text-align:left">β coefficient</th>
                        <th style="padding:5px 10px; text-align:left">t-stat</th>
                        <th style="padding:5px 10px; text-align:left">Sig (>1.96)</th>
                    </tr>
                </thead>
                <tbody>${coefRows}</tbody>
            </table>
        </details>

    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Charts
// ─────────────────────────────────────────────────────────────────────────────

function renderCharts(data) {
    renderCorrelationTable(data);
    renderFloorVsPriceSqm(data);
    renderPriceVarianceByFloor(data);
    renderAreaVsTotalPrice(data);
    renderPriceByLocation(data);
}

function pearsonCorrelation(x, y) {
    const n = x.length;
    const mx = x.reduce((a, b) => a + b, 0) / n;
    const my = y.reduce((a, b) => a + b, 0) / n;
    const num = x.reduce((s, xi, i) => s + (xi - mx) * (y[i] - my), 0);
    const den = Math.sqrt(
        x.reduce((s, xi) => s + (xi - mx) ** 2, 0) *
        y.reduce((s, yi) => s + (yi - my) ** 2, 0)
    );
    return den === 0 ? 0 : num / den;
}

function renderCorrelationTable(data) {
    const container = document.getElementById('correlationContainer');
    if (!container) return;

    const areas      = data.map(d => d.area);
    const floors     = data.map(d => d.floor);
    const totalPrices= data.map(d => d.totalPrice);
    const priceSqms  = data.map(d => d.priceSqm);

    const factors = [
        { name: 'Area (m²)',    arr: areas },
        { name: 'Floor',        arr: floors },
    ];

    const targets = [
        { name: 'Price/m² (֏)', arr: priceSqms },
        { name: 'Total Price (֏)', arr: totalPrices },
    ];

    const rows = factors.map(f => {
        const cols = targets.map(t => {
            const r = pearsonCorrelation(f.arr, t.arr);
            const color = r > 0.4 ? '#4ade80' : r < -0.4 ? '#f87171' : '#71717a';
            return `<td style="padding:8px 12px; color:${color}; font-weight:bold;">${r.toFixed(3)}</td>`;
        }).join('');
        return `<tr><td style="padding:8px 12px; color:var(--accent)">${f.name}</td>${cols}</tr>`;
    }).join('');

    container.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:0.82rem; color:var(--text);">
            <thead>
                <tr style="border-bottom:1px solid var(--border); color:#71717a;">
                    <th style="padding:8px 12px; text-align:left">Factor</th>
                    ${targets.map(t => `<th style="padding:8px 12px; text-align:left">${t.name}</th>`).join('')}
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div style="font-size:0.7rem; color:#52525b; margin-top:6px;">
            Pearson r: >0.4 positive&nbsp;·&nbsp;<0 negative&nbsp;·&nbsp;near 0 no linear correlation
        </div>`;
}

function destroyChart(id) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

const CHART_OPTS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#e4e4e7' } } },
    scales: {
        x: { grid: { color: '#27272a' }, ticks: { color: '#71717a' } },
        y: { grid: { color: '#27272a' }, ticks: { color: '#71717a' } },
    }
};

function renderFloorVsPriceSqm(data) {
    const ctx = document.getElementById('chartFloorVsPrice');
    if (!ctx) return;
    destroyChart('chartFloorVsPrice');

    const categories = ['Small (<50m²)', 'Medium (50–90m²)', 'Large (>90m²)'];
    const colors = ['#60a5fa', '#fb923c', '#4ade80'];

    charts['chartFloorVsPrice'] = new Chart(ctx.getContext('2d'), {
        type: 'scatter',
        data: {
            datasets: categories.map((cat, i) => ({
                label: cat,
                data: data.filter(d => d.sizeCategory === cat).map(d => ({ x: d.floor, y: d.priceSqm })),
                backgroundColor: colors[i],
                pointRadius: 4,
                pointHoverRadius: 7,
            }))
        },
        options: {
            ...CHART_OPTS,
            scales: {
                x: { ...CHART_OPTS.scales.x, title: { display: true, text: 'Floor', color: '#71717a' } },
                y: { ...CHART_OPTS.scales.y, title: { display: true, text: 'Price/m² (֏)', color: '#71717a' } }
            },
            plugins: {
                ...CHART_OPTS.plugins,
                tooltip: { callbacks: { label: ctx => [`Floor: ${ctx.raw.x}`, `Price/m²: ${fmtAMD(ctx.raw.y)}`] } }
            }
        }
    });
}

function renderPriceVarianceByFloor(data) {
    const ctx = document.getElementById('chartPriceVariance');
    if (!ctx) return;
    destroyChart('chartPriceVariance');

    // Aggregate: mean + std dev per floor
    const floorMap = {};
    data.forEach(d => {
        if (!floorMap[d.floor]) floorMap[d.floor] = [];
        floorMap[d.floor].push(d.priceSqm);
    });

    const floors    = Object.keys(floorMap).map(Number).sort((a, b) => a - b);
    const means     = floors.map(f => mean(floorMap[f]));
    const stds      = floors.map(f => stdDev(floorMap[f]));
    const errorBars = floors.map((f, i) => ({ x: f, y: means[i], yMin: means[i] - stds[i], yMax: means[i] + stds[i] }));

    charts['chartPriceVariance'] = new Chart(ctx.getContext('2d'), {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Mean Price/m²',
                    data: floors.map((f, i) => ({ x: f, y: means[i] })),
                    backgroundColor: '#a78bfa',
                    borderColor: '#7c3aed',
                    pointRadius: 6,
                    pointHoverRadius: 9,
                },
                {
                    label: '±1 Std Dev',
                    data: errorBars.flatMap(d => [
                        { x: d.x, y: d.yMax },
                        { x: d.x, y: d.yMin },
                        { x: null, y: null },
                    ]),
                    type: 'line',
                    showLine: false,
                    backgroundColor: 'rgba(167,139,250,0.2)',
                    borderColor: 'rgba(167,139,250,0.4)',
                    pointRadius: 3,
                }
            ]
        },
        options: {
            ...CHART_OPTS,
            scales: {
                x: { ...CHART_OPTS.scales.x, title: { display: true, text: 'Floor', color: '#71717a' } },
                y: { ...CHART_OPTS.scales.y, title: { display: true, text: 'Price/m² (֏)', color: '#71717a' } }
            },
            plugins: {
                ...CHART_OPTS.plugins,
                tooltip: { callbacks: { label: ctx => `Floor ${ctx.raw.x}: ${fmtAMD(ctx.raw.y)}` } }
            }
        }
    });
}

function renderAreaVsTotalPrice(data) {
    const ctx = document.getElementById('chartAreaVsTotal');
    if (!ctx) return;
    destroyChart('chartAreaVsTotal');

    const locations = [...new Set(data.map(d => d.location))];
    const palette   = ['#e8ff47', '#60a5fa', '#fb923c', '#4ade80', '#f472b6', '#a78bfa'];

    charts['chartAreaVsTotal'] = new Chart(ctx.getContext('2d'), {
        type: 'scatter',
        data: {
            datasets: locations.map((loc, i) => ({
                label: loc,
                data: data.filter(d => d.location === loc).map(d => ({ x: d.area, y: d.totalPrice, floor: d.floor })),
                backgroundColor: palette[i % palette.length],
                pointRadius: 4,
                pointHoverRadius: 7,
            }))
        },
        options: {
            ...CHART_OPTS,
            scales: {
                x: { ...CHART_OPTS.scales.x, title: { display: true, text: 'Area (m²)', color: '#71717a' } },
                y: { ...CHART_OPTS.scales.y, title: { display: true, text: 'Total Price (֏)', color: '#71717a' } }
            },
            plugins: {
                ...CHART_OPTS.plugins,
                tooltip: { callbacks: { label: ctx => [`Area: ${ctx.raw.x} m²`, `Price: ${fmtAMD(ctx.raw.y)}`, `Floor: ${ctx.raw.floor}`] } }
            }
        }
    });
}

function renderPriceByLocation(data) {
    const ctx = document.getElementById('chartPriceByLocation');
    if (!ctx) return;
    destroyChart('chartPriceByLocation');

    const locMap = {};
    data.forEach(d => {
        if (!locMap[d.location]) locMap[d.location] = [];
        locMap[d.location].push(d.priceSqm);
    });

    const locs    = Object.keys(locMap);
    const means   = locs.map(l => mean(locMap[l]));
    const medians = locs.map(l => median(locMap[l]));

    const sorted  = locs.map((l, i) => ({ l, m: means[i], med: medians[i] })).sort((a, b) => b.m - a.m);

    charts['chartPriceByLocation'] = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: sorted.map(s => s.l),
            datasets: [
                {
                    label: 'Avg Price/m²',
                    data: sorted.map(s => s.m),
                    backgroundColor: 'rgba(56,189,248,0.7)',
                    borderColor: '#38bdf8',
                    borderWidth: 1,
                    borderRadius: 4,
                },
                {
                    label: 'Median Price/m²',
                    data: sorted.map(s => s.med),
                    backgroundColor: 'rgba(232,255,71,0.5)',
                    borderColor: '#e8ff47',
                    borderWidth: 1,
                    borderRadius: 4,
                }
            ]
        },
        options: {
            ...CHART_OPTS,
            scales: {
                x: { ...CHART_OPTS.scales.x, title: { display: true, text: 'Project', color: '#71717a' } },
                y: { ...CHART_OPTS.scales.y, title: { display: true, text: 'Price/m² (֏)', color: '#71717a' } }
            },
            plugins: {
                ...CHART_OPTS.plugins,
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtAMD(ctx.raw)}` } }
            }
        }
    });
}

function renderFloorPremiumChart(data, beta) {
    const ctx = document.getElementById('chartFloorPremium');
    if (!ctx) return;
    destroyChart('chartFloorPremium');

    // Marginal floor effect: d(ln P)/d(floor) = β2 + 2·β3·floor → convert to %
    const floors = Array.from({ length: 18 }, (_, i) => i + 1);
    const effects = floors.map(f => (Math.exp(beta[2] + 2 * beta[3] * f) - 1) * 100);

    charts['chartFloorPremium'] = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: floors,
            datasets: [{
                label: '% Change in Price/m² per Floor',
                data: effects,
                borderColor: '#4ade80',
                backgroundColor: 'rgba(74,222,128,0.15)',
                fill: true,
                pointRadius: 4,
                tension: 0.4,
            }]
        },
        options: {
            ...CHART_OPTS,
            scales: {
                x: { ...CHART_OPTS.scales.x, title: { display: true, text: 'Floor Level', color: '#71717a' } },
                y: { ...CHART_OPTS.scales.y, title: { display: true, text: '% Change per Floor', color: '#71717a' } }
            },
            plugins: {
                ...CHART_OPTS.plugins,
                tooltip: { callbacks: { label: ctx => `Floor ${ctx.label}: ${ctx.raw.toFixed(2)}%/floor` } }
            }
        }
    });
}

function renderResidualsChart(residuals) {
    const ctx = document.getElementById('chartResiduals');
    if (!ctx) return;
    destroyChart('chartResiduals');

    const pctData = residuals.map(r => ({ x: r.predicted, y: r.pctDiff, location: r.location }));

    charts['chartResiduals'] = new Chart(ctx.getContext('2d'), {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Residuals % (Actual − Predicted)',
                data: pctData,
                backgroundColor: pctData.map(d => d.y > 10 ? 'rgba(248,113,113,0.7)' : d.y < -10 ? 'rgba(74,222,128,0.7)' : 'rgba(167,139,250,0.6)'),
                pointRadius: 5,
                pointHoverRadius: 8,
            }]
        },
        options: {
            ...CHART_OPTS,
            scales: {
                x: { ...CHART_OPTS.scales.x, title: { display: true, text: 'Predicted Price/m² (֏)', color: '#71717a' } },
                y: { ...CHART_OPTS.scales.y, title: { display: true, text: '% Deviation from Model', color: '#71717a' } }
            },
            plugins: {
                ...CHART_OPTS.plugins,
                tooltip: {
                    callbacks: {
                        label: ctx => [
                            `Predicted: ${fmtAMD(ctx.raw.x)}`,
                            `Deviation: ${ctx.raw.y.toFixed(1)}%`,
                            `Project: ${ctx.raw.location}`,
                        ]
                    }
                }
            }
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdDev(arr) {
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function fmtAMD(val) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(val) + ' ֏';
}