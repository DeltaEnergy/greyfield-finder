const API_BASE = "https://greyfield-finder-api.onrender.com";

const map = L.map("map").setView([43.1306, -80.7460], 13);

setTimeout(() => {
  map.invalidateSize();
}, 300);

const basemaps = {
  dark: {
    name: "Dark dashboard",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    options: {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors © CARTO"
    }
  },
  light: {
    name: "Light streets",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    options: {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors © CARTO"
    }
  },
  voyager: {
    name: "Clean atlas",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    options: {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors © CARTO"
    }
  },
  osm: {
    name: "OpenStreetMap default",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }
  }
};

let currentBaseLayer = L.tileLayer(
  basemaps.dark.url,
  basemaps.dark.options
).addTo(map);

let parkingLayer = null;
let featureLayers = [];
let latestFeatures = [];

const placeInput = document.getElementById("place-input");
const analyzeBtn = document.getElementById("analyze-btn");
const exportBtn = document.getElementById("export-btn");
const statusEl = document.getElementById("status");
const resultsList = document.getElementById("results-list");
const loadingOverlay = document.getElementById("loading-overlay");
const mapStyleSelect = document.getElementById("map-style-select");

let progressInterval;
let currentProgress = 0;
let progressStartTime = 0;

function startProgress() {
progressStartTime = Date.now();
currentProgress = 0;

if (loadingOverlay) {
    loadingOverlay.innerHTML = `
      <div class="loading-box">
        <div class="spinner"></div>

        <div class="loading-copy">
          <p class="loading-title">Analyzing parking lots</p>
          <p class="loading-subtitle">Scoring redevelopment potential and nearby amenities...</p>
        </div>

        <div class="progress-bar">
          <div class="progress-fill" id="progress-fill"></div>
        </div>

        <div class="progress-row">
          <span>Processing</span>
          <span id="progress-text">0%</span>
        </div>
      </div>
    `;

}

const progressFill = document.getElementById("progress-fill");
const progressText = document.getElementById("progress-text");

clearInterval(progressInterval);

progressInterval = setInterval(() => {
if (currentProgress < 65) {
currentProgress += Math.floor(Math.random() * 8) + 4;
} else if (currentProgress < 88) {
currentProgress += Math.floor(Math.random() * 4) + 1;
} else if (currentProgress < 95) {
currentProgress += 1;
}


currentProgress = Math.min(currentProgress, 95);

if (progressFill) {
  progressFill.style.width = `${currentProgress}%`;
}

if (progressText) {
  progressText.textContent = `${currentProgress}%`;
}

}, 300);
}

function finishProgress() {
clearInterval(progressInterval);

const progressFill = document.getElementById("progress-fill");
const progressText = document.getElementById("progress-text");

if (progressFill) {
progressFill.style.width = "100%";
}

if (progressText) {
progressText.textContent = "100%";
}

const elapsed = Date.now() - progressStartTime;
const minimumVisibleTime = 1200;
const remainingTime = Math.max(0, minimumVisibleTime - elapsed);

setTimeout(() => {
if (loadingOverlay) {
loadingOverlay.classList.add("hidden");
}
}, remainingTime + 500);
}



