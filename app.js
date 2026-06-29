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
let displayedFeatures = [];

let activeTool = "parking";
let amenityPinMarkers = [];
let pinResults = [];

let progressInterval;
let currentProgress = 0;
let progressStartTime = 0;
let currentSource = null;
let currentPlace = "";
let activeTopTen = false;

const placeInput = document.getElementById("place-input");
const analyzeBtn = document.getElementById("analyze-btn");
const exportBtn = document.getElementById("export-btn");
const statusEl = document.getElementById("status");
const resultsList = document.getElementById("results-list");
const loadingOverlay = document.getElementById("loading-overlay");
const mapStyleSelect = document.getElementById("map-style-select");
const parkingModeBtn = document.getElementById("parkingModeBtn");
const pinModeBtn = document.getElementById("pinModeBtn");
const mobileSidebarToggle = document.getElementById("mobile-sidebar-toggle");
const mobileToggleText = document.querySelector(".mobile-toggle-text");
const mobileToggleIcon = document.querySelector(".mobile-toggle-icon");

const sourceBadge = document.getElementById("source-badge");
const pinHint = document.getElementById("pin-hint");

const minScoreInput = document.getElementById("min-score");
const minScoreValue = document.getElementById("min-score-value");
const minAreaInput = document.getElementById("min-area");
const highOnlyInput = document.getElementById("high-only");
const showTopBtn = document.getElementById("show-top-btn");
const resetFiltersBtn = document.getElementById("reset-filters-btn");
const clearPinsBtn = document.getElementById("clear-pins-btn");
const exportModeSelect = document.getElementById("export-mode");

