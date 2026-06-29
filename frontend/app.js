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

let activeTool = "parking";
let amenityPinMarker = null;
let pinResults = [];

const placeInput = document.getElementById("place-input");
const analyzeBtn = document.getElementById("analyze-btn");
const exportBtn = document.getElementById("export-btn");
const statusEl = document.getElementById("status");
const resultsList = document.getElementById("results-list");
const loadingOverlay = document.getElementById("loading-overlay");
const mapStyleSelect = document.getElementById("map-style-select");
const parkingModeBtn = document.getElementById("parkingModeBtn");
const pinModeBtn = document.getElementById("pinModeBtn");

const amenityPinIcon = L.divIcon({
  className: "amenity-pin-icon",
  html: `<div class="amenity-pin-dot"></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  popupAnchor: [0, -12]
});

let progressInterval;
let currentProgress = 0;
let progressStartTime = 0;

function isCachedPlace(place) {
  const normalized = place.trim().toLowerCase();

  const cachedPlaces = [
    "woodstock, ontario, canada",
    "woodstock",
    "woodstock ontario",
    "woodstock ontario canada",
    "ingersoll, ontario, canada",
    "tillsonburg, ontario, canada",
    "st. thomas, ontario, canada",
    "stratford, ontario, canada"
  ];

  return cachedPlaces.includes(normalized);
}

function startProgress(place) {
  progressStartTime = Date.now();
  currentProgress = 0;

  const cached = isCachedPlace(place);
  const expectedDurationMs = cached ? 4000 : 75000;

  if (loadingOverlay) {
    loadingOverlay.innerHTML = `
      <div class="loading-box">
        <div class="spinner"></div>

        <div class="loading-copy">
          <p class="loading-title">Analyzing parking lots</p>
          <p class="loading-subtitle" id="loading-subtitle">
            Starting analysis...
          </p>
        </div>

        <div class="progress-bar">
          <div class="progress-fill" id="progress-fill"></div>
        </div>

        <div class="progress-row">
          <span id="progress-stage">Preparing request</span>
          <span id="progress-text">0%</span>
        </div>
      </div>
    `;
  }

  const progressFill = document.getElementById("progress-fill");
  const progressText = document.getElementById("progress-text");
  const progressStage = document.getElementById("progress-stage");
  const loadingSubtitle = document.getElementById("loading-subtitle");

  clearInterval(progressInterval);

  progressInterval = setInterval(() => {
    const elapsed = Date.now() - progressStartTime;
    currentProgress = Math.min(96, Math.round((elapsed / expectedDurationMs) * 100));

    if (progressFill) {
      progressFill.style.width = `${currentProgress}%`;
    }

    if (progressText) {
      progressText.textContent = `${currentProgress}%`;
    }

    if (progressStage && loadingSubtitle) {
      if (cached) {
        progressStage.textContent = "Loading cached analysis";
        loadingSubtitle.textContent = "Retrieving precomputed demo results...";
      } else if (currentProgress < 10) {
        progressStage.textContent = "Preparing request";
        loadingSubtitle.textContent = "Connecting to the Greyfield Finder API...";
      } else if (currentProgress < 30) {
        progressStage.textContent = "Fetching OSM data";
        loadingSubtitle.textContent = "Loading parking lots, amenities, transit, and commercial context...";
      } else if (currentProgress < 55) {
        progressStage.textContent = "Processing geometry";
        loadingSubtitle.textContent = "Filtering surface lots and calculating site areas...";
      } else if (currentProgress < 80) {
        progressStage.textContent = "Scoring locations";
        loadingSubtitle.textContent = "Measuring proximity to centres, transit, amenities, and services...";
      } else {
        progressStage.textContent = "Rendering map";
        loadingSubtitle.textContent = "Preparing polygons, popups, rankings, and CSV fields...";
      }
    }
  }, 500);
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

function setToolMode(mode) {
  activeTool = mode;

  parkingModeBtn.classList.toggle("active", mode === "parking");
  pinModeBtn.classList.toggle("active", mode === "pin");

  if (mode === "pin") {
    statusEl.textContent = "Amenity pin mode active. Click anywhere on the map to score that location.";
    map.getContainer().style.cursor = "crosshair";
  } else {
    statusEl.textContent = "Parking lot analysis mode active.";
    map.getContainer().style.cursor = "";
  }
}

function scoreBar(label, value, max) {
  const safeValue = Number(value ?? 0);
  const width = Math.max(0, Math.min(100, (safeValue / max) * 100));

  return `
    <div class="score-bar-row">
      <div class="score-bar-label">
        <span>${label}</span>
        <span>${safeValue}/${max}</span>
      </div>
      <div class="score-bar-track">
        <div class="score-bar-fill" style="width:${width}%"></div>
      </div>
    </div>
  `;
}

async function scoreAmenityPin(lat, lon) {
  const place = placeInput.value.trim();

  if (!place) {
    statusEl.textContent = "Enter a place before scoring a pin.";
    return;
  }

  statusEl.textContent = "Scoring amenity access for pin...";

  const url = `${API_BASE}/pin-score?place=${encodeURIComponent(place)}&lat=${lat}&lon=${lon}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new Error(data.message || "Could not score this pin.");
    }

    pinResults.push(data);

    const d = data.distances;

    const popupHtml = `
      <div class="popup-content">
        <h3>Amenity Access Pin</h3>
        <p><strong>Score:</strong> ${data.amenity_access_score}/100</p>
        <p><strong>Category:</strong> ${data.access_category}</p>
        <hr>
        <p><strong>Grocery:</strong> ${formatDistance(d.grocery_m)}</p>
        <p><strong>Health:</strong> ${formatDistance(d.health_m)}</p>
        <p><strong>Civic:</strong> ${formatDistance(d.civic_m)}</p>
        <p><strong>Park:</strong> ${formatDistance(d.park_m)}</p>
        <p><strong>Transit:</strong> ${formatDistance(d.transit_m)}</p>
        <p><strong>Commercial:</strong> ${formatDistance(d.commercial_m)}</p>
        <hr>
        <p><strong>Lat/Lon:</strong> ${data.lat}, ${data.lon}</p>
      </div>
    `;

    if (amenityPinMarker) {
      map.removeLayer(amenityPinMarker);
    }

    amenityPinMarker = L.marker([lat, lon], { icon: amenityPinIcon }).addTo(map);
    amenityPinMarker.bindPopup(popupHtml).openPopup();

    statusEl.textContent = `Amenity pin scored: ${data.amenity_access_score}/100 (${data.access_category}).`;
  } catch (error) {
    console.error(error);
    statusEl.textContent = `Pin scoring failed: ${error.message}`;
  }
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

    <strong>Priority:</strong> ${props.priority_category || getScoreClass(props.redevelopment_score)}<br />
    <strong>Redevelopment Score:</strong> ${props.redevelopment_score}/100<br />
    <strong>Amenity Access Score:</strong> ${props.amenity_access_score ?? "N/A"}/100<br />
    <strong>Interpretation:</strong> ${props.priority_category || getScoreClass(props.redevelopment_score)} redevelopment potential<br /><br />

    <strong>Area:</strong> ${Math.round(props.area_m2).toLocaleString()} m²<br />
    <strong>Distance to centre:</strong> ${formatDistance(props.distance_to_centre_m)}<br />
    <strong>Distance to transit:</strong> ${formatDistance(props.distance_to_transit_m)}<br />
    <strong>Nearest grocery:</strong> ${formatDistance(props.distance_to_grocery_m)}<br />
    <strong>Nearest health service:</strong> ${formatDistance(props.distance_to_health_m)}<br />
    <strong>Nearest civic service:</strong> ${formatDistance(props.distance_to_civic_m)}<br />
    <strong>Nearest park:</strong> ${formatDistance(props.distance_to_park_m)}<br />
    <strong>Commercial context:</strong> ${formatDistance(props.distance_to_commercial_m)}<br /><br />

