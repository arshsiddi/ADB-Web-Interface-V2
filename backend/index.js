// --- NEW: Make sure this is at the very top ---
require('dotenv').config();

const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const winston = require('winston');
const WinstonCloudWatch = require('winston-cloudwatch');
const { Pool } = require('pg'); // --- NEW: Import the PostgreSQL driver ---

const app = express();
const PORT = 5000;
const ADB_COMMAND = "adb";

// --- Winston Logger with CloudWatch (graceful fallback) ---
const transports = [new winston.transports.Console()];

// Try to add CloudWatch transport, but handle missing credentials gracefully
try {
  const cloudWatchTransport = new WinstonCloudWatch({
    logGroupName: 'AdbWebAppLogs',
    logStreamName: `WebServer-${Date.now()}`,
    awsRegion: 'ap-south-1',
    jsonMessage: true
  });
  transports.push(cloudWatchTransport);
  console.log('[INFO] CloudWatch logging enabled');
} catch (error) {
  console.log('[WARN] CloudWatch logging disabled (missing AWS credentials) - using console only');
}

const logger = winston.createLogger({ transports });

// --- NEW: RDS Database Connection Pool (optional for local development) ---
let pool = null;
if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD) {
  try {
    pool = new Pool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
      ssl: {
        rejectUnauthorized: false
      }
    });
    logger.info('Database connection pool initialized');
  } catch (error) {
    logger.warn('Database connection failed - running without database features');
    pool = null;
  }
} else {
  logger.info('Database credentials not provided - running without database features');
}

// --- Flexible CORS Configuration ---
const corsOptions = {
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Secret"],
  credentials: true
};
app.use(cors(corsOptions));

app.use(express.json());

// --- MODIFIED Secret Header Middleware ---
const API_SECRET = process.env.API_SECRET;

if (!API_SECRET) {
    logger.error("FATAL ERROR: API_SECRET environment variable is not set.");
    process.exit(1);
}

const flexibleAuthMiddleware = (req, res, next) => {
    const isFromApiGateway = req.headers['x-amzn-apigateway-api-id'];
    if (isFromApiGateway) {
        const receivedSecret = req.headers['x-api-secret'];
        if (receivedSecret && receivedSecret === API_SECRET) {
            next();
        } else {
            logger.warn(`Forbidden attempt from API Gateway without valid secret. IP: ${req.ip}`);
            res.status(403).json({ ok: false, stderr: 'Forbidden: Invalid Secret' });
        }
    } else {
        // For direct calls, we'll need user authentication later
        // For now, this allows direct access for development
        next();
    }
};

app.use(flexibleAuthMiddleware);

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

// --- NEW: Helper functions for parsing performance metrics ---

/**
 * Parses the output of 'adb shell dumpsys battery' to get the level.
 * @param {string} output The raw output from the command.
 * @returns {number | null} The battery level, or null if not found.
 */
const parseBattery = (output) => {
  const match = output.match(/\s*level:\s*(\d+)/);
  return match ? parseInt(match[1], 10) : null;
};

/**
 * Parses the output of 'adb shell dumpsys meminfo' to get used memory in MB.
 * @param {string} output The raw output from the command.
 * @returns {number | null} The used memory in megabytes, or null if not found.
 */
const parseMemory = (output) => {
  const totalRamMatch = output.match(/Total RAM:\s*([\d,]+)\s*kB/);
  const freeRamMatch = output.match(/Free RAM:\s*([\d,]+)\s*kB/);

  if (totalRamMatch && freeRamMatch) {
    const totalKb = parseInt(totalRamMatch[1].replace(/,/g, ''), 10);
    const freeKb = parseInt(freeRamMatch[1].replace(/,/g, ''), 10);
    const usedKb = totalKb - freeKb;
    return Math.round(usedKb / 1024);
  }
  return null;
};


// --- API Routes ---
// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "ADB Backend Server is running", timestamp: new Date().toISOString() });
});

