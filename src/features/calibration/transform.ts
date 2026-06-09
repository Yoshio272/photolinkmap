import type { CalibPoint, LatLng } from '../../types'

export function pxToLatLng(px: number, py: number, pts: CalibPoint[]): LatLng {
  const [a, b] = pts
  if (!a || !b || a.lat === undefined || b.lat === undefined) return { lat: 0, lng: 0 }
  const dpx = b.px - a.px, dpy = b.py - a.py
  const dlat = b.lat! - a.lat!, dlng = b.lng! - a.lng!
  const denom = dpx * dpx + dpy * dpy || 1
  const rx = px - a.px, ry = py - a.py
  const t = (rx * dpx + ry * dpy) / denom
  const u = (-rx * dpy + ry * dpx) / denom
  return {
    lat: parseFloat((a.lat + t * dlat - u * dlng).toFixed(7)),
    lng: parseFloat((a.lng! + t * dlng + u * dlat).toFixed(7)),
  }
}

export function latLngToPx(lat: number, lng: number, pts: CalibPoint[]): { x: number; y: number } | null {
  const [a, b] = pts
  if (!a || !b || a.lat === undefined || b.lat === undefined) return null
  const dpx = b.px - a.px, dpy = b.py - a.py
  const dlat = b.lat! - a.lat!, dlng = b.lng! - a.lng!
  const denom = dlat * dlat + dlng * dlng || 1
  const rlat = lat - a.lat, rlng = lng - a.lng!
  const t = (rlat * dlat + rlng * dlng) / denom
  const u = (-rlat * dlng + rlng * dlat) / denom
  return { x: a.px + t * dpx - u * dpy, y: a.py + t * dpy + u * dpx }
}

export function parseLatLng(str: string): LatLng | null {
  if (!str) return null
  // Google Maps URL @lat,lng
  let m = str.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  // URL param ll= or q=
  m = str.match(/[?&](?:ll|q)=(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  // "35.1234, 135.5678"
  m = str.trim().match(/^(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)$/)
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  return null
}