<strong>Redevelopment score breakdown</strong>
${scoreBar("Area", props.area_score, 30)}
${scoreBar("Centre", props.centre_score, 20)}
${scoreBar("Transit", props.transit_score, 20)}
${scoreBar("Amenity", props.amenity_score, 20)}
${scoreBar("Commercial", props.commercial_score, 10)}

<br />
<strong>Amenity access breakdown</strong>
${scoreBar("Grocery", props.grocery_score, 20)}
${scoreBar("Health", props.health_score, 20)}
${scoreBar("Civic", props.civic_score, 15)}
${scoreBar("Park", props.park_score, 15)}
${scoreBar("Transit", props.walk_transit_score, 20)}
${scoreBar("Commercial", props.walk_commercial_score, 10)}
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
        <span class="score-pill" style="background:${getScoreColor(score)}">${props.priority_category || scoreClass}</span>
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
      "lot_id",
      "osm_type",
      "osm_id",
      "centroid_lat",
      "centroid_lon",
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
      "walk_commercial_score",
      "nearest_street",
    ]
  ];

  const sorted = [...latestFeatures].sort((a, b) => {
    return b.properties.redevelopment_score - a.properties.redevelopment_score;
  });

  sorted.forEach((feature, index) => {
    const p = feature.properties;

    rows.push([
      index + 1,
      p.lot_id,
      p.osm_type,
      p.osm_id,
      p.centroid_lat,
      p.centroid_lon,
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
      p.walk_commercial_score,
      p.nearest_street,
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

  startProgress(place);

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
      interactive: true,
      style: styleFeature,
      onEachFeature: (feature, layer) => {
      layer.bindPopup(popupHtml(feature.properties));
      featureLayers.push(layer);

            const score = feature.properties.redevelopment_score || 0;
      const tooltipText = `${feature.properties.priority_category || getScoreClass(score)} — ${score}/100`;

      layer.bindTooltip(tooltipText, {
        sticky: true,
        direction: "top",
        opacity: 0.95,
        className: "lot-tooltip"
      });

      layer.on("mouseover", () => {
        layer.bringToFront();

        layer.setStyle({
          weight: 5,
          fillOpacity: 0.9
        });

        layer.openTooltip();
      });

      layer.on("mousemove", () => {
        layer.openTooltip();
      });

      layer.on("mouseout", () => {
        parkingLayer.resetStyle(layer);
        layer.closeTooltip();
      });
    }
    }).addTo(map);

    requestAnimationFrame(() => {
    function animateParkingLots() {
      let animationDelay = 0;

      parkingLayer.eachLayer((layer) => {
        const path = layer.getElement ? layer.getElement() : layer._path;

        if (path) {
          path.style.animationDelay = `${animationDelay}ms`;

          path.classList.remove("parking-lot-animate");
          void path.offsetWidth;
          path.classList.add("parking-lot-animate");

          animationDelay += 12;
        }
      });
    }
    });
    
    if (geojson.features.length > 0) {
      map.fitBounds(parkingLayer.getBounds(), { padding: [20, 20] });
    }

    setTimeout(() => {
      map.invalidateSize();

      if (parkingLayer && geojson.features.length > 0) {
        map.fitBounds(parkingLayer.getBounds(), { padding: [20, 20] });
      }

      setTimeout(() => {
        animateParkingLots();
      }, 600);
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

if (parkingModeBtn && pinModeBtn) {
  parkingModeBtn.addEventListener("click", () => {
    setToolMode("parking");
  });

  pinModeBtn.addEventListener("click", () => {
    setToolMode("pin");
  });
}

map.on("click", (event) => {
  if (activeTool !== "pin") return;

  const { lat, lng } = event.latlng;
  scoreAmenityPin(lat, lng);
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