const amenityPinIcon = L.divIcon({
  className: "amenity-pin-icon",
  html: `<div class="amenity-pin-dot"></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  popupAnchor: [0, -12]
});

function normalizePlace(place) {
  return place.trim().toLowerCase().replaceAll(",", " ").replace(/\s+/g, " ");
}

function isCachedPlace(place) {
  const normalized = normalizePlace(place);

  const cachedPlaces = [
    "woodstock",
    "woodstock ontario",
    "woodstock ontario canada",
    "woodstock oxford county ontario canada",
    "ingersoll",
    "ingersoll ontario",
    "ingersoll ontario canada",
    "tillsonburg",
    "tillsonburg ontario",
    "tillsonburg ontario canada",
    "st thomas",
    "st thomas ontario",
    "st thomas ontario canada",
    "st. thomas",
    "st. thomas ontario",
    "st. thomas ontario canada",
    "stratford",
    "stratford ontario",
    "stratford ontario canada"
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
          <p class="loading-subtitle" id="loading-subtitle">Starting analysis...</p>
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
  const progressStage = document.getElementById("progress-stage");
  const loadingSubtitle = document.getElementById("loading-subtitle");

  if (progressFill) progressFill.style.width = "100%";
  if (progressText) progressText.textContent = "100%";
  if (progressStage) progressStage.textContent = "Complete";
  if (loadingSubtitle) loadingSubtitle.textContent = "Analysis complete. Rendering results...";

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

  if (parkingModeBtn && pinModeBtn) {
    parkingModeBtn.classList.toggle("active", mode === "parking");
    pinModeBtn.classList.toggle("active", mode === "pin");
  }

  if (pinHint) {
    pinHint.classList.toggle("hidden", mode !== "pin");
  }

  if (mode === "pin") {
    statusEl.textContent = "Amenity pin mode active. Click anywhere on the map to score that location.";
    map.getContainer().style.cursor = "crosshair";
  } else {
    statusEl.textContent = "Parking lot analysis mode active.";
    map.getContainer().style.cursor = "";
  }
}

function getScoreClass(score) {
  if (score >= 80) return "Very High";
  if (score >= 65) return "High";
  if (score >= 50) return "Moderate";
  return "Low";
}

function getScoreColor(score) {
  if (score >= 75) return "#2ecc71";
  if (score >= 50) return "#f1c40f";
  return "#e74c3c";
}

function styleFeature(feature) {
  const score = feature.properties.redevelopment_score || 0;
  const zoom = map.getZoom();
  const zoomedOut = zoom < 13;

  return {
    color: "#ffffff",
    fillColor: getScoreColor(score),
    weight: zoomedOut ? 1.25 : score >= 75 ? 3 : 2,
    opacity: zoomedOut ? 0.82 : 1,
    fillOpacity: zoomedOut ? 0.35 : score >= 75 ? 0.7 : 0.5
  };
}

function formatDistance(value) {
  if (value === null || value === undefined) return "N/A";

  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} km`;
  }

  return `${Math.round(value)} m`;
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

function buildSiteReason(props) {
  const reasons = [];

  if ((props.area_score ?? 0) >= 20) reasons.push("large lot scale");
  if ((props.centre_score ?? 0) >= 14) reasons.push("town-centre proximity");
  if ((props.transit_score ?? 0) >= 14 || (props.walk_transit_score ?? 0) >= 14) reasons.push("nearby transit");
  if ((props.amenity_score ?? 0) >= 14 || (props.amenity_access_score ?? 0) >= 75) reasons.push("strong daily-needs access");
  if ((props.commercial_score ?? 0) >= 7) reasons.push("commercial context");

  if (!reasons.length) {
    return "Lower-priority screening result. Review parcel details, zoning, ownership, servicing, and local constraints before considering redevelopment potential.";
  }

  const firstReasons = reasons.slice(0, 3).join(", ");
  return `Strong candidate because of ${firstReasons}. Use this as a screening flag, not a final site-selection decision.`;
}


function googleMapsIcon() {
  return `
    <span class="gmaps-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path fill="#34A853" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
        <path fill="#FBBC04" d="M12 2v20s7-7.75 7-13c0-3.87-3.13-7-7-7z" opacity="0.88"/>
        <path fill="#4285F4" d="M12 5.25A3.75 3.75 0 1 0 12 12.75 3.75 3.75 0 0 0 12 5.25z"/>
        <path fill="#EA4335" d="M12 2C8.13 2 5 5.13 5 9c0 2.15 1.17 4.7 2.57 6.98L12 9V2z" opacity="0.95"/>
        <circle cx="12" cy="9" r="2.05" fill="#fff"/>
      </svg>
    </span>
  `;
}

function googleMapsLinkHtml(lat, lon, label = "Open in Google Maps") {
  const mapsUrl = googleMapsUrl(lat, lon);
  if (!mapsUrl) return "";

  return `<a class="map-action map-action-google" href="${mapsUrl}" target="_blank" rel="noopener">${googleMapsIcon()}<span>${label}</span></a>`;
}

function coordinateDisplay(lat, lon) {
  if (lat === null || lat === undefined || lon === null || lon === undefined) return "";
  return `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
}

function clearAmenityPins() {
  amenityPinMarkers.forEach((marker) => map.removeLayer(marker));
  amenityPinMarkers = [];
  pinResults = [];

  if (clearPinsBtn) clearPinsBtn.disabled = true;
  statusEl.textContent = "Cleared amenity pins.";
}

function googleMapsUrl(lat, lon) {
  if (lat === null || lat === undefined || lon === null || lon === undefined) {
    return null;
  }

  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

window.copyLotCoordinates = async function copyLotCoordinates(lat, lon) {
  const text = `${lat}, ${lon}`;

  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = `Copied coordinates: ${text}`;
  } catch (error) {
    console.error(error);
    statusEl.textContent = `Coordinates: ${text}`;
  }
};

function popupHtml(props) {
  const priority = props.priority_category || getScoreClass(props.redevelopment_score);
  return `
    <div class="gf-popup">
      <div class="gf-popup-header">
        <div>
          <div class="gf-eyebrow">${props.name || "Surface parking lot"}</div>
          <h3>${props.redevelopment_score}/100</h3>
        </div>
        <span class="gf-badge">${priority}</span>
      </div>

      <div class="gf-popup-section gf-insight">
        ${buildSiteReason(props)}
      </div>

      <div class="gf-popup-section">
        <div class="gf-stat-row">
          <span>Amenity Access</span>
          <strong>${props.amenity_access_score ?? "N/A"}/100</strong>
        </div>
        <div class="gf-stat-row">
          <span>Area</span>
          <strong>${Math.round(props.area_m2).toLocaleString()} m²</strong>
        </div>
        <div class="gf-stat-row">
          <span>Centre</span>
          <strong>${formatDistance(props.distance_to_centre_m)}</strong>
        </div>
        <div class="gf-stat-row">
          <span>Transit</span>
          <strong>${formatDistance(props.distance_to_transit_m)}</strong>
        </div>
        <div class="gf-stat-row">
          <span>Grocery</span>
          <strong>${formatDistance(props.distance_to_grocery_m)}</strong>
        </div>
        <div class="gf-stat-row">
          <span>Health</span>
          <strong>${formatDistance(props.distance_to_health_m)}</strong>
        </div>
        <div class="gf-stat-row">
          <span>Civic</span>
          <strong>${formatDistance(props.distance_to_civic_m)}</strong>
        </div>
        <div class="gf-stat-row">
          <span>Park</span>
          <strong>${formatDistance(props.distance_to_park_m)}</strong>
        </div>
        <div class="gf-stat-row">
          <span>Commercial</span>
          <strong>${formatDistance(props.distance_to_commercial_m)}</strong>
        </div>
        ${
          props.centroid_lat && props.centroid_lon
            ? `<div class="gf-stat-row gf-coord-row"><span>Coordinates</span><strong>${coordinateDisplay(props.centroid_lat, props.centroid_lon)}</strong></div>`
            : ""
        }
      </div>

      <div class="gf-popup-section">
        <div class="gf-section-title">Redevelopment breakdown</div>
        ${scoreBar("Area", props.area_score, 30)}
        ${scoreBar("Centre", props.centre_score, 20)}
        ${scoreBar("Transit", props.transit_score, 20)}
        ${scoreBar("Amenity", props.amenity_score, 20)}
        ${scoreBar("Commercial", props.commercial_score, 10)}
      </div>

      <div class="gf-popup-section">
        <div class="gf-section-title">Amenity access breakdown</div>
        ${scoreBar("Grocery", props.grocery_score, 20)}
        ${scoreBar("Health", props.health_score, 20)}
        ${scoreBar("Civic", props.civic_score, 15)}
        ${scoreBar("Park", props.park_score, 15)}
        ${scoreBar("Transit", props.walk_transit_score, 20)}
        ${scoreBar("Commercial", props.walk_commercial_score, 10)}
      </div>

      <div class="gf-popup-actions">
        ${googleMapsLinkHtml(props.centroid_lat, props.centroid_lon)}
        ${
          props.centroid_lat && props.centroid_lon
            ? `<button class="map-action" type="button" onclick="copyLotCoordinates(${props.centroid_lat}, ${props.centroid_lon})"><span class="coord-icon" aria-hidden="true">⌖</span><span>Copy coordinates</span></button>`
            : ""
        }
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

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.message || "Could not score this pin.");
    }

    pinResults.push(data);

    const d = data.distances;
    const mapsUrl = googleMapsUrl(data.lat, data.lon);

    const popupHtml = `
      <div class="gf-popup">
        <div class="gf-popup-header">
          <div>
            <div class="gf-eyebrow">Amenity Access Pin</div>
            <h3>${data.amenity_access_score}/100</h3>
          </div>
          <span class="gf-badge">${data.access_category}</span>
        </div>

        <div class="gf-popup-section gf-insight">
          This pin estimates local daily-needs access from the clicked point using nearby grocery, health, civic, park, transit, and commercial features.
        </div>

        <div class="gf-popup-section">
          <div class="gf-stat-row">
            <span>Grocery</span>
            <strong>${formatDistance(d.grocery_m)}</strong>
          </div>
          <div class="gf-stat-row">
            <span>Health</span>
            <strong>${formatDistance(d.health_m)}</strong>
          </div>
          <div class="gf-stat-row">
            <span>Civic</span>
            <strong>${formatDistance(d.civic_m)}</strong>
          </div>
          <div class="gf-stat-row">
            <span>Park</span>
            <strong>${formatDistance(d.park_m)}</strong>
          </div>
          <div class="gf-stat-row">
            <span>Transit</span>
            <strong>${formatDistance(d.transit_m)}</strong>
          </div>
          <div class="gf-stat-row">
            <span>Commercial</span>
            <strong>${formatDistance(d.commercial_m)}</strong>
          </div>
        </div>

        <div class="gf-popup-actions">
          ${googleMapsLinkHtml(data.lat, data.lon)}
          <button class="map-action" type="button" onclick="copyLotCoordinates(${coordinateDisplay(data.lat, data.lon)})"><span class="coord-icon" aria-hidden="true">⌖</span><span>Copy coordinates</span></button>
        </div>

        <div class="gf-popup-footer">
          ${coordinateDisplay(data.lat, data.lon)}
        </div>
      </div>
    `;

    const marker = L.marker([lat, lon], { icon: amenityPinIcon }).addTo(map);
    marker.bindPopup(popupHtml).openPopup();
    amenityPinMarkers.push(marker);
    if (clearPinsBtn) clearPinsBtn.disabled = false;

    if (amenityPinMarkers.length > 20) {
      const oldestMarker = amenityPinMarkers.shift();
      map.removeLayer(oldestMarker);
    }

    statusEl.textContent = `Amenity pin scored: ${data.amenity_access_score}/100 (${data.access_category}).`;
  } catch (error) {
    console.error(error);
    statusEl.textContent = `Pin scoring failed: ${error.message}`;
  }
}

