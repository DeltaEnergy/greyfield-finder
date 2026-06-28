from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

import json
from pathlib import Path
from math import radians, sin, cos, sqrt, atan2
from functools import lru_cache

import geopandas as gpd
import osmnx as ox
import pandas as pd

from fastapi.middleware.gzip import GZipMiddleware


ox.settings.use_cache = True
ox.settings.log_console = True
ox.settings.requests_timeout = 45
ox.settings.http_user_agent = "GreyfieldFinder/1.0 sammywoodstock@gmail.com"


BASE_DIR = Path(__file__).resolve().parent
CACHE_DIR = BASE_DIR / "cached"

CACHED_PLACES = {
    "woodstock": CACHE_DIR / "woodstock.json",
    "woodstock ontario": CACHE_DIR / "woodstock.json",
    "woodstock ontario canada": CACHE_DIR / "woodstock.json",
    "woodstock oxford county ontario canada": CACHE_DIR / "woodstock.json",

    "ingersoll": CACHE_DIR / "ingersoll.json",
    "ingersoll ontario": CACHE_DIR / "ingersoll.json",
    "ingersoll ontario canada": CACHE_DIR / "ingersoll.json",
    "ingersoll oxford county ontario canada": CACHE_DIR / "ingersoll.json",

    "tillsonburg": CACHE_DIR / "tillsonburg.json",
    "tillsonburg ontario": CACHE_DIR / "tillsonburg.json",
    "tillsonburg ontario canada": CACHE_DIR / "tillsonburg.json",
    "tillsonburg oxford county ontario canada": CACHE_DIR / "tillsonburg.json",

    "st thomas": CACHE_DIR / "st-thomas.json",
    "st. thomas": CACHE_DIR / "st-thomas.json",
    "st thomas ontario": CACHE_DIR / "st-thomas.json",
    "st. thomas ontario": CACHE_DIR / "st-thomas.json",
    "st thomas ontario canada": CACHE_DIR / "st-thomas.json",
    "st. thomas ontario canada": CACHE_DIR / "st-thomas.json",

    "stratford": CACHE_DIR / "stratford.json",
    "stratford ontario": CACHE_DIR / "stratford.json",
    "stratford ontario canada": CACHE_DIR / "stratford.json",
}

