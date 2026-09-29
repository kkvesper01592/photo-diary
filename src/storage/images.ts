import exifr from 'exifr'
import { localIso } from '../lib/dates'
import type { Gps } from './model'

export interface PhotoMeta {
  takenAt?: Date
  gps?: Gps
}

/** 写真に記録された撮影日時・位置情報(Android のカメラで「位置情報を記録」がオンの写真なら入っている) */
export async function readMeta(file: Blob): Promise<PhotoMeta> {
  try {
    const x = await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false })
    if (!x) return {}
    const t = x.DateTimeOriginal ?? x.CreateDate ?? x.DateTime
    const takenAt = t instanceof Date && !isNaN(t.getTime()) ? t : undefined
    const lat = x.latitude
    const lng = x.longitude
    const gps = typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0) ? { lat, lng } : undefined
    return { takenAt, gps }
  } catch {
    return {}
  }
}

export async function sha256(data: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await data.arrayBuffer())
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface Resized {
  width: number // 原本の幅・高さ(向きを直した後)
  height: number
  reduced: Blob
  thumb: Blob
}

async function encode(src: ImageBitmap, longEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, longEdge / Math.max(src.width, src.height))
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))
  const bmp = scale < 1 ? await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }) : src
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  if (bmp !== src) bmp.close()
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}

/** 縮小版とサムネイルを作る(写真の向きの情報どおりに回転させる) */
export async function makeResized(file: Blob, reducedLongEdge: number, thumbLongEdge: number): Promise<Resized> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const reduced = await encode(bmp, reducedLongEdge, 0.85)
    const thumb = await encode(bmp, thumbLongEdge, 0.8)
    return { width: bmp.width, height: bmp.height, reduced, thumb }
  } finally {
    bmp.close()
  }
}

export const takenAtString = (d: Date) => localIso(d)
