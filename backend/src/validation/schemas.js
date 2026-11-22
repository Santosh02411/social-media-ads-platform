import { z } from 'zod';
import { COUNTRY_CODES } from '../utils/countries.js';

/* ---------- shared building blocks ---------- */

const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

// bcrypt only uses the first 72 bytes, so longer passwords add nothing.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const optionalDate = z.preprocess(
  emptyToNull,
  z
    .string()
    .max(40)
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date')
    .nullable()
    .optional()
);

const optionalText = (max) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());

const endAfterStart = (data) => {
  if (data.scheduleStart && data.scheduleEnd) {
    return Date.parse(data.scheduleEnd) >= Date.parse(data.scheduleStart);
  }
  return true;
};

/* ---------- auth ---------- */

export const registerSchema = z.object({
  email,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100).optional(),
});

export const loginSchema = z.object({
  email,
  // No strength rules on login: older accounts may predate the current policy.
  password: z.string().min(1, 'Password is required').max(256),
});

/* ---------- campaigns ---------- */

export const CTA_VALUES = ['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'CONTACT_US', 'DOWNLOAD', 'GET_QUOTE'];
export const OBJECTIVES = ['TRAFFIC', 'AWARENESS'];

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .url('Enter a valid URL')
  .refine((u) => /^https?:\/\//i.test(u), 'URL must start with http:// or https://');

const targetingSchema = z.object({
  countries: z.array(z.enum(COUNTRY_CODES)).min(1, 'Pick at least one country').max(25).default(['US']),
  ageMin: z.number().int().min(18).max(65).default(18),
  ageMax: z.number().int().min(18).max(65).default(65),
  keywords: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
}).refine((t) => t.ageMin <= t.ageMax, { message: 'Minimum age must not exceed maximum age', path: ['ageMin'] });

const variantsSchema = z.object({
  headlines: z.array(z.string().trim().min(1).max(30)).max(15).default([]),
  descriptions: z.array(z.string().trim().min(1).max(90)).max(4).default([]),
});

const campaignFields = {
  title: z.string().trim().min(1, 'Title is required').max(150),
  description: optionalText(2000),
  budget: z.number().positive('Budget must be greater than 0').max(10_000_000),
  budgetType: z.enum(['daily', 'lifetime']),
  objective: z.enum(OBJECTIVES),
  scheduleStart: optionalDate,
  scheduleEnd: optionalDate,
  destinationUrl: httpUrl,
  headline: z.string().trim().min(1).max(40),
  adCopy: z.string().trim().min(1).max(2200),
  callToAction: z.enum(CTA_VALUES),
  targeting: targetingSchema,
  variants: variantsSchema,
  publishPaused: z.boolean(),
  mediaIds: z.array(z.string().min(1).max(64)).max(10),
};

const lifetimeNeedsEnd = (d) => d.budgetType !== 'lifetime' || Boolean(d.scheduleEnd);

export const campaignCreateSchema = z
  .object({
    ...campaignFields,
    budgetType: campaignFields.budgetType.default('daily'),
    objective: campaignFields.objective.default('TRAFFIC'),
    callToAction: campaignFields.callToAction.default('LEARN_MORE'),
    publishPaused: campaignFields.publishPaused.default(true),
    targeting: campaignFields.targeting.default({}),
    destinationUrl: campaignFields.destinationUrl.optional(),
    headline: campaignFields.headline.optional(),
    adCopy: campaignFields.adCopy.optional(),
    variants: campaignFields.variants.optional(),
    mediaIds: campaignFields.mediaIds.default([]),
    platforms: z
      .array(z.string().min(1).max(64))
      .min(1, 'Select at least one platform')
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate platforms'),
  })
  .refine(endAfterStart, { message: 'End date must be after start date', path: ['scheduleEnd'] })
  .refine(lifetimeNeedsEnd, { message: 'A lifetime budget needs an end date', path: ['scheduleEnd'] });

// Status is system-managed (publish / activate / pause), never set directly by a client.
export const campaignUpdateSchema = z
  .object(campaignFields)
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, 'Provide at least one field to update')
  .refine(endAfterStart, { message: 'End date must be after start date', path: ['scheduleEnd'] });

export const campaignDuplicateSchema = z.object({
  newTitle: z.string().trim().min(1, 'New title is required').max(150),
});

/* ---------- platforms ---------- */

export const PLATFORM_TYPES = ['facebook', 'google', 'tiktok', 'instagram'];

// Credentials are NOT accepted here; they only go through /connect.
export const platformCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  type: z.enum(PLATFORM_TYPES),
});

export const platformUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const camelCase = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// Every platform stores its ad account under `accountId`; accept the native names too
const ACCOUNT_ALIASES = { customerId: 'accountId', advertiserId: 'accountId', adAccountId: 'accountId', businessAccountId: 'instagramUserId' };

/** Accepts snake_case or camelCase keys and platform-native aliases. */
const normalizeKeys = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    const camel = camelCase(key);
    out[ACCOUNT_ALIASES[camel] || camel] = v;
  }
  return out;
};

const secret = z.string().trim().min(1, 'Required').max(2048);
const identifier = z.string().trim().min(1, 'Required').max(128);

const credentialShapes = {
  facebook: z.object({ accessToken: secret, accountId: identifier, pageId: identifier }),
  instagram: z.object({ accessToken: secret, accountId: identifier, pageId: identifier, instagramUserId: identifier }),
  google: z.object({
    refreshToken: secret,
    accountId: identifier,
    loginCustomerId: identifier.optional(),
    // Optional when the server has its own OAuth app / developer token configured
    clientId: identifier.optional(),
    clientSecret: secret.optional(),
    developerToken: secret.optional(),
  }),
  tiktok: z.object({ accessToken: secret, accountId: identifier, identityId: identifier.optional() }),
};

/** Returns a zod schema for the credential payload of a platform type. */
export function credentialSchemaFor(type) {
  const shape = credentialShapes[type];
  return shape ? z.preprocess(normalizeKeys, shape) : null;
}

export const accountSelectSchema = z.object({
  accountId: identifier,
  pageId: identifier.optional(),
  instagramUserId: identifier.optional(),
});

/* ---------- media ---------- */

export const mediaLinkSchema = z.object({
  campaignId: z.string().min(1).max(64),
  mediaType: z.enum(['image', 'video', 'text']),
  adCopy: optionalText(2200),
});

/* ---------- AI ad copy ---------- */

export const adCopySchema = z.object({
  productName: z.string().trim().min(1, 'Product name is required').max(100),
  description: z.string().trim().min(10, 'Describe the product in a sentence or two').max(1000),
  audience: z.string().trim().max(200).optional(),
  tone: z.enum(['friendly', 'professional', 'playful', 'urgent', 'luxury']).default('friendly'),
  language: z.string().trim().min(2).max(30).default('English'),
  objective: z.enum(OBJECTIVES).default('TRAFFIC'),
});
