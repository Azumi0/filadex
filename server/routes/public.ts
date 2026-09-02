import type { Express } from "express";
import { authenticate } from "../auth";
import { storage } from "../storage";
import { logger as appLogger } from "../utils/logger";
import { validateId } from "../utils/validation";

export function registerPublicRoutes(app: Express): void {
  // Get public filaments for a specific user by ID
  app.get("/api/public/filaments/:userId", async (req, res) => {
    try {
      const userId = validateId(req.params.userId);
      if (userId === null) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      // Get user information
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Get user's sharing settings
      const sharingSettings = await storage.getPublicUserSharing(userId);

      // Check if user has any public filaments
      if (sharingSettings.length === 0) {
        return res.status(404).json({ message: "No public filaments found" });
      }

      // Check if user has global sharing enabled
      const hasGlobalSharing = sharingSettings.some((s) => s.materialId === null);

      // Get all filaments for this user
      const filaments = await storage.getFilaments(userId);

      let publicFilaments = filaments;
      if (!hasGlobalSharing) {
        // userSharing.materialId is a FK into the materials catalog table,
        // while filament.material is the material's name (e.g. "PETG") -
        // resolve the shared ids to names before comparing.
        const sharedMaterialIds = sharingSettings
          .filter((s) => s.materialId !== null)
          .map((s) => s.materialId as number);

        const sharedMaterials = await storage.getMaterialsByIds(sharedMaterialIds);
        // Compared case-insensitively: a filament's material is free text, so a
        // spool entered as "petg" must still be covered by sharing the
        // catalog's "PETG" - otherwise the owner gets an empty public page
        // with no indication their share matched nothing.
        const sharedMaterialNames = new Set(sharedMaterials.map((m) => m.name.toLowerCase()));

        publicFilaments = filaments.filter((filament) => sharedMaterialNames.has(filament.material.toLowerCase()));
      }

      // Return filaments with user information
      res.json({
        filaments: publicFilaments,
        user: {
          id: user.id,
          username: user.username
        }
      });
    } catch (error) {
      appLogger.error("Get public filaments error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // User sharing routes
  app.post("/api/sharing", authenticate, async (req, res) => {
    try {
      const { materialId, isPublic } = req.body;

      const { sharing, created } = await storage.upsertUserSharing(
        req.userId,
        materialId || null,
        isPublic,
      );

      res.status(created ? 201 : 200).json(sharing);
    } catch (error) {
      appLogger.error("Error updating sharing:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.get("/api/sharing", authenticate, async (req, res) => {
    try {
      res.json(await storage.getUserSharing(req.userId));
    } catch (error) {
      appLogger.error("Error fetching sharing:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
}

