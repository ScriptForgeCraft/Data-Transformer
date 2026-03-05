import Chart from 'chart.js/auto';
import MultivariateLinearRegression from 'ml-regression-multivariate-linear';

export function showAnalyticsScreen() {
    const modeScreen = document.getElementById("modeScreen");
    const pipelineScreen = document.getElementById("pipelineScreen");
    const jsonConverterScreen = document.getElementById("jsonConverterScreen");
    const analyticsScreen = document.getElementById("analyticsScreen");

    if (modeScreen) modeScreen.style.display = "none";
    if (pipelineScreen) pipelineScreen.style.display = "none";
    if (jsonConverterScreen) jsonConverterScreen.style.display = "none";
    if (analyticsScreen) {
        analyticsScreen.style.display = "block";
        const backBtn = document.getElementById("btnBackFromAnalytics");
        if (backBtn) {
            backBtn.onclick = () => hideAnalyticsScreen("pipelineScreen");
        }
    }
}

export function hideAnalyticsScreen(previousScreenId = "pipelineScreen") {
    const analyticsScreen = document.getElementById("analyticsScreen");
    const prevScreen = document.getElementById(previousScreenId);
    if (analyticsScreen) analyticsScreen.style.display = "none";
    if (prevScreen) prevScreen.style.display = "block";
}

let charts = {};

export function initAnalytics(mergedData) {
    if (!mergedData || !Array.isArray(mergedData) || mergedData.length === 0) {
        alert("No data available for analytics.");
        return;
    }

    const data = cleanData(mergedData);
    if (data.length === 0) {
        alert("No valid numeric data found for analytics (need Area, Floor, Price).");
        return;
    }

    renderCharts(data);
    runHedonicRegression(data);

}

function cleanData(mergedData) {
    const cleaned = [];
    for (const item of mergedData) {
        // Extract numeric values, handle possible string representations or missing data
        let area = parseFloat(item.area || item.Area_Sqm);
        let floor = parseFloat(item.floor || item.Floor);
        let totalPrice = parseFloat(item.price || item.Total_Price);
        let priceSqm = parseFloat(item.price_sqm || item.Price_Sqm);

        let currency = item.currency || "";

        // Smart fallback extractor for missing string fields (like from Word extraction)
        if (isNaN(totalPrice) && isNaN(priceSqm)) {
            for (const key in item) {
                const kLower = key.toLowerCase();
                if (kLower.includes("գին") || kLower.includes("արժեք") || kLower.includes("price") || kLower.includes("արժ")) {
                    const val = String(item[key]);
                    const matches = val.match(/[\d,.]+/g);
                    if (matches && matches.length > 0) {
                        const nums = matches.map(m => parseFloat(m.replace(/,/g, ''))).filter(n => !isNaN(n) && n > 0);
                        if (nums.length > 0) {
                            let avg = nums.reduce((a, b) => a + b, 0) / nums.length;
                            // Assume USD if below 15000 or has dollar sign
                            if (val.includes("$") || val.toUpperCase().includes("USD") || avg < 15000) {
                                avg *= 400; // approximate AMD multiplier
                            }
                            // Detect if it's Price/Sqm or Total Price based on value thresholds
                            if (avg >= 150000 && avg <= 6000000) {
                                priceSqm = avg;
                                break;
                            } else if (avg >= 10000000 && avg <= 2000000000) {
                                totalPrice = avg;
                                break;
                            }
                        }
                    }
                }
            }
        }

        let isUSD = currency.includes("$") || currency.toUpperCase().includes("USD");

        // Heuristic: scale shorthand prices (e.g. 200 becomes 200,000)
        if (!isNaN(totalPrice) && totalPrice > 0 && totalPrice < 15000) {
            totalPrice *= 1000;
            isUSD = true; // small shorthand values usually mean thousands of USD in local real estate
        }

        if (!isNaN(priceSqm) && priceSqm > 0 && priceSqm < 15000) {
            isUSD = true; // $1500 / sqm
        }

        // Apply Currency Normalization to pure AMD
        if (isUSD) {
            if (!isNaN(totalPrice)) totalPrice *= 400;
            if (!isNaN(priceSqm)) priceSqm *= 400;
        }

        if (isNaN(priceSqm) && !isNaN(totalPrice) && !isNaN(area) && area > 0) {
            priceSqm = totalPrice / area;
        } else if (isNaN(totalPrice) && !isNaN(priceSqm) && !isNaN(area) && area > 0) {
            totalPrice = priceSqm * area;
        }

        // Strict validation to avoid skewing regression modeling (like `floor 60` or `priceSqm 20,000,000`)
        if (!isNaN(area) && !isNaN(floor) && !isNaN(totalPrice) && !isNaN(priceSqm)) {
            if (area >= 15 && area <= 800 && floor >= -2 && floor <= 45) {
                if (priceSqm >= 150000 && priceSqm <= 5000000) { // Reasonable price / sqm in AMD
                    if (totalPrice >= 3000000) { // Reasonable minimum total price
                        const location = item.sheet || item.building || "Անհայտ";

                        cleaned.push({
                            area,
                            floor,
                            totalPrice,
                            priceSqm,
                            sizeCategory: area <= 50 ? 'Small' : (area <= 80 ? 'Medium' : 'Large'),
                            isSold: String(item.status || "").toLowerCase().includes('sold') ? 1 : 0,
                            location: location
                        });
                    }
                }
            }
        }
    }
    return cleaned;
}