function renderResultsList(features) {
  resultsList.innerHTML = "";

  const sorted = [...features].sort((a, b) => {
    return b.properties.redevelopment_score - a.properties.redevelopment_score;
  });

  sorted.slice(0, 20).forEach((feature, index) => {
    const props = feature.properties;
    const score = props.redevelopment_score;
    const scoreClass = props.priority_category || getScoreClass(score);

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

function getFilterValues() {
  return {
    minScore: Number(minScoreInput?.value ?? 0),
    minArea: Number(minAreaInput?.value ?? 0),
    highOnly: Boolean(highOnlyInput?.checked)
  };
}

function getFilteredFeatures() {
  const filters = getFilterValues();

  let features = [...latestFeatures];

  features = features.filter((feature) => {
    const props = feature.properties;
    const score = Number(props.redevelopment_score ?? 0);
    const area = Number(props.area_m2 ?? 0);

    if (score < filters.minScore) return false;
    if (area < filters.minArea) return false;
    if (filters.highOnly && score < 65) return false;

    return true;
  });

  features.sort((a, b) => {
    return b.properties.redevelopment_score - a.properties.redevelopment_score;
  });

  if (activeTopTen) {
    features = features.slice(0, 10);
  }

  return features;
}

function updateSourceBadge() {
  if (!sourceBadge) return;

  if (!currentSource) {
    sourceBadge.classList.add("hidden");
    return;
  }

  sourceBadge.classList.remove("hidden");

  if (currentSource === "cached") {
    sourceBadge.textContent = "Source: cached case study";
    sourceBadge.classList.add("cached");
    sourceBadge.classList.remove("live");
  } else {
    sourceBadge.textContent = "Source: live OpenStreetMap query";
    sourceBadge.classList.add("live");
    sourceBadge.classList.remove("cached");
  }
}

function updateFilterLabels() {
  if (minScoreInput && minScoreValue) {
    minScoreValue.textContent = `${minScoreInput.value}+`;
  }
}

function renderParkingFeatures(features, fitBounds = false) {
  displayedFeatures = features;

  if (parkingLayer) {
    map.removeLayer(parkingLayer);
    parkingLayer = null;
  }

  featureLayers = [];

  const featureCollection = {
    type: "FeatureCollection",
    features
  };

  parkingLayer = L.geoJSON(featureCollection, {
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
          color: "#a855f7",
          weight: 5,
          opacity: 1,
          fillOpacity: 0.9
        });

        const path = layer.getElement ? layer.getElement() : layer._path;

        if (path) {
          path.classList.add("parking-lot-hover");
        }

        layer.openTooltip();
      });

      layer.on("mousemove", () => {
        layer.openTooltip();
      });

      layer.on("mouseout", () => {
        const path = layer.getElement ? layer.getElement() : layer._path;

        if (path) {
          path.classList.remove("parking-lot-hover");
        }

        if (parkingLayer) {
          parkingLayer.resetStyle(layer);
        }

        layer.closeTooltip();
      });
    }
  }).addTo(map);

  if (fitBounds && features.length > 0) {
    map.fitBounds(parkingLayer.getBounds(), { padding: [20, 20] });
  }

  setTimeout(() => {
    animateParkingLots();
  }, 250);
}

