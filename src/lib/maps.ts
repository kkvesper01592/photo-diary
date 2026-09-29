/** 緯度・経度の地点を Google マップで開く URL */
export const mapUrlOf = (gps: { lat: number; lng: number }) =>
  `https://www.google.com/maps/search/?api=1&query=${gps.lat.toFixed(6)},${gps.lng.toFixed(6)}`
