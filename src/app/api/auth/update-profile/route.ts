import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { currentEmail } from "@/lib/session";

const AGENT_URL = process.env.AGENT_URL || "http://127.0.0.1:8000";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    // Get email from session cookie or request body
    let userEmail: string | null = null;
    try {
      userEmail = await currentEmail();
    } catch {
      // Ignore session store down error and fall back to body.email
    }

    if (!userEmail && body?.email) {
      userEmail = String(body.email).trim().toLowerCase();
    }

    if (!userEmail) {
      return NextResponse.json(
        { error: "You must be logged in or provide an email to update your profile." },
        { status: 401 },
      );
    }

    const normalizedEmail = userEmail.trim().toLowerCase();
    const { name, avatar, avatarImage, current_password, new_password } = body || {};

    const updateFields: Record<string, any> = {};
    if (name !== undefined) updateFields.name = String(name).trim();
    if (avatar !== undefined) updateFields.avatar = String(avatar).trim();
    if (avatarImage !== undefined) updateFields.avatarImage = String(avatarImage).trim();

    // 1. Try direct MongoDB Atlas update
    try {
      const db = await getDb();
      const usersCollection = db.collection("users");

      const safeEmailRegex = new RegExp(
        `^${normalizedEmail.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}$`,
        "i",
      );

      const existingUser = await usersCollection.findOne({ email: safeEmailRegex });

      if (existingUser) {
        // Password validation if new password provided
        if (new_password && String(new_password).trim().length > 0) {
          const cleanNewPassword = String(new_password).trim();
          const cleanCurrentPassword = String(current_password || "").trim();

          if (!cleanCurrentPassword || existingUser.password_hash !== cleanCurrentPassword) {
            return NextResponse.json(
              { error: "Current password is incorrect." },
              { status: 400 },
            );
          }

          if (cleanCurrentPassword === cleanNewPassword) {
            return NextResponse.json(
              {
                error:
                  "New password cannot be the same as your current password. Please choose a different password.",
              },
              { status: 400 },
            );
          }

          const strong =
            cleanNewPassword.length >= 8 &&
            /[A-Z]/.test(cleanNewPassword) &&
            /[0-9]/.test(cleanNewPassword) &&
            /[!@#$%^&*(),.?":{}|<>]/.test(cleanNewPassword);

          if (!strong) {
            return NextResponse.json(
              {
                error:
                  "New password must be at least 8 characters long and contain an uppercase letter, a number, and a special character.",
              },
              { status: 400 },
            );
          }

          updateFields.password_hash = cleanNewPassword;
        }

        if (Object.keys(updateFields).length > 0) {
          updateFields.updatedAt = new Date().toISOString();
          await usersCollection.updateOne(
            { email: safeEmailRegex },
            { $set: updateFields },
          );
        }

        // Sync to Python backend store as well
        fetch(`${AGENT_URL}/auth/update-profile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: normalizedEmail,
            name: updateFields.name ?? existingUser.name,
            avatar: updateFields.avatar ?? existingUser.avatar,
            avatarImage: updateFields.avatarImage ?? existingUser.avatarImage,
            current_password: current_password,
            new_password: updateFields.password_hash,
          }),
        }).catch(() => null);

        console.log("[Profile] Successfully updated profile in MongoDB Atlas:", normalizedEmail);
        return NextResponse.json({
          status: "ok",
          user: {
            email: normalizedEmail,
            name: updateFields.name ?? existingUser.name ?? "",
            avatar: updateFields.avatar ?? existingUser.avatar ?? "",
            avatarImage: updateFields.avatarImage ?? existingUser.avatarImage ?? "",
          },
        });
      }
    } catch (dbErr) {
      console.warn("[Profile] Direct MongoDB update error, fallback to Python API:", dbErr);
    }

    // 2. Fallback to Python agent store
    try {
      const res = await fetch(`${AGENT_URL}/auth/update-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          name,
          avatar,
          avatarImage,
          current_password,
          new_password,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        return NextResponse.json({
          status: "ok",
          user: data?.user || {
            email: normalizedEmail,
            name: name || "",
            avatar: avatar || "",
            avatarImage: avatarImage || "",
          },
        });
      }
      return NextResponse.json(
        { error: data?.detail || data?.error || "Failed to update profile." },
        { status: res.status || 400 },
      );
    } catch (agentErr) {
      console.error("[Profile] Agent fallback check error:", agentErr);
    }

    return NextResponse.json(
      { error: "Failed to update profile. Please try again." },
      { status: 400 },
    );
  } catch (err) {
    console.error("[Profile] Unexpected update error:", err);
    return NextResponse.json(
      { error: "Failed to update profile. Please try again." },
      { status: 400 },
    );
  }
}