function destroyChart(id) {
    if (charts[id]) {
        charts[id].destroy();
        delete charts[id];
    }
}

function renderCharts(data) {
    // Graph 1: Correlation Matrix Approximation
    // Since Chart.js doesn't have a built-in heatmap that is easy to setup without plugins,
    // we will calculate Pearson correlation and display it as an HTML table instead, 
    // or as a Bar chart showing correlation with Price_Sqm.
    renderCorrelationTable(data);

    // Graph 2: Floor vs Price Sqm (Trend) / Size Categories
    renderFloorVsPriceSqm(data);

    // Graph 3: Price variance by Floor (Boxplot equivalent -> Scatter with min/max or Bar with error bars)
    // We will use a Scatter plot to show distribution per floor
    renderPriceVarianceByFloor(data);

    // Graph 4: Area vs Total Price
    renderAreaVsTotalPrice(data);

    // Graph 5: Average Price by Location
    renderPriceByLocation(data);

    // Graph 6: Residuals (from python script) or Sold Heatmap approx
    // Rendered after regression.
}

function pearsonCorrelation(x, y) {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    const n = x.length;
    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
        sumXY += x[i] * y[i];
        sumX2 += x[i] * x[i];
        sumY2 += y[i] * y[i];
    }
    const numerator = (n * sumXY) - (sumX * sumY);
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    if (denominator === 0) return 0;
    return numerator / denominator;
}

function renderCorrelationTable(data) {
    const areas = data.map(d => d.area);
    const floors = data.map(d => d.floor);
    const totalPrices = data.map(d => d.totalPrice);
    const priceSqms = data.map(d => d.priceSqm);

    const corrAreaPrice = pearsonCorrelation(areas, priceSqms);
    const corrFloorPrice = pearsonCorrelation(floors, priceSqms);
    const corrAreaTotal = pearsonCorrelation(areas, totalPrices);
    const corrFloorTotal = pearsonCorrelation(floors, totalPrices);

    const container = document.getElementById("correlationContainer");
    if (!container) return;

    container.innerHTML = `
        <table style="width:100%; text-align:left; border-collapse:collapse; font-size: 0.8rem; color: var(--text);">
            <thead>
                <tr style="border-bottom: 1px solid var(--border);">
                    <th style="padding: 8px;">Factor</th>
                    <th style="padding: 8px;">vs Price/Sqm</th>
                    <th style="padding: 8px;">vs Total Price</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="padding: 8px; color: var(--accent);">Area (Sqm)</td>
                    <td style="padding: 8px; color: ${getColorForCorr(corrAreaPrice)}">${corrAreaPrice.toFixed(2)}</td>
                    <td style="padding: 8px; color: ${getColorForCorr(corrAreaTotal)}">${corrAreaTotal.toFixed(2)}</td>
                </tr>
                <tr>
                    <td style="padding: 8px; color: var(--accent);">Floor</td>
                    <td style="padding: 8px; color: ${getColorForCorr(corrFloorPrice)}">${corrFloorPrice.toFixed(2)}</td>
                    <td style="padding: 8px; color: ${getColorForCorr(corrFloorTotal)}">${corrFloorTotal.toFixed(2)}</td>
                </tr>
            </tbody>
        </table>
    `;
}

