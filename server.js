import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import https from "https";
import { LRUCache } from "lru-cache";
import PQueue from "p-queue";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// ---------------------
// HTTPS certificates
// ---------------------
const options = {
  key: fs.readFileSync(path.join(process.cwd(), "cert/key.pem")),
  cert: fs.readFileSync(path.join(process.cwd(), "cert/cert.pem")),
};

// ---------------------
// GAS API config
// ---------------------
const GAS_API_URL = process.env.GAS_API_URL;
const GAS_SECRET_KEY = process.env.GAS_SECRET_KEY;

// ---------------------
// Middleware
// ---------------------
app.use(express.json());
app.use(express.static("public"));

// ---------------------
// LRU Cache
// ---------------------
const cache = new LRUCache({
  max: 1000,
  ttl: 1000 * 60 * 10, // 10 minutes
});

// ---------------------
// Queue for GAS requests
// ---------------------
const queue = new PQueue({ concurrency: 15 });

// ---------------------
// Helper to fetch certificate
// ---------------------
async function fetchCertificate(controlNumber) {
  const cached = cache.get(controlNumber);
  if (cached) return cached;

  const data = await queue.add(async () => {
    const response = await axios.get(GAS_API_URL, {
      params: { controlNumber, secret: GAS_SECRET_KEY },
      timeout: 5000,
    });

    if (!response.data || Object.keys(response.data).length === 0) {
      throw new Error("No certificate found");
    }

    return response.data;
  });

  cache.set(controlNumber, data);
  return data;
}

// ---------------------
// API endpoint
// ---------------------
app.get("/api/certificate/:controlNumber", async (req, res, next) => {
  try {
    const controlNumber = req.params.controlNumber?.trim();
    if (!controlNumber) return res.status(400).json({ error: "Control number required" });

    const certificate = await fetchCertificate(controlNumber);
    res.json(certificate);
  } catch (err) {
    console.error("GAS fetch error:", err);
    next(err); // forward to error-handling middleware
  }
});

// ---------------------
// Frontend serving
// ---------------------
app.get("/", (req, res, next) => {
  const filePath = path.join(process.cwd(), "public/index.html");
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) return res.redirect("/error.html?msg=Failed+to+load+frontend");

    const controlId = req.query.id || "";
    const injectedData = data.replace(
      "</body>",
      `<script>window.INIT_CONTROL_ID = "${controlId}";</script></body>`
    );

    res.send(injectedData);
  });
});

// ---------------------
// Catch-all for 404/405
// ---------------------
app.use((req, res) => {
  if (req.method === "GET") {
    res.status(404).sendFile(path.join(process.cwd(), "public/404.html"));
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
});

// ---------------------
// Error-handling middleware for 500
// ---------------------
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);

  if (req.accepts("html")) {
    res.status(500).sendFile(path.join(process.cwd(), "public/500.html"));
  } else {
    res.status(500).json({ error: "Unexpected server error" });
  }
});

// ---------------------
// Start HTTPS server
// ---------------------
https.createServer(options, app).listen(port, () => {
  console.log(`✅ HTTPS Server running at https://localhost:${port}`);
});