app.post("/adb/run", async (req, res) => {
  const { args } = req.body;

  if (!Array.isArray(args) || args.length === 0) {
    logger.warn("Request received with no args/cmd provided.");
    return res.status(400).json({ ok: false, stderr: "No command arguments provided." });
  }

  const result = await runAdb(args);
  res.status(result.ok ? 200 : 500).json(result);
});

// --- NEW: Performance Analysis Route ---
app.post("/adb/run-performance-check", async (req, res) => {
  try {
    // 1. Get device serial number
    const serialResult = await runAdb(['shell', 'getprop', 'ro.serialno']);
    if (!serialResult.ok || !serialResult.stdout) {
      throw new Error("Could not get device serial number. Is a device connected?");
    }
    const deviceSerial = serialResult.stdout.trim();
    logger.info(`Analyzing device: ${deviceSerial}`);

    // 2. Run metric commands
    const [batteryResult, memoryResult] = await Promise.all([
      runAdb(['shell', 'dumpsys', 'battery']),
      runAdb(['shell', 'dumpsys', 'meminfo']),
    ]);

    if (!batteryResult.ok || !memoryResult.ok) {
        throw new Error('Failed to run one or more ADB metric commands.');
    }

    // 3. Parse output
    const batteryLevel = parseBattery(batteryResult.stdout);
    const memoryUsedMb = parseMemory(memoryResult.stdout);
    if (batteryLevel === null || memoryUsedMb === null) {
        throw new Error("Failed to parse all required performance metrics from command output.");
    }
    logger.info(`Parsed Metrics: Battery=${batteryLevel}%, Memory=${memoryUsedMb}MB`);

    // 4. Handle database operations (if available)
    let historyData = [];
    if (pool) {
      try {
        const dbClient = await pool.connect();
        // Save to database
        const insertQuery = `
          INSERT INTO performance_snapshots (user_id, device_serial, battery_level, memory_used_mb)
          VALUES ($1, $2, $3, $4)
        `;
        await dbClient.query(insertQuery, ['local-user', deviceSerial, batteryLevel, memoryUsedMb]);

        // Fetch historical data
        const selectQuery = `
          SELECT battery_level, memory_used_mb, captured_at
          FROM performance_snapshots
          WHERE device_serial = $1
          ORDER BY captured_at ASC;
        `;
        const historyResult = await dbClient.query(selectQuery, [deviceSerial]);
        historyData = historyResult.rows;
        dbClient.release();
        logger.info(`Database operations successful. Found ${historyData.length} historical records.`);
      } catch (dbError) {
        logger.warn(`Database operation failed: ${dbError.message}`);
        // Fallback to mock data
        historyData = generateMockHistoryData(batteryLevel, memoryUsedMb);
      }
    } else {
      // No database - generate mock historical data for demo
      logger.info('No database available - generating mock historical data');
      historyData = generateMockHistoryData(batteryLevel, memoryUsedMb);
    }

    // 5. Send response
    res.json({
      ok: true,
      history: historyData,
      current: { battery_level: batteryLevel, memory_used_mb: memoryUsedMb }
    });

  } catch (error) {
    logger.error(`Error in /run-performance-check: ${error.message}`);
    res.status(500).json({ ok: false, stderr: error.message });
  }
});

// Helper function to generate mock historical data
function generateMockHistoryData(currentBattery, currentMemory) {
  const mockData = [];
  const now = Date.now();
  for (let i = 4; i >= 0; i--) {
    mockData.push({
      captured_at: new Date(now - (i * 60000)), // 1 minute intervals
      battery_level: Math.max(0, Math.min(100, currentBattery + (Math.random() - 0.5) * 20)),
      memory_used_mb: Math.max(100, currentMemory + (Math.random() - 0.5) * 500)
    });
  }
  return mockData;
}


// --- Server Startup ---
app.listen(PORT, () => {
  logger.info(`✅ ADB backend server is running on http://localhost:${PORT}`);
  logger.info("Waiting for commands from the frontend...");
});