function getColorForCorr(val) {
    if (val > 0.5) return 'var(--success)';
    if (val < -0.5) return 'var(--error)';
    return 'var(--text)';
}

function renderFloorVsPriceSqm(data) {
    const ctx = document.getElementById('chartFloorVsPrice').getContext('2d');
    destroyChart('chartFloorVsPrice');

    const small = data.filter(d => d.sizeCategory === 'Small').map(d => ({ x: d.floor, y: d.priceSqm }));
    const medium = data.filter(d => d.sizeCategory === 'Medium').map(d => ({ x: d.floor, y: d.priceSqm }));
    const large = data.filter(d => d.sizeCategory === 'Large').map(d => ({ x: d.floor, y: d.priceSqm }));

    charts['chartFloorVsPrice'] = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                { label: 'Small', data: small, backgroundColor: '#60a5fa', pointRadius: 5, pointHoverRadius: 8 },
                { label: 'Medium', data: medium, backgroundColor: '#fb923c', pointRadius: 5, pointHoverRadius: 8 },
                { label: 'Large', data: large, backgroundColor: '#4ade80', pointRadius: 5, pointHoverRadius: 8 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Floor', color: '#71717a' }, grid: { color: '#27272a' } },
                y: { title: { display: true, text: 'Price / Sqm', color: '#71717a' }, grid: { color: '#27272a' } }
            },
            plugins: {
                legend: { labels: { color: '#e4e4e7' } },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const point = context.raw;
                            return [
                                `Floor: ${point.x}`,
                                `Price / Sqm: ${formatAMD(point.y)}`
                            ];
                        }
                    }
                }
            }
        }
    });
}

function renderPriceVarianceByFloor(data) {
    const ctx = document.getElementById('chartPriceVariance').getContext('2d');
    destroyChart('chartPriceVariance');

    const points = data.map(d => ({
        x: d.floor,
        y: d.priceSqm
    }));

    charts['chartPriceVariance'] = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Price / Sqm Variance',
                data: points,
                backgroundColor: 'rgba(167, 139, 250, 0.6)',
                borderColor: '#a78bfa',
                pointRadius: 5,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Floor', color: '#71717a' }, grid: { color: '#27272a' } },
                y: { title: { display: true, text: 'Price / Sqm', color: '#71717a' }, grid: { color: '#27272a' } }
            },
            plugins: {
                legend: { labels: { color: '#e4e4e7' } },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const point = context.raw;
                            return [
                                `Floor: ${point.x}`,
                                `Price / Sqm: ${formatAMD(point.y)}`
                            ];
                        }
                    }
                }
            }
        }
    });
}