function applyFilters(fitBounds = false) {
  if (!latestFeatures.length) return;

  updateFilterLabels();

  const filtered = getFilteredFeatures();
  renderParkingFeatures(filtered, fitBounds);
  renderResultsList(filtered);

  const topModeText = activeTopTen ? " top-ranked" : "";
  const filterText = filtered.length === latestFeatures.length
    ? ""
    : ` (${filtered.length} shown after filters)`;

  statusEl.textContent = `Found ${latestFeatures.length} candidate parking lots in ${currentPlace}.${topModeText}${filterText}`;
  exportBtn.disabled = filtered.length === 0;
}

function getExportFeatures() {
  const mode = exportModeSelect?.value || "filtered";

  if (mode === "all") {
    return [...latestFeatures];
  }

  if (mode === "top20") {
    return [...latestFeatures]
      .sort((a, b) => b.properties.redevelopment_score - a.properties.redevelopment_score)
      .slice(0, 20);
  }

  if (mode === "visible") {
    const bounds = map.getBounds();

    return displayedFeatures.filter((feature) => {
      const props = feature.properties;
      const lat = props.centroid_lat;
      const lon = props.centroid_lon;

      if (lat === null || lat === undefined || lon === null || lon === undefined) {
        return false;
      }

      return bounds.contains([lat, lon]);
    });
  }

  return [...displayedFeatures];
}

