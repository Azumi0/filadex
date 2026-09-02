import { sql } from "drizzle-orm";
import type { LegacyDatabase } from "./types";

// This used to try to import server/utils/logger and fall back to the console
// if that failed. Legacy migrations may not import from server/, so the console
// is all there is.
const logger = {
  info: console.log,
  error: console.error,
  warn: console.warn,
  debug: console.log
};

export async function runMigration(db: LegacyDatabase): Promise<void> {
  try {
    logger.info('Starting migration: Adding user_id column to filaments table');

    // Check if the column already exists
    const checkColumnQuery = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'filaments'
      AND column_name = 'user_id';
    `;

    const { rows } = await db.execute(sql.raw(checkColumnQuery));
    
    // Add user_id column if it doesn't exist
    if (rows.length === 0) {
      logger.info('Adding user_id column to filaments table');
      
      // First, check if the users table exists and has records
      const checkUsersQuery = `
        SELECT COUNT(*) as count FROM users;
      `;
      
      try {
        const usersResult = await db.execute(sql.raw(checkUsersQuery));
        const userCount = parseInt(usersResult.rows[0].count as string);
        
        // Add the user_id column
        await db.execute(sql`
          ALTER TABLE filaments
          ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
        `);
        
        // If there are users and filaments, assign all existing filaments to the first user (admin)
        if (userCount > 0) {
          const checkFilamentsQuery = `
            SELECT COUNT(*) as count FROM filaments;
          `;
          
          const filamentsResult = await db.execute(sql.raw(checkFilamentsQuery));
          const filamentCount = parseInt(filamentsResult.rows[0].count as string);
          
          if (filamentCount > 0) {
            logger.info(`Found ${filamentCount} existing filaments, assigning them to the first user`);
            
            // Get the first user (usually admin)
            const firstUserQuery = `
              SELECT id FROM users ORDER BY id LIMIT 1;
            `;
            
            const firstUserResult = await db.execute(sql.raw(firstUserQuery));
            
            if (firstUserResult.rows.length > 0) {
              const firstUserId = firstUserResult.rows[0].id as number;
              
              // Update all existing filaments to belong to the first user
              await db.execute(sql`
                UPDATE filaments SET user_id = ${firstUserId};
              `);
              
              logger.info(`Successfully assigned all filaments to user ID ${firstUserId}`);
            }
          }
        }
      } catch (error) {
        logger.error('Error checking users table or updating filaments:', error);
        // Continue with the migration even if this part fails
      }
    } else {
      logger.info('user_id column already exists in filaments table');
    }

    logger.info('Migration completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  }
}

