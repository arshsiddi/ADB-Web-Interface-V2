// --- LOCAL DEVELOPMENT VERSION (No AWS dependencies) ---
require('dotenv').config({ path: ['.env.local', '.env'] });

const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = 5000;
const ADB_COMMAND = "adb";

// --- Database Setup ---
const DB_PATH = path.join(__dirname, 'performance_metrics.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[DB] Error opening database:', err.message);
  } else {
    console.log('[DB] Connected to SQLite database at:', DB_PATH);
  }
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS performance_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      battery_level INTEGER,
      memory_used_mb INTEGER,
      cpu_usage INTEGER,
      device_info TEXT,
      session_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('[DB] Error creating table:', err.message);
    } else {
      console.log('[DB] Performance metrics table ready');
    }
  });
});

// Generate session ID for grouping metrics
let currentSessionId = Date.now().toString();

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
    // For local development, we'll skip authentication
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

// --- Database Helper Functions ---

/**
 * Save performance metrics to database
 */
function savePerformanceMetric(data) {
  return new Promise((resolve, reject) => {
    const query = `
      INSERT INTO performance_metrics
      (timestamp, battery_level, memory_used_mb, cpu_usage, device_info, session_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.run(query, [
      data.timestamp,
      data.battery_level,
      data.memory_used_mb,
      data.cpu_usage,
      data.device_info || 'Unknown Device',
      data.session_id || currentSessionId
    ], function(err) {
      if (err) {
        logger.error(`[DB] Error saving performance metric: ${err.message}`);
        reject(err);
      } else {
        logger.info(`[DB] Saved performance metric with ID: ${this.lastID}`);
        resolve(this.lastID);
      }
    });
  });
}

/**
 * Get performance history from database
 */
function getPerformanceHistory(limit = 50, sessionId = null) {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT timestamp, battery_level, memory_used_mb, cpu_usage, session_id, created_at
      FROM performance_metrics
    `;
    let params = [];

    if (sessionId) {
      query += ` WHERE session_id = ?`;
      params.push(sessionId);
    }

    query += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    db.all(query, params, (err, rows) => {
      if (err) {
        logger.error(`[DB] Error fetching performance history: ${err.message}`);
        reject(err);
      } else {
        // Convert rows to format expected by frontend (with captured_at)
        const formattedRows = rows.map(row => ({
          captured_at: row.timestamp,
          battery_level: row.battery_level,
          memory_used_mb: row.memory_used_mb,
          cpu_usage: row.cpu_usage,
          session_id: row.session_id
        }));
        resolve(formattedRows.reverse()); // Show oldest first for chart
      }
    });
  });
}

/**
 * Clear all performance data
 */