function exportCsv() {
  const features = getExportFeatures();

  if (!features.length) {
    statusEl.textContent = "No matching results to export.";
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
      "priority_category",
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
      "nearest_street"
    ]
  ];

  const sorted = [...features].sort((a, b) => {
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
      p.priority_category,
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
      p.nearest_street
    ]);
  });

  const csv = rows
    .map((row) =>
      row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const mode = exportModeSelect?.value || "filtered";
  const link = document.createElement("a");
  link.href = url;
  link.download = `greyfield-finder-${mode}-results.csv`;
  link.click();

  URL.revokeObjectURL(url);
}

function animateParkingLots() {
  if (!parkingLayer) return;

  let animationDelay = 0;

  parkingLayer.eachLayer((layer) => {
    const path = layer.getElement ? layer.getElement() : layer._path;

    if (path) {
      path.style.animationDelay = `${animationDelay}ms`;

      path.classList.remove("parking-lot-animate");

      // Force browser to restart the CSS animation
      void path.offsetWidth;

      path.classList.add("parking-lot-animate");

      animationDelay += 12;
    }
  });
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
  displayedFeatures = [];
  currentSource = null;
  currentPlace = place;
  activeTopTen = false;
  updateSourceBadge();

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
    currentSource = data.source || "live_osmnx";
    currentPlace = data.place || place;

    updateSourceBadge();
    applyFilters(true);

    setTimeout(() => {
      map.invalidateSize();

      if (parkingLayer && displayedFeatures.length > 0) {
        map.fitBounds(parkingLayer.getBounds(), { padding: [20, 20] });
      }

      setTimeout(() => {
        animateParkingLots();
      }, 600);
    }, 300);

    exportBtn.disabled = displayedFeatures.length === 0;
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

if (minScoreInput) {
  minScoreInput.addEventListener("input", () => {
    activeTopTen = false;
    applyFilters();
  });
}

if (minAreaInput) {
  minAreaInput.addEventListener("input", () => {
    activeTopTen = false;
    applyFilters();
  });
}

if (highOnlyInput) {
  highOnlyInput.addEventListener("change", () => {
    activeTopTen = false;
    applyFilters();
  });
}

if (showTopBtn) {
  showTopBtn.addEventListener("click", () => {
    activeTopTen = true;
    applyFilters(true);
  });
}

if (resetFiltersBtn) {
  resetFiltersBtn.addEventListener("click", () => {
    if (minScoreInput) minScoreInput.value = "0";
    if (minAreaInput) minAreaInput.value = "0";
    if (highOnlyInput) highOnlyInput.checked = false;

    activeTopTen = false;
    applyFilters(true);
  });
}

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

map.on("zoomend", () => {
  if (parkingLayer) {
    parkingLayer.setStyle(styleFeature);
  }
});

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

window.addEventListener("load", () => {
  updateFilterLabels();

  setTimeout(() => {
    map.invalidateSize();
  }, 300);
});

window.addEventListener("resize", () => {
  setTimeout(() => {
    map.invalidateSize();
  }, 150);
});
