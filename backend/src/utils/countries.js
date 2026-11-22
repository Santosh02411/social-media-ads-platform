/**
 * Countries the platform supports for targeting. `numeric` is the ISO 3166-1
 * numeric code: Google Ads geo-target ids are 2000 + numeric (US = 2840).
 * `tiktok` is TikTok's location id (GeoNames id of the country).
 */
export const COUNTRIES = {
  US: { name: 'United States', numeric: 840, tiktok: 6252001 },
  CA: { name: 'Canada', numeric: 124, tiktok: 6251999 },
  GB: { name: 'United Kingdom', numeric: 826, tiktok: 2635167 },
  IN: { name: 'India', numeric: 356, tiktok: 1269750 },
  AU: { name: 'Australia', numeric: 36, tiktok: 2077456 },
  DE: { name: 'Germany', numeric: 276, tiktok: 2921044 },
  FR: { name: 'France', numeric: 250, tiktok: 3017382 },
  ES: { name: 'Spain', numeric: 724, tiktok: 2510769 },
  IT: { name: 'Italy', numeric: 380, tiktok: 3175395 },
  NL: { name: 'Netherlands', numeric: 528, tiktok: 2750405 },
  SE: { name: 'Sweden', numeric: 752, tiktok: 2661886 },
  BR: { name: 'Brazil', numeric: 76, tiktok: 3469034 },
  MX: { name: 'Mexico', numeric: 484, tiktok: 3996063 },
  JP: { name: 'Japan', numeric: 392, tiktok: 1861060 },
  KR: { name: 'South Korea', numeric: 410, tiktok: 1835841 },
  ID: { name: 'Indonesia', numeric: 360, tiktok: 1643084 },
  PH: { name: 'Philippines', numeric: 608, tiktok: 1694008 },
  TH: { name: 'Thailand', numeric: 764, tiktok: 1605651 },
  VN: { name: 'Vietnam', numeric: 704, tiktok: 1562822 },
  SG: { name: 'Singapore', numeric: 702, tiktok: 1880251 },
  AE: { name: 'United Arab Emirates', numeric: 784, tiktok: 290557 },
  SA: { name: 'Saudi Arabia', numeric: 682, tiktok: 102358 },
  ZA: { name: 'South Africa', numeric: 710, tiktok: 953987 },
  NG: { name: 'Nigeria', numeric: 566, tiktok: 2328926 },
  TR: { name: 'Turkey', numeric: 792, tiktok: 298795 },
};

export const COUNTRY_CODES = Object.keys(COUNTRIES);
export const googleGeoTarget = (code) => `geoTargetConstants/${2000 + COUNTRIES[code].numeric}`;
export const tiktokLocationId = (code) => String(COUNTRIES[code].tiktok);
