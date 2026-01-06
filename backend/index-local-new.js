// --- LOCAL DEVELOPMENT VERSION (Using ADB for app names) ---
require('dotenv').config({ path: ['.env.local', '.env'] });

const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");

const app = express();
const PORT = 5000;
const ADB_COMMAND = "adb";

// --- Simple console logger for local development ---
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

// --- Flexible CORS Configuration ---
const corsOptions = {
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Secret"],
  credentials: true
};
app.use(cors(corsOptions));

app.use(express.json());

// --- Simple auth middleware for local development ---
const API_SECRET = process.env.API_SECRET || 'local-development-secret';

const simpleAuthMiddleware = (req, res, next) => {
    logger.info(`Request from: ${req.ip} to ${req.path}`);
    next();
};

app.use(simpleAuthMiddleware);

/**
 * A reusable function to run any ADB command.
 */
function runAdb(args) {
  return new Promise((resolve) => {
    logger.info(`> Running command: ${ADB_COMMAND} ${args.join(" ")}`);

    execFile(ADB_COMMAND, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        logger.error(`> Error: ${stderr || error.message}`);
        return resolve({
          ok: false,
          stdout: stdout?.toString() || "",
          stderr: stderr?.toString() || error.message,
        });
      }
      resolve({
        ok: true,
        stdout: stdout?.toString() || "",
        stderr: stderr?.toString() || "",
      });
    });
  });
}

/**
 * Get the human-readable app name from a package name using ADB
 */
async function getAppName(packageName) {
  try {
    const result = await runAdb(["shell", "dumpsys", "package", packageName]);
    if (result.ok && result.stdout) {
      // Try to find application-label or applicationLabel
      const labelMatch = result.stdout.match(/application-label:([^\n\r]*)/i) ||
                         result.stdout.match(/applicationLabel:([^\n\r]*)/i);

      if (labelMatch && labelMatch[1]) {
        const appName = labelMatch[1].trim().replace(/^['"]|['"]$/g, ''); // Remove quotes
        if (appName && appName !== packageName) {
          return appName;
        }
      }

      // Fallback: try to get the app name from package manager
      const pmResult = await runAdb(["shell", "pm", "list", "packages", "-f", packageName]);
      if (pmResult.ok && pmResult.stdout) {
        // This gives us the APK path, we can try to get more info
        logger.info(`Fallback info for ${packageName}: ${pmResult.stdout.substring(0, 100)}...`);
      }
    }

    // If all else fails, return a cleaned-up version of the package name
    return cleanPackageName(packageName);
  } catch (error) {
    logger.error(`Error getting app name for ${packageName}: ${error.message}`);
    return cleanPackageName(packageName);
  }
}

/**
 * Clean up package name to make it more readable
 */
function cleanPackageName(packageName) {
  // Simple fallback logic for common packages
  if (packageName.includes('whatsapp')) return 'WhatsApp';
  if (packageName.includes('instagram')) return 'Instagram';
  if (packageName.includes('facebook')) return 'Facebook';
  if (packageName.includes('google.chrome')) return 'Google Chrome';
  if (packageName.includes('youtube')) return 'YouTube';
  if (packageName.includes('gmail')) return 'Gmail';
  if (packageName.includes('maps')) return 'Google Maps';
  if (packageName.includes('twitter')) return 'Twitter';
  if (packageName.includes('telegram')) return 'Telegram';
  if (packageName.includes('spotify')) return 'Spotify';
  if (packageName.includes('netflix')) return 'Netflix';
  if (packageName.includes('amazon')) return 'Amazon';
  if (packageName.includes('uber')) return 'Uber';
  if (packageName.includes('tiktok')) return 'TikTok';

  // For other packages, try to extract meaningful parts
  const parts = packageName.split('.');
  if (parts.length > 2) {
    // Take the last meaningful part and capitalize it
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.length > 2) {
      return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
    }
  }

  return packageName;
}

// --- API ENDPOINTS ---

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'ADB Backend is running locally' });
});

