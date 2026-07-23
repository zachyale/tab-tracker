import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Must run before any src module is imported: env.ts reads these at load time.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tab-tracker-test-"));
process.env.BETTER_AUTH_SECRET = "test-secret-not-for-production";
process.env.BASE_URL = "http://localhost";
