import type { Express } from "express";
import { updateThemeSchema } from "@shared/schema";
import { authenticate } from "../auth";
import { storage } from "../storage";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { logger as appLogger } from "../utils/logger";

/**
 * Per-user theme preferences (accent color, light/dark appearance). Used to
 * be a single global theme.json file that any visitor could read/write and
 * every user shared - see migrations/add_user_theme_preferences.ts.
 */
export function registerThemeRoutes(app: Express): void {
  app.get("/api/theme", authenticate, async (req, res) => {
    try {
      const theme = await storage.getUserTheme(req.userId);

      if (!theme) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json(theme);
    } catch (error) {
      appLogger.error("Error fetching theme:", error);
      res.status(500).json({ message: "Failed to read theme" });
    }
  });

  app.post("/api/theme", authenticate, async (req, res) => {
    try {
      const data = updateThemeSchema.parse(req.body);

      await storage.updateUserTheme(req.userId, {
        ...data,
        radius: data.radius?.toString(),
      });

      res.json({ message: "Theme updated successfully" });
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      appLogger.error("Error updating theme:", error);
      res.status(500).json({ message: "Failed to update theme" });
    }
  });
}
