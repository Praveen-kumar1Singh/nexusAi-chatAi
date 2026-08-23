/**
 * Plan and credit enforcement for a metered request.
 *
 * Lifted out of /api/chat's inline copy so the image tool meters on exactly the
 * same rules. Returns a response to send back when the caller may not proceed,
 * and null when they may -- one credit lighter if they are on the free plan.
 */

export async function chargeCredit(email: string | null): Promise<Response | null> {
  // A guest is not metered: there is no account to charge, and the guest limit
  // is enforced separately by whatever they are using.
  if (!email) return null;

  try {
    const { getDb } = await import("@/lib/mongodb");
    const db = await getDb();
    const users = db.collection("users");
    const user = await users.findOne({ email });
    if (!user) return null;

    const plan = user.plan ?? "none";
    const credits = typeof user.credits === "number" ? user.credits : 0;
    const expired =
      plan === "paid" && user.planExpiresAt && new Date(user.planExpiresAt).getTime() < Date.now();

    if (expired) {
      return Response.json(
        {
          error:
            "Your monthly Pro subscription of ₹299/month has expired. Please top up / renew your plan to continue.",
          code: "SUBSCRIPTION_EXPIRED",
        },
        { status: 402 },
      );
    }

    if (plan === "none") {
      return Response.json(
        {
          error:
            "Please activate your Free Plan (50 credits) or subscribe to Pro Monthly (₹299/month) to use this tool.",
          code: "PLAN_REQUIRED",
        },
        { status: 402 },
      );
    }

    if (plan === "free" && credits <= 0) {
      return Response.json(
        {
          error:
            "You have used all 50 free credits. Please top up by subscribing to the Pro Monthly Plan (₹299/month) to continue.",
          code: "OUT_OF_CREDITS",
        },
        { status: 402 },
      );
    }

    if (plan === "free" && credits > 0) {
      await users.updateOne({ email }, { $inc: { credits: -1 } });
    }
  } catch (err) {
    // A metering outage must not take the feature down with it -- the same
    // call in /api/chat warns and continues, and this stays consistent with it.
    console.warn("[credits] check warning:", err);
  }

  return null;
}

export interface ImageQuotaInfo {
  plan: "free" | "paid" | "none";
  maxImages: number;
  usedImages: number;
  remainingImages: number;
  canGenerate: boolean;
}

export async function getImageQuotaStatus(email: string | null): Promise<ImageQuotaInfo> {
  if (!email) {
    return {
      plan: "free",
      maxImages: 1,
      usedImages: 0,
      remainingImages: 1,
      canGenerate: true,
    };
  }

  try {
    const { getDb } = await import("@/lib/mongodb");
    const db = await getDb();
    const user = await db.collection("users").findOne({ email });

    const plan = (user?.plan as "free" | "paid" | "none") ?? "free";
    const expired =
      plan === "paid" && user?.planExpiresAt && new Date(user.planExpiresAt).getTime() < Date.now();

    const effectivePlan = expired ? "free" : plan;
    const maxImages = effectivePlan === "paid" ? 15 : 1;
    const usedImages = typeof user?.imagesGenerated === "number" ? user.imagesGenerated : 0;
    const remainingImages = Math.max(0, maxImages - usedImages);

    return {
      plan: effectivePlan,
      maxImages,
      usedImages,
      remainingImages,
      canGenerate: remainingImages > 0,
    };
  } catch {
    return {
      plan: "free",
      maxImages: 1,
      usedImages: 0,
      remainingImages: 1,
      canGenerate: true,
    };
  }
}

export async function chargeImageQuota(email: string | null): Promise<Response | null> {
  if (!email) return null;

  try {
    const { getDb } = await import("@/lib/mongodb");
    const db = await getDb();
    const users = db.collection("users");
    const user = await users.findOne({ email });

    const plan = (user?.plan as "free" | "paid" | "none") ?? "free";
    const expired =
      plan === "paid" && user?.planExpiresAt && new Date(user.planExpiresAt).getTime() < Date.now();

    if (expired) {
      return Response.json(
        {
          error:
            "Your Pro subscription (₹299/month) has expired. Please renew your plan to continue generating images.",
          code: "SUBSCRIPTION_EXPIRED",
        },
        { status: 402 }
      );
    }

    const effectivePlan = expired ? "free" : plan;
    const maxImages = effectivePlan === "paid" ? 15 : 1;
    const usedImages = typeof user?.imagesGenerated === "number" ? user.imagesGenerated : 0;

    if (usedImages >= maxImages) {
      if (effectivePlan === "free") {
        return Response.json(
          {
            error:
              "Free tier allows only 1 image generation. Please upgrade to the Pro Plan (₹299/month) to generate 15 images per month.",
            code: "FREE_IMAGE_LIMIT_REACHED",
            limitReached: true,
          },
          { status: 402 }
        );
      } else {
        return Response.json(
          {
            error:
              "Monthly limit reached (15/15 images generated). Your quota will reset on your next billing cycle.",
            code: "MONTHLY_IMAGE_LIMIT_REACHED",
            limitReached: true,
          },
          { status: 402 }
        );
      }
    }

    // Deduct credit & increment image generation count
    await users.updateOne({ email }, { $inc: { imagesGenerated: 1 } });
  } catch (err) {
    console.warn("[image-quota] check warning:", err);
  }

  return null;
}