app = FastAPI(title="Greyfield Finder API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

WOODSTOCK_NAMES = {
    "woodstock",
    "woodstock ontario",
    "woodstock ontario canada",
    "woodstock oxford county ontario canada",
    "woodstock, ontario",
    "woodstock, ontario, canada",
    "woodstock, oxford county, ontario, canada",
}


def normalize_place(place: str) -> str:
    return " ".join(place.strip().lower().replace(",", " ").split())


def get_cached_place_path(place: str):
    normalized = normalize_place(place)
    return CACHED_PLACES.get(normalized)


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000

    phi1 = radians(lat1)
    phi2 = radians(lat2)
    d_phi = radians(lat2 - lat1)
    d_lam = radians(lon2 - lon1)

    a = sin(d_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(d_lam / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    return r * c


def points_for_distance(distance_m, max_points, excellent_m, poor_m):
    if distance_m is None:
        return 0

    if distance_m <= excellent_m:
        return max_points

    if distance_m >= poor_m:
        return 0

    ratio = 1 - ((distance_m - excellent_m) / (poor_m - excellent_m))
    return round(max_points * ratio, 1)


def points_for_walk_distance(distance_m, max_points):
    """
    Amenity access scoring:
    Full points within 400m.
    Partial points up to 1200m.
    Zero points beyond 1200m.
    """
    if distance_m is None:
        return 0

    if distance_m <= 400:
        return max_points

    if distance_m >= 1200:
        return 0

    ratio = 1 - ((distance_m - 400) / (1200 - 400))
    return round(max_points * ratio, 1)


def points_for_area(area_m2):
    if area_m2 >= 10000:
        return 30
    if area_m2 >= 7500:
        return 25
    if area_m2 >= 5000:
        return 20
    if area_m2 >= 3000:
        return 15
    if area_m2 >= 1500:
        return 8

    return 0


def get_centroid_latlon(geom):
    centroid = geom.centroid
    return centroid.y, centroid.x


def nearest_distance_to_points(lat, lon, points_gdf):
    if points_gdf is None or points_gdf.empty:
        return None

    distances = []

    for geom in points_gdf.geometry:
        if geom is None or geom.is_empty:
            continue

        if geom.geom_type == "Point":
            p = geom
        else:
            p = geom.centroid

        distances.append(haversine_m(lat, lon, p.y, p.x))

    if not distances:
        return None

    return min(distances)

def access_category(score):
    if score >= 80:
        return "Very High Access"
    if score >= 65:
        return "High Access"
    if score >= 50:
        return "Moderate Access"
    return "Low Access"

def priority_category(score):
    if score >= 80:
        return "Very High"
    if score >= 65:
        return "High"
    if score >= 50:
        return "Moderate"
    return "Low"

def empty_gdf():
    return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")


def fetch_osm_features(place, tags):
    """
    Safely fetches OpenStreetMap features for a place.
    Returns an empty GeoDataFrame if the query fails.
    """
    try:
        return ox.features_from_place(place, tags).to_crs(epsg=4326)
    except Exception:
        return empty_gdf()

@lru_cache(maxsize=12)
def get_context_features(place):
    """
    Loads and caches amenity/transit/commercial context for a place.
    First request may be slow because it queries OSM.
    Later pin scores for the same place are fast.
    """
    transit_tags = {
        "highway": "bus_stop",
        "public_transport": "platform",
        "railway": "station",
    }

    amenity_tags = {
        "amenity": ["school", "pharmacy", "library", "clinic", "hospital", "doctors", "dentist", "community_centre", "townhall", "playground"],
        "shop": ["supermarket", "convenience", "grocery"],
        "leisure": ["park", "recreation_ground"],
    }

    commercial_tags = {
        "landuse": ["commercial", "retail"],
        "shop": True,
    }

    transit = fetch_osm_features(place, transit_tags)
    amenities = fetch_osm_features(place, amenity_tags)
    commercial = fetch_osm_features(place, commercial_tags)

    if amenities.empty:
        grocery = empty_gdf()
        health = empty_gdf()
        civic = empty_gdf()
        parks = empty_gdf()
    else:
        if "shop" in amenities.columns:
            grocery = amenities[
                amenities["shop"].isin(["supermarket", "convenience", "grocery"])
            ].copy()
        else:
            grocery = empty_gdf()

        if "amenity" in amenities.columns:
            health = amenities[
                amenities["amenity"].isin(["pharmacy", "clinic", "hospital", "doctors", "dentist"])
            ].copy()

            civic = amenities[
                amenities["amenity"].isin(["school", "library", "community_centre", "townhall"])
            ].copy()
        else:
            health = empty_gdf()
            civic = empty_gdf()

        if "leisure" in amenities.columns:
            parks = amenities[
                amenities["leisure"].isin(["park", "recreation_ground"])
            ].copy()
        else:
            parks = empty_gdf()

        if "amenity" in amenities.columns:
            playgrounds = amenities[
                amenities["amenity"].isin(["playground"])
            ].copy()

            if not playgrounds.empty:
                parks = pd.concat([parks, playgrounds], ignore_index=True)

    return transit, amenities, commercial, grocery, health, civic, parks

@app.get("/")
def root():
    return {"message": "Greyfield Finder API is running."}

def nearest_named_feature(lat, lon, features_gdf, name_col="name"):
    if features_gdf is None or features_gdf.empty or name_col not in features_gdf.columns:
        return None

    best_name = None
    best_dist = None

    for _, feature in features_gdf.iterrows():
        name = feature.get(name_col, None)

        if pd.isna(name) or name is None:
            continue

        geom = feature.geometry

        if geom is None or geom.is_empty:
            continue

        p = geom.centroid
        dist = haversine_m(lat, lon, p.y, p.x)

        if best_dist is None or dist < best_dist:
            best_dist = dist
            best_name = str(name)

    return best_name

@app.get("/analyze")
def analyze_place(place: str = Query(..., description="Example: Woodstock, Ontario, Canada")):
    cached_path = get_cached_place_path(place)

    if cached_path and cached_path.exists():
        with open(cached_path, "r", encoding="utf-8-sig") as f:
            cached_data = json.load(f)

        cached_data["source"] = "cached"
        cached_data["note"] = "This result uses a precomputed analysis for reliable public demo performance."
        return cached_data

    parking_tags = {"amenity": "parking"}

    try:
        parking = ox.features_from_place(place, parking_tags)
    except Exception as e:
        return {
            "error": True,
            "message": f"Could not fetch parking data for {place}. Try a more specific place name.",
            "details": str(e),
        }

    if parking.empty:
        return {
            "error": True,
            "message": f"No parking lots found in OpenStreetMap for {place}.",
        }

    parking = parking[parking.geometry.type.isin(["Polygon", "MultiPolygon"])].copy()

    if parking.empty:
        return {
            "error": True,
            "message": f"Parking data exists for {place}, but no polygon lots were found.",
        }

    parking = parking.to_crs(epsg=4326)

    parking_projected = parking.to_crs(epsg=3857)
    parking["area_m2"] = parking_projected.geometry.area

    parking = parking[parking["area_m2"] >= 2500].copy()

    if parking.empty:
        return {
            "error": True,
            "message": f"No parking lots larger than 2,500 m² were found for {place}.",
        }

    try:
        place_gdf = ox.geocode_to_gdf(place).to_crs(epsg=4326)
        centre_geom = place_gdf.geometry.iloc[0].centroid
        centre_lat, centre_lon = centre_geom.y, centre_geom.x
    except Exception:
        centre_lat = parking.geometry.centroid.y.mean()
        centre_lon = parking.geometry.centroid.x.mean()

    transit, amenities, commercial, grocery, health, civic, parks = get_context_features(place)
    
    road_tags = {"highway": True}
    roads = fetch_osm_features(place, road_tags)

    if not roads.empty:
        roads = roads[roads.geometry.type.isin(["LineString", "MultiLineString"])].copy()

    results = []

    for idx, row in parking.iterrows():
        geom = row.geometry
        lat, lon = get_centroid_latlon(geom)
        area_m2 = float(row["area_m2"])

        nearest_street = nearest_named_feature(lat, lon, roads)

        osm_type = None
        osm_id = None

        

        if isinstance(idx, tuple) and len(idx) >= 2:
            osm_type = str(idx[0])
            osm_id = str(idx[1])
        else:
            osm_id = str(idx)

        lot_id = f"{osm_type or 'osm'}-{osm_id}"

        dist_centre = haversine_m(lat, lon, centre_lat, centre_lon)
        dist_transit = nearest_distance_to_points(lat, lon, transit)
        dist_amenity = nearest_distance_to_points(lat, lon, amenities)
        dist_commercial = nearest_distance_to_points(lat, lon, commercial)

        dist_grocery = nearest_distance_to_points(lat, lon, grocery)
        dist_health = nearest_distance_to_points(lat, lon, health)
        dist_civic = nearest_distance_to_points(lat, lon, civic)
        dist_park = nearest_distance_to_points(lat, lon, parks)

        area_score = points_for_area(area_m2)
        centre_score = points_for_distance(dist_centre, 20, 500, 3000)
        transit_score = points_for_distance(dist_transit, 20, 250, 1500)
        amenity_score = points_for_distance(dist_amenity, 20, 300, 1500)
        commercial_score = points_for_distance(dist_commercial, 10, 250, 1200)

        redevelopment_score = round(
            area_score + centre_score + transit_score + amenity_score + commercial_score,
            1,
        )

        grocery_score = points_for_walk_distance(dist_grocery, 20)
        health_score = points_for_walk_distance(dist_health, 20)
        civic_score = points_for_walk_distance(dist_civic, 15)
        park_score = points_for_walk_distance(dist_park, 15)
        walk_transit_score = points_for_walk_distance(dist_transit, 20)
        walk_commercial_score = points_for_walk_distance(dist_commercial, 10)

        amenity_access_score = round(
            grocery_score
            + health_score
            + civic_score
            + park_score
            + walk_transit_score
            + walk_commercial_score,
            1,
        )

        name = row.get("name", None)

        if pd.isna(name) or name is None:
            name = "Surface parking lot"

        results.append(
            {
                "geometry": geom,
                "name": str(name),
                "area_m2": round(area_m2, 1),
                "distance_to_centre_m": round(dist_centre, 1) if dist_centre is not None else None,
                "distance_to_transit_m": round(dist_transit, 1) if dist_transit is not None else None,
                "distance_to_amenity_m": round(dist_amenity, 1) if dist_amenity is not None else None,
                "distance_to_commercial_m": round(dist_commercial, 1) if dist_commercial is not None else None,
                "distance_to_grocery_m": round(dist_grocery, 1) if dist_grocery is not None else None,
                "distance_to_health_m": round(dist_health, 1) if dist_health is not None else None,
                "distance_to_civic_m": round(dist_civic, 1) if dist_civic is not None else None,
                "distance_to_park_m": round(dist_park, 1) if dist_park is not None else None,
                "lot_id": lot_id,
                "osm_type": osm_type,
                "osm_id": osm_id,
                "centroid_lat": round(lat, 6),
                "centroid_lon": round(lon, 6),
                "area_score": area_score,
                "centre_score": centre_score,
                "transit_score": transit_score,
                "amenity_score": amenity_score,
                "commercial_score": commercial_score,
                "redevelopment_score": redevelopment_score,
                "priority_category": priority_category(amenity_access_score),
                "amenity_access_score": amenity_access_score,
                "grocery_score": grocery_score,
                "health_score": health_score,
                "civic_score": civic_score,
                "park_score": park_score,
                "walk_transit_score": walk_transit_score,
                "walk_commercial_score": walk_commercial_score,
                "nearest_street": nearest_street,
            }
        )

    result_gdf = gpd.GeoDataFrame(results, geometry="geometry", crs="EPSG:4326")
    result_gdf = result_gdf.sort_values("redevelopment_score", ascending=False)

    return {
        "error": False,
        "place": place,
        "count": len(result_gdf),
        "centre": {
            "lat": centre_lat,
            "lon": centre_lon,
        },
        "geojson": result_gdf.to_json(),
        "source": "live_osmnx",
    }

@app.get("/pin-score")
def pin_score(
    place: str = Query(..., description="Example: Woodstock, Ontario, Canada"),
    lat: float = Query(...),
    lon: float = Query(...),
):
    transit, amenities, commercial, grocery, health, civic, parks = get_context_features(place)

    dist_grocery = nearest_distance_to_points(lat, lon, grocery)
    dist_health = nearest_distance_to_points(lat, lon, health)
    dist_civic = nearest_distance_to_points(lat, lon, civic)
    dist_park = nearest_distance_to_points(lat, lon, parks)
    dist_transit = nearest_distance_to_points(lat, lon, transit)
    dist_commercial = nearest_distance_to_points(lat, lon, commercial)

    grocery_score = points_for_walk_distance(dist_grocery, 20)
    health_score = points_for_walk_distance(dist_health, 20)
    civic_score = points_for_walk_distance(dist_civic, 15)
    park_score = points_for_walk_distance(dist_park, 15)
    transit_score = points_for_walk_distance(dist_transit, 20)
    commercial_score = points_for_walk_distance(dist_commercial, 10)

    amenity_access_score = round(
        grocery_score
        + health_score
        + civic_score
        + park_score
        + transit_score
        + commercial_score,
        1,
    )

    return {
        "error": False,
        "place": place,
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "amenity_access_score": amenity_access_score,
        "access_category": access_category(amenity_access_score),
        "priority_category": priority_category(redevelopment_score),
        "distances": {
            "grocery_m": round(dist_grocery, 1) if dist_grocery is not None else None,
            "health_m": round(dist_health, 1) if dist_health is not None else None,
            "civic_m": round(dist_civic, 1) if dist_civic is not None else None,
            "park_m": round(dist_park, 1) if dist_park is not None else None,
            "transit_m": round(dist_transit, 1) if dist_transit is not None else None,
            "commercial_m": round(dist_commercial, 1) if dist_commercial is not None else None,
        },
        "scores": {
            "grocery_score": grocery_score,
            "health_score": health_score,
            "civic_score": civic_score,
            "park_score": park_score,
            "transit_score": transit_score,
            "commercial_score": commercial_score,
        },
    }