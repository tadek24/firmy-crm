/**
 * Placeholder for the CEIDG importer.
 *
 * Planned flow:
 * 1. Authenticate against the official CEIDG data source/API.
 * 2. Download records in pages/batches.
 * 3. Normalize NIP/REGON/address/PKD.
 * 4. Determine category from the main PKD.
 * 5. Upsert the registry snapshot without overwriting CRM-owned fields.
 * 6. Record progress in ImportJob so the sync can resume after interruption.
 *
 * Keep API credentials in environment variables. Never commit them to Git.
 */

console.log("CEIDG importer: not connected yet.");