function renderAreaVsTotalPrice(data) {
    const ctx = document.getElementById('chartAreaVsTotal').getContext('2d');
    destroyChart('chartAreaVsTotal');

    // Use Floor as Size (normalized)
    const maxFloor = Math.max(...data.map(d => d.floor));
    const bubbleData = data.map(d => ({
        x: d.area,
        y: d.totalPrice,
        r: Math.max(4, (d.floor / maxFloor) * 15), // Radius based on floor (slightly larger)
        _originalFloor: d.floor
    }));

    charts['chartAreaVsTotal'] = new Chart(ctx, {
        type: 'bubble',
        data: {
            datasets: [{
                label: 'Area vs Total Price (Bubble = Floor)',
                data: bubbleData,
                backgroundColor: 'rgba(232, 255, 71, 0.5)',
                borderColor: 'var(--accent)',
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Area (Sqm)', color: '#71717a' }, grid: { color: '#27272a' } },
                y: { title: { display: true, text: 'Total Price', color: '#71717a' }, grid: { color: '#27272a' } }
            },
            plugins: {
                legend: { labels: { color: '#e4e4e7' } },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const point = context.raw;
                            // recreate floor from radius calculation loosely, or just know it from data
                            // Actually it's better to add proper Floor value to `bubbleData` array so we can access it here.
                            return [
                                `Area: ${point.x} Sqm`,
                                `Total Price: ${formatAMD(point.y)}`,
                                `Floor: ${point._originalFloor || Math.round(point.r / 10 * maxFloor)}`
                            ];
                        }
                    }
                }
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
        if (!locMap[d.location]) locMap[d.location] = { sumPrice: 0, count: 0 };
        locMap[d.location].sumPrice += d.priceSqm;
        locMap[d.location].count++;
    });

    const locations = Object.keys(locMap);
    const avgPrices = locations.map(loc => locMap[loc].sumPrice / locMap[loc].count);

    charts['chartPriceByLocation'] = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: locations,
            datasets: [{
                label: 'Avg Price / Sqm',
                data: avgPrices,
                backgroundColor: 'rgba(56, 189, 248, 0.7)',
                borderColor: '#38bdf8',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Location', color: '#71717a' }, grid: { color: '#27272a' } },
                y: { title: { display: true, text: 'Price / Sqm (֏)', color: '#71717a' }, grid: { color: '#27272a' } }
            },
            plugins: {
                legend: { labels: { color: '#e4e4e7' } },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return `Average: ${formatAMD(context.raw)}`;
                        }
                    }
                }
            }
        }
    });
}

