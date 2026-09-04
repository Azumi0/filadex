import type { Express } from "express";
import { storage } from "../storage";
import { logger as appLogger } from "../utils/logger";
import { validateId } from "../utils/validation";
import { isOneOfMaterials } from "../utils/materials";

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
        const isShared = isOneOfMaterials(sharedMaterials.map((m) => m.name));

        publicFilaments = filaments.filter((filament) => isShared(filament.material));
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
}