function getScoreClass(score) {
  if (score >= 75) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

function getScoreColor(score) {
  if (score >= 75) return "#2ecc71";
  if (score >= 50) return "#f1c40f";
  return "#e74c3c";
}

function styleFeature(feature) {
  const score = feature.properties.redevelopment_score || 0;

  return {
    color: "#ffffff",
    fillColor: getScoreColor(score),
    weight: score >= 75 ? 3 : 2,
    opacity: 1,
    fillOpacity: score >= 75 ? 0.7 : 0.5
  };
}

function formatDistance(value) {
  if (value === null || value === undefined) return "N/A";

  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} km`;
  }

  return `${Math.round(value)} m`;
}

function popupHtml(props) {
  return `
    <strong>${props.name || "Surface parking lot"}</strong><br />
    <hr />

    <strong>Redevelopment Score:</strong> ${props.redevelopment_score}/100<br />
    <strong>Amenity Access Score:</strong> ${props.amenity_access_score ?? "N/A"}/100<br />
    <strong>Interpretation:</strong> ${getScoreClass(props.redevelopment_score)} redevelopment potential<br /><br />

    <strong>Area:</strong> ${Math.round(props.area_m2).toLocaleString()} m²<br />
    <strong>Distance to centre:</strong> ${formatDistance(props.distance_to_centre_m)}<br />
    <strong>Distance to transit:</strong> ${formatDistance(props.distance_to_transit_m)}<br />
    <strong>Nearest grocery:</strong> ${formatDistance(props.distance_to_grocery_m)}<br />
    <strong>Nearest health service:</strong> ${formatDistance(props.distance_to_health_m)}<br />
    <strong>Nearest civic service:</strong> ${formatDistance(props.distance_to_civic_m)}<br />
    <strong>Nearest park:</strong> ${formatDistance(props.distance_to_park_m)}<br />
    <strong>Commercial context:</strong> ${formatDistance(props.distance_to_commercial_m)}<br /><br />

    <strong>Redevelopment score breakdown</strong><br />
    Area: ${props.area_score}/30<br />
    Centre: ${props.centre_score}/20<br />
    Transit: ${props.transit_score}/20<br />
    Amenity: ${props.amenity_score}/20<br />
    Commercial context: ${props.commercial_score}/10<br /><br />

    <strong>Amenity access breakdown</strong><br />
    Grocery: ${props.grocery_score ?? "N/A"}/20<br />
    Health: ${props.health_score ?? "N/A"}/20<br />
    Civic: ${props.civic_score ?? "N/A"}/15<br />
    Park: ${props.park_score ?? "N/A"}/15<br />
    Transit: ${props.walk_transit_score ?? "N/A"}/20<br />
    Commercial: ${props.walk_commercial_score ?? "N/A"}/10
  `;
}

function renderResultsList(features) {
  resultsList.innerHTML = "";

  const sorted = [...features].sort((a, b) => {
    return b.properties.redevelopment_score - a.properties.redevelopment_score;
  });

  sorted.slice(0, 20).forEach((feature, index) => {
    const props = feature.properties;
    const score = props.redevelopment_score;
    const scoreClass = getScoreClass(score);

    const card = document.createElement("div");
    card.className = "result-card";

    card.innerHTML = `
      <div class="result-top-row">
        <div class="score">#${index + 1} — ${score}/100</div>
        <span class="score-pill" style="background:${getScoreColor(score)}">${scoreClass}</span>
      </div>

      <div><strong>${props.name || "Surface parking lot"}</strong></div>

      <div class="result-meta">
        Area: ${Math.round(props.area_m2).toLocaleString()} m²<br />
        Redevelopment: ${props.redevelopment_score}/100<br />
        Amenity access: ${props.amenity_access_score ?? "N/A"}/100<br />
        Transit: ${formatDistance(props.distance_to_transit_m)}
      </div>
    `;

    card.addEventListener("click", () => {
      const layer = featureLayers.find((item) => item.feature === feature);

      if (layer) {
        map.fitBounds(layer.getBounds(), { maxZoom: 18 });
        layer.openPopup();
      }
    });

    resultsList.appendChild(card);
  });
}

function exportCsv() {
  if (!latestFeatures.length) {
    statusEl.textContent = "No results to export yet.";
    return;
  }

  const rows = [
    [
      "rank",
      "name",
      "redevelopment_score",
      "amenity_access_score",
      "area_m2",
      "distance_to_centre_m",
      "distance_to_transit_m",
      "distance_to_amenity_m",
      "distance_to_commercial_m",
      "distance_to_grocery_m",
      "distance_to_health_m",
      "distance_to_civic_m",
      "distance_to_park_m",
      "area_score",
      "centre_score",
      "transit_score",
      "amenity_score",
      "commercial_score",
      "grocery_score",
      "health_score",
      "civic_score",
      "park_score",
      "walk_transit_score",
      "walk_commercial_score"
    ]
  ];

  const sorted = [...latestFeatures].sort((a, b) => {
    return b.properties.redevelopment_score - a.properties.redevelopment_score;
  });

  sorted.forEach((feature, index) => {
    const p = feature.properties;

    rows.push([
      index + 1,
      p.name || "Surface parking lot",
      p.redevelopment_score,
      p.amenity_access_score,
      p.area_m2,
      p.distance_to_centre_m,
      p.distance_to_transit_m,
      p.distance_to_amenity_m,
      p.distance_to_commercial_m,
      p.distance_to_grocery_m,
      p.distance_to_health_m,
      p.distance_to_civic_m,
      p.distance_to_park_m,
      p.area_score,
      p.centre_score,
      p.transit_score,
      p.amenity_score,
      p.commercial_score,
      p.grocery_score,
      p.health_score,
      p.civic_score,
      p.park_score,
      p.walk_transit_score,
      p.walk_commercial_score
    ]);
  });

  const csv = rows
    .map((row) =>
      row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "greyfield-finder-results.csv";
  link.click();

  URL.revokeObjectURL(url);
}

async function analyzePlace() {
  const place = placeInput.value.trim();

  if (!place) {
    statusEl.textContent = "Enter a place to analyze.";
    return;
  }

  startProgress();

  loadingOverlay.classList.remove("hidden");
  analyzeBtn.disabled = true;
  exportBtn.disabled = true;
  statusEl.textContent = `Analyzing ${place}. This may take a moment...`;
  resultsList.innerHTML = "";
  latestFeatures = [];

  try {
    const url = `${API_BASE}/analyze?place=${encodeURIComponent(place)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      const detailText = data.details ? ` Details: ${data.details}` : "";
      throw new Error(`${data.message || "Something went wrong."}${detailText}`);
    }

    const geojson = JSON.parse(data.geojson);
    latestFeatures = geojson.features;

    if (parkingLayer) {
      map.removeLayer(parkingLayer);
    }

    featureLayers = [];

    parkingLayer = L.geoJSON(geojson, {
      style: styleFeature,
      onEachFeature: (feature, layer) => {
        layer.bindPopup(popupHtml(feature.properties));
        featureLayers.push(layer);
      }
    }).addTo(map);

    if (geojson.features.length > 0) {
      map.fitBounds(parkingLayer.getBounds(), { padding: [20, 20] });
    }

    setTimeout(() => {
      map.invalidateSize();

      if (parkingLayer && geojson.features.length > 0) {
        map.fitBounds(parkingLayer.getBounds(), { padding: [20, 20] });
      }
    }, 300);

    renderResultsList(geojson.features);

    statusEl.textContent = `Found ${data.count} candidate parking lots in ${data.place}.`;
    exportBtn.disabled = false;
  } catch (error) {
    console.error("Analysis error:", error);
    statusEl.textContent = `Analysis failed: ${error.message}`;
  } finally {
    finishProgress();
    analyzeBtn.disabled = false;
    loadingOverlay.classList.add("hidden");
  }
}

