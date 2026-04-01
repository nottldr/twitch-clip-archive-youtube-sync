import { google } from "googleapis";

import { createLogger } from "#server/logger.js";
import type { AuthManager } from "#server/youtube/auth.js";

const logger = createLogger("quota-discovery");

/**
 * Discover the actual YouTube Data API v3 daily quota limit from the
 * Service Usage API. Requires the cloud-platform.read-only scope.
 *
 * Returns the limit in quota units, or null if discovery fails.
 */
/**
 * Return the raw quota metrics response from the Service Usage API for debugging.
 */
export async function getRawQuotaMetrics(
  authManager: AuthManager,
  googleProjectNumber: string,
): Promise<unknown> {
  const auth = await authManager.getOAuth2Client();
  if (!auth) return { error: "Not authenticated" };

  const serviceUsage = google.serviceusage({ version: "v1beta1", auth });
  const response = await serviceUsage.services.consumerQuotaMetrics.list({
    parent: `projects/${googleProjectNumber}/services/youtube.googleapis.com`,
  });

  return response.data;
}

export async function discoverQuotaLimit(
  authManager: AuthManager,
  googleProjectNumber: string,
): Promise<number | null> {
  try {
    const auth = await authManager.getOAuth2Client();
    if (!auth) {
      logger.warn("Not authenticated, skipping quota discovery");
      return null;
    }

    const serviceUsage = google.serviceusage({ version: "v1beta1", auth });

    const response = await serviceUsage.services.consumerQuotaMetrics.list({
      parent: `projects/${googleProjectNumber}/services/youtube.googleapis.com`,
    });

    const metrics = response.data.metrics;
    if (!metrics) {
      logger.warn("No quota metrics returned");
      return null;
    }

    // Find the daily per-project quota limit (unit: "1/d/{project}")
    for (const metric of metrics) {
      if (!metric.consumerQuotaLimits) continue;

      for (const limit of metric.consumerQuotaLimits) {
        if (!limit.quotaBuckets) continue;
        if (limit.unit !== "1/d/{project}") continue;

        for (const bucket of limit.quotaBuckets) {
          const effectiveLimit = bucket.effectiveLimit;
          if (effectiveLimit && Number(effectiveLimit) > 0) {
            const limitValue = Number(effectiveLimit);
            logger.info({ limit: limitValue, unit: limit.unit }, "Discovered daily quota limit");
            return limitValue;
          }
        }
      }
    }

    logger.warn("Could not find a usable quota limit in metrics response");
    return null;
  } catch (error) {
    logger.warn({ error }, "Quota discovery failed, using config fallback");
    return null;
  }
}