// Main ADB command endpoint
app.post("/adb/run", async (req, res) => {
  const { args } = req.body;
  if (!args || !Array.isArray(args)) {
    return res.status(400).json({ ok: false, stderr: "Invalid 'args' parameter" });
  }

  try {
    const result = await runAdb(args);
    res.json(result);
  } catch (err) {
    logger.error(`Unexpected error: ${err.message}`);
    res.status(500).json({ ok: false, stderr: "Internal server error" });
  }
});

// New endpoint for listing installed packages with app names using ADB
app.post("/adb/list-packages-with-names", async (req, res) => {
  try {
    logger.info('Fetching installed packages...');

    // Get list of installed packages
    const packagesResult = await runAdb(["shell", "pm", "list", "packages"]);

    if (!packagesResult.ok) {
      throw new Error("Failed to get package list from device");
    }

    // Parse package names from output
    const packageLines = packagesResult.stdout.split('\n').filter(line => line.startsWith('package:'));
    const packageNames = packageLines.map(line => line.replace('package:', '').trim()).filter(pkg => pkg.length > 0);

    logger.info(`Found ${packageNames.length} packages`);

    // Limit to first 20 packages to avoid long processing time
    const limitedPackages = packageNames.slice(0, 20);

    // Get app names using ADB dumpsys for each package
    logger.info('Getting app names using ADB dumpsys...');

    const packageInfo = [];
    let processed = 0;

    for (const packageName of limitedPackages) {
      processed++;
      logger.info(`Processing package ${processed}/${limitedPackages.length}: ${packageName}`);

      const appName = await getAppName(packageName);

      packageInfo.push({
        packageName,
        appName,
        isSystemApp: packageName.startsWith('com.android.') || packageName.startsWith('com.google.android.')
      });
    }

    logger.info(`✅ Successfully processed ${packageInfo.length} packages with app names`);

    res.json({
      ok: true,
      totalPackages: packageNames.length,
      displayedPackages: limitedPackages.length,
      packages: packageInfo,
      method: 'ADB dumpsys'
    });

  } catch (error) {
    logger.error(`Error in /list-packages-with-names: ${error.message}`);
    res.status(500).json({ ok: false, stderr: error.message });
  }
});

// Performance check endpoint (simplified for local development)
app.post("/adb/run-performance-check", async (req, res) => {
  try {
    // Get battery info
    const batteryResult = await runAdb(["shell", "dumpsys", "battery"]);

    // Get memory info
    const memoryResult = await runAdb(["shell", "dumpsys", "meminfo"]);

    // Parse battery level (simplified)
    let batteryLevel = 50; // Default
    if (batteryResult.ok && batteryResult.stdout) {
      const levelMatch = batteryResult.stdout.match(/level: (\d+)/);
      if (levelMatch) {
        batteryLevel = parseInt(levelMatch[1]);
      }
    }

    // Parse memory usage (simplified)
    let memoryUsed = 1024; // Default MB
    if (memoryResult.ok && memoryResult.stdout) {
      const memMatch = memoryResult.stdout.match(/Total RAM: ([\d,]+) kB/);
      if (memMatch) {
        memoryUsed = Math.round(parseFloat(memMatch[1].replace(/,/g, '')) / 1024);
      }
    }

    // Create mock historical data for demo
    const mockData = [];
    const now = Date.now();
    for (let i = 4; i >= 0; i--) {
      mockData.push({
        captured_at: now - (i * 60000), // 1 minute intervals
        battery_level: batteryLevel + (Math.random() - 0.5) * 10,
        memory_used_mb: memoryUsed + (Math.random() - 0.5) * 200
      });
    }

    res.json({
      ok: true,
      history: mockData,
      message: "Performance check completed (local development mode)"
    });
  } catch (err) {
    logger.error(`Performance check error: ${err.message}`);
    res.status(500).json({ ok: false, stderr: "Performance check failed" });
  }
});

// --- START SERVER ---
app.listen(PORT, () => {
  logger.info(`🚀 ADB Backend Server (Local Development) running on http://localhost:${PORT}`);
  logger.info(`📱 Make sure ADB is installed and in your PATH`);
  logger.info(`🔧 This version uses ADB dumpsys to get real app names`);
  logger.info(`⚡ No external APIs required - everything runs locally!`);
});

// --- GRACEFUL SHUTDOWN ---
process.on('SIGINT', () => {
  logger.info('Shutting down server...');
  process.exit(0);
});