if (mapStyleSelect) {
  mapStyleSelect.addEventListener("change", () => {
    const selectedStyle = mapStyleSelect.value;
    const selectedBasemap = basemaps[selectedStyle];

    if (!selectedBasemap) {
      return;
    }

    if (currentBaseLayer) {
      map.removeLayer(currentBaseLayer);
    }

    currentBaseLayer = L.tileLayer(
      selectedBasemap.url,
      selectedBasemap.options
    ).addTo(map);

    if (parkingLayer) {
      parkingLayer.bringToFront();
    }
  });
}

if (analyzeBtn) {
  analyzeBtn.addEventListener("click", analyzePlace);
}

if (exportBtn) {
  exportBtn.addEventListener("click", exportCsv);
}

if (placeInput) {
  placeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      analyzePlace();
    }
  });
}

window.addEventListener("load", () => {
  setTimeout(() => {
    map.invalidateSize();
  }, 300);
});

window.addEventListener("resize", () => {
  setTimeout(() => {
    map.invalidateSize();
  }, 150);
});

document.querySelectorAll(".cached-city-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const place = button.dataset.place;

    placeInput.value = place;

    document.querySelectorAll(".cached-city-btn").forEach((btn) => {
      btn.classList.remove("active");
    });

    button.classList.add("active");

    analyzePlace();
  });
});

const mobileSidebarToggle = document.getElementById("mobile-sidebar-toggle");
const mobileToggleText = document.querySelector(".mobile-toggle-text");
const mobileToggleIcon = document.querySelector(".mobile-toggle-icon");

function closeMobileSidebar() {
  document.body.classList.remove("sidebar-open");

  if (mobileToggleText) {
    mobileToggleText.textContent = "Search & Results";
  }

  if (mobileToggleIcon) {
    mobileToggleIcon.textContent = "⌕";
  }

  setTimeout(() => {
    map.invalidateSize();
  }, 250);
}

function openMobileSidebar() {
  document.body.classList.add("sidebar-open");

  if (mobileToggleText) {
    mobileToggleText.textContent = "Close Panel";
  }

  if (mobileToggleIcon) {
    mobileToggleIcon.textContent = "✕";
  }

  setTimeout(() => {
    map.invalidateSize();
  }, 250);
}

if (mobileSidebarToggle) {
  mobileSidebarToggle.addEventListener("click", () => {
    if (document.body.classList.contains("sidebar-open")) {
      closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  });
}