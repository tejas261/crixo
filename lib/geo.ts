// Geo helpers for location-scoped discovery (v12). Pure math, no I/O.

/** Radius (metres) within which a match counts as "nearby" on the dashboard. */
export const VICINITY_M = 500;

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in metres between two WGS84 points (haversine). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