function clearPerformanceData() {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM performance_metrics`, function(err) {
      if (err) {
        logger.error(`[DB] Error clearing performance data: ${err.message}`);
        reject(err);
      } else {
        logger.info(`[DB] Cleared ${this.changes} performance records`);
        resolve(this.changes);
      }
    });
  });
}

/**
 * Start a new monitoring session
 */
function startNewSession() {
  currentSessionId = Date.now().toString();
  logger.info(`[DB] Started new monitoring session: ${currentSessionId}`);
  return currentSessionId;
}

/**
 * Get app name from package name using ADB shell commands
 */
async function getAppName(packageName) {
  try {
    // Method 1: Try to get app label using pm command
    const pmResult = await runAdb(["shell", "pm", "list", "packages", "-f", packageName]);
    if (pmResult.ok && pmResult.stdout.includes(packageName)) {
      // Get the APK path
      const pathMatch = pmResult.stdout.match(/package:(.+)=(.+)/);
      if (pathMatch) {
        const apkPath = pathMatch[1];

        // Try to extract app name using strings command on the APK
        const stringsResult = await runAdb(["shell", "strings", apkPath, "|", "grep", "-i", "app.*name\\|label"]);
        if (stringsResult.ok && stringsResult.stdout.trim()) {
          const appName = stringsResult.stdout.split('\n')[0].trim();
          if (appName && appName !== packageName && !appName.includes('package:')) {
            logger.info(`Found app name for ${packageName}: ${appName}`);
            return appName;
          }
        }
      }
    }

    // Method 2: Try using dumpsys with better parsing
    const dumpsysResult = await runAdb(["shell", "dumpsys", "package", packageName]);
    if (dumpsysResult.ok) {
      // Look for various label patterns
      const patterns = [
        /label="([^"]+)"/,
        /application-label:\s*(.+)/,
        /nonLocalizedLabel=(.+)/,
        /labelRes=0x[0-9a-f]+\s+\((.+)\)/
      ];

      for (const pattern of patterns) {
        const match = dumpsysResult.stdout.match(pattern);
        if (match && match[1] && match[1].trim() !== 'null') {
          const appName = match[1].trim();
          logger.info(`Found app name for ${packageName}: ${appName}`);
          return appName;
        }
      }
    }

    // Method 3: Use a simple name mapping for common apps


    if (appNameMap[packageName]) {
      logger.info(`Found app name (mapped) for ${packageName}: ${appNameMap[packageName]}`);
      return appNameMap[packageName];
    }

    // Method 4: Generate a readable name from package name
    const nameParts = packageName.split('.');
    let readableName;

    // Try to find the most meaningful part of the package name
    if (nameParts.length >= 3) {
      // For packages like com.company.appname, use the last part
      const lastPart = nameParts[nameParts.length - 1];
      const secondLastPart = nameParts[nameParts.length - 2];

      // Skip generic words like 'app', 'android', 'mobile'
      const genericWords = ['app', 'android', 'mobile', 'main', 'client', 'user'];
      if (!genericWords.includes(lastPart.toLowerCase()) && lastPart.length > 2) {
        readableName = lastPart;
      } else if (!genericWords.includes(secondLastPart.toLowerCase()) && secondLastPart.length > 2) {
        readableName = secondLastPart;
      } else {
        readableName = lastPart;
      }
    } else {
      readableName = nameParts[nameParts.length - 1];
    }

    // Format the name nicely
    readableName = readableName
      .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space before capital letters
      .replace(/^./, str => str.toUpperCase()) // Capitalize first letter
      .replace(/([0-9]+)/g, ' $1') // Add space before numbers
      .trim();

    logger.info(`Generated readable name for ${packageName}: ${readableName}`);
    return readableName;

  } catch (error) {
    logger.error(`Error getting app name for ${packageName}: ${error.message}`);
    // Fallback to readable package name
    const nameParts = packageName.split('.');
    const lastPart = nameParts[nameParts.length - 1];
    return lastPart.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, str => str.toUpperCase());
  }
}

/**
 * Get app names for multiple packages in batches
 */
async function getAppNames(packageNames) {
  if (!packageNames || packageNames.length === 0) {
    return {};
  }

  const appNames = {};
  const batchSize = 3; // Process in small batches to avoid overwhelming the device

  logger.info(`Getting app names for ${packageNames.length} packages in batches of ${batchSize}`);

  for (let i = 0; i < packageNames.length; i += batchSize) {
    const batch = packageNames.slice(i, i + batchSize);
    logger.info(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(packageNames.length/batchSize)}`);

    // Process batch in parallel
    const batchPromises = batch.map(async (packageName) => {
      const appName = await getAppName(packageName);
      return { packageName, appName };
    });

    const batchResults = await Promise.all(batchPromises);

    // Add results to the main object
    batchResults.forEach(({ packageName, appName }) => {
      appNames[packageName] = appName;
    });

    // Small delay between batches to be gentle on the device
    if (i + batchSize < packageNames.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  logger.info(`Successfully retrieved ${Object.keys(appNames).length} app names`);
  return appNames;
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
    logger.error(`Error in /adb/run: ${err.message}`);
    res.status(500).json({ ok: false, stderr: err.message });
  }
});

// List installed packages with app names
app.post("/adb/list-packages", async (req, res) => {
  try {
    logger.info("Listing installed packages...");

    // Get list of packages
    const packagesResult = await runAdb(["shell", "pm", "list", "packages", "-3"]);
    if (!packagesResult.ok) {
      return res.status(500).json({
        ok: false,
        stderr: "Failed to list packages: " + packagesResult.stderr
      });
    }

    // Parse package names
    const packageLines = packagesResult.stdout.split('\n').filter(line => line.trim());
    const packageNames = packageLines
      .map(line => line.replace('package:', '').trim())
      .filter(name => name);

    logger.info(`Found ${packageNames.length} installed packages`);

    // Get app names for packages
    const appNames = await getAppNames(packageNames);

    // Create result with both package names and app names
    const packagesWithNames = packageNames.map(packageName => ({
      packageName,
      appName: appNames[packageName] || packageName
    }));

    res.json({
      ok: true,
      packages: packagesWithNames,
      count: packagesWithNames.length
    });

  } catch (err) {
    logger.error(`Error in /adb/list-packages: ${err.message}`);
    res.status(500).json({ ok: false, stderr: err.message });
  }
});

// Get app name for a specific package
app.post("/adb/get-app-name", async (req, res) => {
  const { packageName } = req.body;

  if (!packageName) {
    return res.status(400).json({ ok: false, stderr: "Package name is required" });
  }

  try {
    const appName = await getAppName(packageName);
    res.json({
      ok: true,
      packageName,
      appName
    });
  } catch (err) {
    logger.error(`Error getting app name for ${packageName}: ${err.message}`);
    res.status(500).json({ ok: false, stderr: err.message });
  }
});

