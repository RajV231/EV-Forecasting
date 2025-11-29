// ---------- Helper Functions ----------
function normalize(value) {
    return String(value || "").trim().toLowerCase();
}

function normalizeLabel(value) {
    return String(value || "UNKNOWN").trim().toUpperCase();
}

async function loadCSV(path) {
    const res = await fetch(path);
    const text = await res.text();
    return Papa.parse(text, { header: true, dynamicTyping: true }).data;
}

// ---------- Main ----------
(async () => {

    let master = await loadCSV("data/final_master.csv");
    let forecast = await loadCSV("data/forecast_ev_5y.csv");
    const locations = await loadCSV("data/charger_locations.csv");

    // Remove blank rows
    const clean = arr => arr.filter(r => normalize(r.city) !== "");
    master = clean(master);
    forecast = clean(forecast);

    // Normalize column names
    master = master.map(row => {
        const out = {};
        Object.keys(row).forEach(k => {
            out[k.replace(/\s+/g, "").toLowerCase()] = row[k];
        });
        return out;
    });

    forecast = forecast.map(row => {
        const out = {};
        Object.keys(row).forEach(k => {
            out[k.replace(/\s+/g, "").toLowerCase()] = row[k];
        });
        return out;
    });

    // ---------- Forecast Lookup ----------
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

    // ---------- Map ----------
    const map = L.map("map").setView([22.97, 78.65], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

    // Heatmap points
    const heatPoints = master.map(c => {
        const key = normalize(c.city);
        const future = forecastLookup[key]?.[5] || c.estimated_ev || 0;
        const heatValue = Math.min(future / 350000, 1);
        return [c.lat, c.lng, heatValue];
    });

    L.heatLayer(heatPoints, {
        radius: 45,
        blur: 30,
        minOpacity: 0.4
    }).addTo(map);


    // ---------- Markers ----------
    master.forEach(c => {
        const icon = L.divIcon({
            className: "city-marker",
            html: `<div style="background:#03ff61;width:14px;height:14px;border-radius:50%;box-shadow:0 0 10px #03ff61"></div>`
        });

        L.marker([c.lat, c.lng], { icon }).addTo(map).bindPopup(`
            <b>${normalizeLabel(c.city)}</b><br>
            Forecast EV 2029: ${forecastLookup[normalize(c.city)][5].toLocaleString()}<br>
            Existing Chargers: ${c.chargingstations}
        `);
    });


    // ---------- UI + Charts ----------
    const dropdown = document.getElementById("citySelect");
    const insightBox = document.getElementById("insightText");

    master.forEach(c => {
        const opt = document.createElement("option");
        opt.value = normalize(c.city);
        opt.textContent = normalizeLabel(c.city);
        dropdown.appendChild(opt);
    });

    let growthChart, barChart, donutChart;

    function updateUI(cityKey) {

        const row = master.find(m => normalize(m.city) === cityKey);
        const fc = forecastLookup[cityKey];

        // -------- Forecast Summary --------
        const EV_PER_STATION = 400;

        const forecast2029 = fc[5];
        const existing = Number(row.chargingstations) || 0;
        const required = Math.ceil(forecast2029 / EV_PER_STATION);
        const coverage = Math.min(existing / required * 100, 100);
        const gap = Math.max(required - existing, 0);

        const growthRate = (((fc[5] - fc[0]) / fc[0]) * 100).toFixed(1);

        insightBox.innerHTML = `
            <b>${normalizeLabel(row.city)}</b><br><br>
            📈 Forecast EVs (2029): <span style="color:#03ff61">${forecast2029.toLocaleString()}</span><br>
            ⚡ Charger Coverage: <span style="color:#03ff61">${coverage.toFixed(1)}%</span><br>
            🚗 Growth Rate: <span style="color:#03ff61">${growthRate}%</span><br>
            🏗 Needed Stations: <span style="color:#ff4444">${gap}</span>
        `;

        // -------- Destroy old charts --------
        [growthChart, barChart, donutChart].forEach(c => c?.destroy());

        // -------- Growth Chart --------
        growthChart = new Chart(document.getElementById("growthChart"), {
            type: "line",
            data: {
                labels: ["2024","2025","2026","2027","2028","2029"],
                datasets: [{
                    label: "EV Growth",
                    data: fc,
                    borderColor: "#03ff61",
                    borderWidth: 3
                }]
            }
        });

        // -------- Comparison Chart --------
        barChart = new Chart(document.getElementById("barChart"), {
            type: "bar",
            data: {
                labels: master.map(x => normalizeLabel(x.city)),
                datasets: [{
                    label: "Forecast EV 2029",
                    data: master.map(x => forecastLookup[normalize(x.city)][5]),
                    backgroundColor: "#03ff61"
                }]
            }
        });

        // -------- Donut Chart (Coverage %) --------
        donutChart = new Chart(document.getElementById("gapChart"), {
            type: "doughnut",
            data: {
                labels: ["Covered", "Uncovered"],
                datasets: [{
                    data: [coverage, 100 - coverage],
                    backgroundColor: ["#03ff61", "#303030"]
                }]
            }
        });
    }

    updateUI(normalize(master[0].city));

    dropdown.addEventListener("change", e => {
        updateUI(e.target.value);
    });

})();
