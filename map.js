// ---------- Helper Functions ----------
function normalize(value) {
    return String(value || "").trim().toLowerCase();
}

function normalizeLabel(value) {
    return String(value || "UNKNOWN").trim().toUpperCase();
}

async function loadCSV(path) {
    try {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`Failed to load ${path}`);
        const text = await res.text();
        return Papa.parse(text, { header: true, dynamicTyping: true }).data;
    } catch (err) {
        console.error("Error loading CSV:", err);
        return [];
    }
}

// ---------- Main Logic ----------
(async () => {

    // 1. Load Data
    let master = await loadCSV("data/final_master.csv");
    let forecast = await loadCSV("data/forecast_ev_5y.csv");
    // locations not strictly used in logic but available for future
    // const locations = await loadCSV("data/charger_locations.csv");

    // 2. Data Cleaning
    const clean = arr => arr.filter(r => normalize(r.city) !== "");
    master = clean(master);
    forecast = clean(forecast);

    // Normalize keys to lowercase/no-space for safety
    const normalizeKeys = (data) => data.map(row => {
        const out = {};
        Object.keys(row).forEach(k => {
            out[k.replace(/\s+/g, "").toLowerCase()] = row[k];
        });
        return out;
    });

    master = normalizeKeys(master);
    forecast = normalizeKeys(forecast);

    // 3. Create Forecast Lookup Table
    const forecastLookup = {};
    forecast.forEach(f => {
        const key = normalize(f.city);
        forecastLookup[key] = [
            f.estimated_ev || 0,
            f.ev_forecast_2025 || 0,
            f.ev_forecast_2026 || 0,
            f.ev_forecast_2027 || 0,
            f.ev_forecast_2028 || 0,
            f.ev_forecast_2029 || 0
        ];
    });

    // 4. Initialize Map
    // Centered on India
    const map = L.map("map", {
        zoomControl: false // Move zoom control if needed, or keep off for clean look
    }).setView([22.97, 78.65], 5);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Using CartoDB Positron - but we use CSS filter in styles.css to invert it to dark mode
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // 5. Heatmap Layer
    // Heatmap based on 2029 Forecast density
    const heatPoints = master.map(c => {
        const key = normalize(c.city);
        const future = forecastLookup[key]?.[5] || c.estimated_ev || 0;
        // Normalize heat intensity
        const heatValue = Math.min(future / 350000, 1); 
        return [c.lat, c.lng, heatValue];
    });

    L.heatLayer(heatPoints, {
        radius: 50,
        blur: 35,
        minOpacity: 0.3,
        gradient: {0.4: 'blue', 0.65: 'cyan', 1: 'white'} // Cyber colors
    }).addTo(map);

    // 6. City Markers
    master.forEach(c => {
        if (!c.lat || !c.lng) return;

        const icon = L.divIcon({
            className: "city-marker",
            html: `<div style="width:12px;height:12px;border-radius:50%;"></div>`
        });

        const cityName = normalize(c.city);
        const forecast2029 = forecastLookup[cityName] ? forecastLookup[cityName][5] : 0;

        const popupContent = `
            <div style="min-width:150px">
                <strong style="font-size:14px; color:#00f2ff">${normalizeLabel(c.city)}</strong><br>
                <div style="margin-top:5px; font-size:12px; color:#ccc;">
                    Forecast 2029: <b style="color:#fff">${forecast2029.toLocaleString()}</b> EVs<br>
                    Current Chargers: <b style="color:#fff">${c.chargingstations || 0}</b>
                </div>
            </div>
        `;

        L.marker([c.lat, c.lng], { icon }).addTo(map).bindPopup(popupContent);
    });

    // 7. UI Interaction & Charts
    const dropdown = document.getElementById("citySelect");
    const insightBox = document.getElementById("insightText");

    // Populate Dropdown
    master.sort((a,b) => a.city.localeCompare(b.city)).forEach(c => {
        const opt = document.createElement("option");
        opt.value = normalize(c.city);
        opt.textContent = normalizeLabel(c.city);
        dropdown.appendChild(opt);
    });

    let growthChart, barChart, donutChart;

    // Theme Colors
    const COLOR_ACCENT = '#00f2ff'; // Cyan
    const COLOR_ACCENT_DIM = 'rgba(0, 242, 255, 0.2)';
    const COLOR_DANGER = '#ff2a6d'; // Pink/Red
    const COLOR_TEXT = '#ffffff';

    // Global Chart Defaults
    Chart.defaults.color = '#a0a0b0';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    function updateUI(cityKey) {
        const row = master.find(m => normalize(m.city) === cityKey);
        if (!row) return;

        const fc = forecastLookup[cityKey];

        // Calculations
        const EV_PER_STATION = 400; // Assumption
        const forecast2029 = fc[5];
        const existing = Number(row.chargingstations) || 0;
        const required = Math.ceil(forecast2029 / EV_PER_STATION);
        const coverage = Math.min((existing / required) * 100, 100);
        const gap = Math.max(required - existing, 0);
        const growthRate = fc[0] > 0 ? (((fc[5] - fc[0]) / fc[0]) * 100).toFixed(1) : "N/A";

        // Update Text
        insightBox.innerHTML = `
            <div style="margin-bottom:10px; font-size:16px;">
                Analysis for <span class="highlight-val">${normalizeLabel(row.city)}</span>
            </div>
            EV Forecast (2029): <span class="highlight-val">${forecast2029.toLocaleString()}</span><br>
            Current Coverage: <span class="${coverage < 50 ? 'highlight-bad' : 'highlight-val'}">${coverage.toFixed(1)}%</span><br>
            5-Year Growth: <span class="highlight-val">${growthRate}%</span><br>
            <div style="margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:8px;">
                Stations Needed: <span class="highlight-bad">${gap.toLocaleString()}</span>
            </div>
        `;

        // Destroy old charts
        if (growthChart) growthChart.destroy();
        if (barChart) barChart.destroy();
        if (donutChart) donutChart.destroy();

        // 1. Line Chart (Growth)
        const ctxGrowth = document.getElementById("growthChart").getContext("2d");
        const gradientGrowth = ctxGrowth.createLinearGradient(0, 0, 0, 400);
        gradientGrowth.addColorStop(0, 'rgba(0, 242, 255, 0.5)');
        gradientGrowth.addColorStop(1, 'rgba(0, 242, 255, 0.0)');

        growthChart = new Chart(ctxGrowth, {
            type: "line",
            data: {
                labels: ["2024","2025","2026","2027","2028","2029"],
                datasets: [{
                    label: "EV Volume",
                    data: fc,
                    borderColor: COLOR_ACCENT,
                    backgroundColor: gradientGrowth,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#000',
                    pointBorderColor: COLOR_ACCENT
                }]
            },
            options: {
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: false }
                }
            }
        });

        // 2. Bar Chart (Context)
        // Let's compare this city to top 5 averages or just show visual magnitude
        barChart = new Chart(document.getElementById("barChart"), {
            type: "bar",
            data: {
                labels: ["2024", "2029"],
                datasets: [{
                    label: "Volume",
                    data: [fc[0], fc[5]],
                    backgroundColor: [COLOR_ACCENT_DIM, COLOR_ACCENT],
                    borderColor: COLOR_ACCENT,
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y',
                plugins: { legend: { display: false } }
            }
        });

        // 3. Donut Chart (Gap)
        donutChart = new Chart(document.getElementById("gapChart"), {
            type: "doughnut",
            data: {
                labels: ["Existing", "Gap"],
                datasets: [{
                    data: [existing, gap],
                    backgroundColor: [COLOR_ACCENT, '#333'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                cutout: '75%',
                plugins: { legend: { position: 'right' } }
            }
        });
    }

    // Initialize with first city
    if (master.length > 0) {
        updateUI(normalize(master[0].city));
    }

    // Listener
    dropdown.addEventListener("change", e => {
        updateUI(e.target.value);
        
        // Pan map to selected city
        const cityData = master.find(m => normalize(m.city) === e.target.value);
        if(cityData && cityData.lat && cityData.lng) {
            map.flyTo([cityData.lat, cityData.lng], 10, {
                duration: 1.5
            });
        }
    });

    // Remove Loader
    setTimeout(() => {
        const loader = document.getElementById('loader');
        if(loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.remove(), 500);
        }
    }, 1000);

})();