function runHedonicRegression(data) {
    // X = [[Area, Floor], ...]
    const X = data.map(d => [d.area, d.floor]);
    // y = [[TotalPrice], ...]
    const y = data.map(d => [d.totalPrice]);

    const mlr = new MultivariateLinearRegression(X, y);

    // mlr.weights contains [[intercept], [coef1], [coef2]] usually if add_constant is handled, 
    // ml-regression handles intercepts differently, we need to check its API.
    // actually MultivariateLinearRegression expects X to just be features. It adds intercept internally.
    const weights = mlr.weights;
    // For 2 features, weights is a 3x1 matrix: [ [coef_area], [coef_floor], [intercept] ]
    const coefArea = weights[0][0];
    const coefFloor = weights[1][0];
    const intercept = weights[2][0];

    // Predict & Residuals
    let overPricedCount = 0;
    let underPricedCount = 0;
    const residuals = [];

    data.forEach(d => {
        const predicted = mlr.predict([d.area, d.floor])[0];
        const diff = d.totalPrice - predicted;
        residuals.push({ x: d.area, y: diff });

        if (diff > 0) overPricedCount++;
        else if (diff < 0) underPricedCount++;
    });

    // Approximate R^2 (Pseudo)
    const yMean = data.reduce((sum, d) => sum + d.totalPrice, 0) / data.length;
    let ssTot = 0;
    let ssRes = 0;
    data.forEach((d) => {
        const predicted = mlr.predict([d.area, d.floor])[0];
        ssTot += Math.pow(d.totalPrice - yMean, 2);
        ssRes += Math.pow(d.totalPrice - predicted, 2);
    });
    const rSquared = 1 - (ssRes / ssTot);

    // Math Analysis
    const diff1to10 = coefFloor * 9; // Difference between 1st and 10th floor

    // Location analysis
    const locMap = {};
    data.forEach(d => {
        if (!locMap[d.location]) locMap[d.location] = { sumPriceSqm: 0, count: 0 };
        locMap[d.location].sumPriceSqm += d.priceSqm;
        locMap[d.location].count++;
    });

    let maxLoc = { name: "N/A", avg: -Infinity };
    let minLoc = { name: "N/A", avg: Infinity };

    Object.keys(locMap).forEach(loc => {
        const avg = locMap[loc].sumPriceSqm / locMap[loc].count;
        if (avg > maxLoc.avg) maxLoc = { name: loc, avg };
        if (avg < minLoc.avg) minLoc = { name: loc, avg };
    });

    if (reportContainer) {
        reportContainer.innerHTML = `
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; line-height: 1.8;">
                <div style="color: var(--accent); margin-bottom: 8px;">1. Base Value (Area): <strong>+${formatAMD(coefArea)}</strong> per Sqm</div>
                <div style="color: var(--accent); margin-bottom: 8px;">2. Floor Premium: <strong>+${formatAMD(coefFloor)}</strong> per Floor</div>
                <div style="margin-bottom: 8px;">3. Model Reliability (R²): ${(rSquared * 100).toFixed(2)}%</div>
                
                <hr style="border: 0; border-top: 1px solid var(--border); margin: 16px 0;">
                <div style="color: var(--primary); font-family: 'Syne', sans-serif; font-weight: bold; margin-bottom: 12px; font-size: 1.1rem;">Math Analysis & Insights</div>
                
                <div style="margin-bottom: 16px; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;">
                    <div style="color: #4ade80; margin-bottom: 6px;"><strong>🏢 How Floor Affects Price:</strong></div>
                    Using our mathematical model, for every floor you go up, the apartment price increases by an average of <strong>${formatAMD(coefFloor)}</strong>. 
                    So, an apartment on the <strong>10th floor</strong> is predicted to be mathematically <strong>${formatAMD(diff1to10)} more expensive</strong> than the exact same apartment on the 1st floor.
                </div>
                
                <div style="margin-bottom: 16px; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;">
                     <div style="color: #38bdf8; margin-bottom: 6px;"><strong>📍 How Location Affects Price:</strong></div>
                     Comparing different buildings or sheets in your data, location causes massive price swings. 
                     The data shows that <strong>${maxLoc.name}</strong> is the <strong style="color: var(--error)">Most Expensive</strong> location with an average of <strong>${formatAMD(maxLoc.avg)} / Sqm</strong>. 
                     In contrast, <strong>${minLoc.name}</strong> is the <strong style="color: var(--success)">Most Affordable</strong> averaging <strong>${formatAMD(minLoc.avg)} / Sqm</strong>.
                </div>
                
                <hr style="border: 0; border-top: 1px dashed var(--border); margin: 16px 0;">
                <div style="color: var(--success); margin-bottom: 4px;">📌 Underpriced (Great Deal) Apartments: <strong>${underPricedCount}</strong></div>
                <div style="color: var(--error);">📌 Overpriced (Expensive) Apartments: <strong>${overPricedCount}</strong></div>
            </div>
        `;
    }

    renderResidualsChart(residuals);
}

function formatAMD(val) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'AMD' }).format(val).replace('AMD', '֏');
}

function renderResidualsChart(residualsData) {
    const ctx = document.getElementById('chartResiduals').getContext('2d');
    destroyChart('chartResiduals');

    charts['chartResiduals'] = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Residuals (Predicted vs Actual Difference)',
                data: residualsData,
                backgroundColor: 'rgba(167, 139, 250, 0.8)',
                borderColor: 'var(--purple)',
                pointRadius: 5,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Area (Sqm)', color: '#71717a' }, grid: { color: '#27272a' } },
                y: { title: { display: true, text: 'Difference (֏)', color: '#71717a' }, grid: { color: '#27272a' } }
            },
            plugins: {
                legend: { labels: { color: '#e4e4e7' } },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const point = context.raw;
                            return [
                                `Area: ${point.x} Sqm`,
                                `Difference: ${formatAMD(point.y)}`
                            ];
                        }
                    }
                }
            }
        }
    });
}
