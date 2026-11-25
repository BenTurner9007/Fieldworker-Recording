// WGS84 (GPS) -> OSGB36 British National Grid (EPSG:27700).
//
// Uses the Ordnance Survey 7-parameter Helmert transformation, which is
// accurate to roughly 5 m. That is well within the error of a phone GPS,
// but NOT good enough for survey control — use a GNSS rover with OSTN15
// for anything that needs to be tied in properly.

const deg2rad = (d) => (d * Math.PI) / 180;
const rad2deg = (r) => (r * 180) / Math.PI;

const WGS84 = { a: 6378137.0, b: 6356752.314245 };
const AIRY1830 = { a: 6377563.396, b: 6356256.909 };

// WGS84 -> OSGB36 Helmert parameters
const H = {
  tx: -446.448, ty: 125.157, tz: -542.06,
  s: 20.4894e-6,
  rx: deg2rad(-0.1502 / 3600), ry: deg2rad(-0.247 / 3600), rz: deg2rad(-0.8421 / 3600),
};

function toCartesian(lat, lon, h, { a, b }) {
  const e2 = 1 - (b * b) / (a * a);
  const sinPhi = Math.sin(lat), cosPhi = Math.cos(lat);
  const nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  return [
    (nu + h) * cosPhi * Math.cos(lon),
    (nu + h) * cosPhi * Math.sin(lon),
    (nu * (1 - e2) + h) * sinPhi,
  ];
}

function fromCartesian([x, y, z], { a, b }) {
  const e2 = 1 - (b * b) / (a * a);
  const p = Math.sqrt(x * x + y * y);
  let phi = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 10; i++) {
    const nu = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    phi = Math.atan2(z + e2 * nu * Math.sin(phi), p);
  }
  return [phi, Math.atan2(y, x)];
}

function helmert([x, y, z]) {
  const s1 = 1 + H.s;
  return [
    H.tx + x * s1 - y * H.rz + z * H.ry,
    H.ty + x * H.rz + y * s1 - z * H.rx,
    H.tz - x * H.ry + y * H.rx + z * s1,
  ];
}

// OSGB36 lat/lon (radians) -> Transverse Mercator easting/northing
export function osgb36ToEN(phi, lambda) {
  const { a, b } = AIRY1830;
  const F0 = 0.9996012717;
  const phi0 = deg2rad(49), lambda0 = deg2rad(-2);
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;

  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi), tanPhi = Math.tan(phi);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinPhi * sinPhi, 1.5);
  const eta2 = nu / rho - 1;

  const dPhi = phi - phi0, sPhi = phi + phi0;
  const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * dPhi;
  const Mb = (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(dPhi) * Math.cos(sPhi);
  const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * dPhi) * Math.cos(2 * sPhi);
  const Md = (35 / 24) * n3 * Math.sin(3 * dPhi) * Math.cos(3 * sPhi);
  const M = b * F0 * (Ma - Mb + Mc - Md);

  const cos3 = cosPhi ** 3, cos5 = cosPhi ** 5;
  const tan2 = tanPhi ** 2, tan4 = tanPhi ** 4;

  const I = M + N0;
  const II = (nu / 2) * sinPhi * cosPhi;
  const III = (nu / 24) * sinPhi * cos3 * (5 - tan2 + 9 * eta2);
  const IIIA = (nu / 720) * sinPhi * cos5 * (61 - 58 * tan2 + tan4);
  const IV = nu * cosPhi;
  const V = (nu / 6) * cos3 * (nu / rho - tan2);
  const VI = (nu / 120) * cos5 * (5 - 18 * tan2 + tan4 + 14 * eta2 - 58 * tan2 * eta2);

  const dL = lambda - lambda0;
  const N = I + II * dL ** 2 + III * dL ** 4 + IIIA * dL ** 6;
  const E = E0 + IV * dL + V * dL ** 3 + VI * dL ** 5;
  return { easting: E, northing: N };
}

/** GPS lat/lon in decimal degrees -> { easting, northing } in metres (EPSG:27700). */
export function wgs84ToBNG(latDeg, lonDeg) {
  const cart = toCartesian(deg2rad(latDeg), deg2rad(lonDeg), 0, WGS84);
  const [phi, lambda] = fromCartesian(helmert(cart), AIRY1830);
  return osgb36ToEN(phi, lambda);
}

/** Easting/northing -> OS grid reference, e.g. "SP 12345 67890" (digits = total figures, 10 => 1 m). */
export function toGridRef(easting, northing, digits = 10) {
  const e100k = Math.floor(easting / 100000);
  const n100k = Math.floor(northing / 100000);
  if (e100k < 0 || e100k > 6 || n100k < 0 || n100k > 12) return '';

  let l1 = 19 - n100k - ((19 - n100k) % 5) + Math.floor((e100k + 10) / 5);
  let l2 = (((19 - n100k) * 5) % 25) + (e100k % 5);
  if (l1 > 7) l1++; // skip 'I'
  if (l2 > 7) l2++;
  const letters = String.fromCharCode(l1 + 65, l2 + 65);

  const half = digits / 2;
  const div = Math.pow(10, 5 - half);
  const e = String(Math.floor((easting % 100000) / div)).padStart(half, '0');
  const n = String(Math.floor((northing % 100000) / div)).padStart(half, '0');
  return `${letters} ${e} ${n}`;
}

export { rad2deg };