// Performance analysis endpoint with database integration
app.post("/adb/run-performance-check", async (req, res) => {
  try {
    logger.info("Running performance analysis...");

    // Get battery status
    const batteryResult = await runAdb(["shell", "dumpsys", "battery"]);

    // Get CPU usage
    const cpuResult = await runAdb(["shell", "dumpsys", "cpuinfo"]);

    // Get memory usage
    const memResult = await runAdb(["shell", "dumpsys", "meminfo"]);

    // Parse battery level
    let batteryLevel = 50; // Default fallback value
    if (batteryResult.ok) {
      const batteryMatch = batteryResult.stdout.match(/level:\s*(\d+)/);
      if (batteryMatch) {
        batteryLevel = parseInt(batteryMatch[1]);
      }
    }

    // Parse memory usage (simplified)
    let memoryUsage = 512; // Default fallback in MB
    if (memResult.ok) {
      const memMatch = memResult.stdout.match(/Total RAM:\s*([\d,]+)\s*kB/);
      const availMatch = memResult.stdout.match(/Available RAM:\s*([\d,]+)\s*kB/);
      if (memMatch && availMatch) {
        const total = parseInt(memMatch[1].replace(/,/g, ''));
        const available = parseInt(availMatch[1].replace(/,/g, ''));
        memoryUsage = Math.round(((total - available) / total) * 100);
      }
    }

    // Generate current timestamp
    const now = Date.now();
    const cpuUsage = Math.floor(Math.random() * 30) + 10; // Placeholder CPU usage

    // Create performance data point
    const currentData = {
      timestamp: now,
      battery_level: batteryLevel,
      memory_used_mb: memoryUsage,
      cpu_usage: cpuUsage
    };

    // Save current data to database
    try {
      await savePerformanceMetric(currentData);
    } catch (dbErr) {
      logger.warn(`Failed to save to database: ${dbErr.message}`);
    }

    // Get historical data from database
    let historyData = [];
    try {
      historyData = await getPerformanceHistory(20, currentSessionId);
    } catch (dbErr) {
      logger.warn(`Failed to fetch history from database: ${dbErr.message}`);
      // Fallback to current data only
      historyData = [{
        captured_at: now,
        battery_level: batteryLevel,
        memory_used_mb: memoryUsage,
        cpu_usage: cpuUsage
      }];
    }

    // Return current data and historical data
    res.json({
      ok: true,
      current: {
        captured_at: now,
        battery_level: batteryLevel,
        memory_used_mb: memoryUsage,
        cpu_usage: cpuUsage
      },
      history: historyData,
      session_id: currentSessionId,
      total_records: historyData.length
    });

  } catch (err) {
    logger.error(`Error in performance analysis: ${err.message}`);
    res.status(500).json({ ok: false, stderr: err.message });
  }
});

// Start fresh monitoring session (clears old data)
app.post("/adb/start-fresh-monitoring", async (req, res) => {
  try {
    logger.info("Starting fresh monitoring session...");

    // Clear old data
    const deletedCount = await clearPerformanceData();

    // Start new session
    const newSessionId = startNewSession();

    res.json({
      ok: true,
      message: `Started fresh monitoring session. Cleared ${deletedCount} old records.`,
      session_id: newSessionId
    });

  } catch (err) {
    logger.error(`Error starting fresh monitoring: ${err.message}`);
    res.status(500).json({ ok: false, stderr: err.message });
  }
});

// Get performance history
app.get("/adb/performance-history", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const sessionId = req.query.session_id || null;

    logger.info(`Fetching performance history (limit: ${limit}, session: ${sessionId || 'all'})`);

    const history = await getPerformanceHistory(limit, sessionId);

    res.json({
      ok: true,
      history: history,
      count: history.length,
      session_id: sessionId || 'all'
    });

  } catch (err) {
    logger.error(`Error fetching performance history: ${err.message}`);
    res.status(500).json({ ok: false, stderr: err.message });
  }
});

// Clear all performance data
app.delete("/adb/clear-performance-data", async (req, res) => {
  try {
    logger.info("Clearing all performance data...");

    const deletedCount = await clearPerformanceData();

    res.json({
      ok: true,
      message: `Cleared ${deletedCount} performance records.`,
      deleted_count: deletedCount
    });

  } catch (err) {
    logger.error(`Error clearing performance data: ${err.message}`);
    res.status(500).json({ ok: false, stderr: err.message });
  }
});

// Get current session info
app.get("/adb/session-info", (req, res) => {
  res.json({
    ok: true,
    current_session_id: currentSessionId,
    session_started: new Date(parseInt(currentSessionId)).toISOString()
  });
});

// Start the server
app.listen(PORT, () => {
  logger.info(`🚀 ADB Backend Server running on http://localhost:${PORT}`);
  logger.info('Available endpoints:');
  logger.info('  GET  /health - Health check');
  logger.info('  POST /adb/run - Execute ADB command');
  logger.info('  POST /adb/list-packages - List installed packages with app names');
  logger.info('  POST /adb/get-app-name - Get app name for specific package');
  logger.info('  POST /adb/run-performance-check - Run device performance analysis');
  logger.info('  POST /adb/start-fresh-monitoring - Start fresh monitoring session');
  logger.info('  GET  /adb/performance-history - Get performance history');
  logger.info('  DELETE /adb/clear-performance-data - Clear all performance data');
  logger.info('  GET  /adb/session-info - Get current session information');
});
