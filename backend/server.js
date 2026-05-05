// server.js (main backend entry point)
// handles api routes, file uploads, pipeline execution, and storage

const path = require("path");

// load env variables from .env file
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const crypto = require("crypto");

// node + system helpers
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const { spawn } = require("child_process");

// aws sdk (used for digitalocean spaces which is s3 compatible)
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// db + models
const { connectDB } = require("./db");
const FileRecord = require("./models/File"); 
const Job = require("./models/Job");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

function getForwardedUser(req) {
  return req.headers['x-forwarded-user'];
}

app.get("/api/auth/status", (req, res) => {
  const user = getForwardedUser(req);

  if (user) {
    return res.json({ authenticated: true, user });
  }

  return res.status(401).json({ authenticated: false, error: "Not logged in" });
});

app.get("/api/me", (req, res) => {
  const user = getForwardedUser(req);

  if (user) {
    return res.json({ user });
  }

  // Keep this for compatibility with older callers.
  return res.status(401).json({ error: "Not logged in" });
});

/* ===========================
   digitalocean spaces setup
=========================== */

// helper to make sure env vars exist
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// load required env vars
const DO_SPACES_ENDPOINT = requireEnv("DO_SPACES_ENDPOINT");
const DO_SPACES_BUCKET = requireEnv("DO_SPACES_BUCKET");
const DO_SPACES_KEY = requireEnv("DO_SPACES_KEY");
const DO_SPACES_SECRET = requireEnv("DO_SPACES_SECRET");

// region required even though spaces is custom endpoint
const DO_SPACES_REGION = process.env.DO_SPACES_REGION || "us-east-1";

// create s3 client
const s3 = new S3Client({
  region: DO_SPACES_REGION,
  endpoint: DO_SPACES_ENDPOINT,
  forcePathStyle: false,
  credentials: {
    accessKeyId: DO_SPACES_KEY,
    secretAccessKey: DO_SPACES_SECRET,
  },
});


/* ===========================
   helper functions
=========================== */

// cleans filename so no weird characters break things
function safeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// creates unique object key for s3 upload
function makeObjectKey(originalName) {
  const rand = crypto.randomBytes(8).toString("hex");
  const base = safeFilename(path.basename(originalName));
  return `${Date.now()}-${rand}-${base}`;
}

// uploads a local file to spaces
async function uploadFileToSpaces(localPath, key, contentType = "application/octet-stream") {
  const body = await fsp.readFile(localPath);

  await s3.send(
    new PutObjectCommand({
      Bucket: DO_SPACES_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  // return metadata to store in db
  return {
    kind: "s3",
    bucket: DO_SPACES_BUCKET,
    key,
  };
}

// runs a python script and captures output
function runPython(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [scriptPath, ...args], {
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `Python exited with code ${code}`));
      }
    });
  });
}


/* ===========================
   main pipeline (job runner)
=========================== */

// runs full pipeline: data prep -> embedding
async function processJob(jobId, fileDoc, originalBuffer) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error("Job not found");

  // create temp working directories
  const workDir = path.join(os.tmpdir(), `deepecoscan-job-${jobId}`);
  const inputDir = path.join(workDir, "input");
  const prepDir = path.join(workDir, "prep");
  const embedDir = path.join(workDir, "embeddings");

  await fsp.mkdir(inputDir, { recursive: true });
  await fsp.mkdir(prepDir, { recursive: true });
  await fsp.mkdir(embedDir, { recursive: true });

  // write uploaded file to temp input
  const inputPath = path.join(inputDir, safeFilename(fileDoc.originalFilename));
  await fsp.writeFile(inputPath, originalBuffer);

  try {
    // -------------------------
    // 1. data prep stage
    // -------------------------

    // update job + file status
    await Job.findByIdAndUpdate(jobId, {
      status: "prep_running",
      "prep.status": "running",
      "prep.errorMessage": null,
      errorMessage: null,
    });

    await FileRecord.findByIdAndUpdate(fileDoc._id, {
      "scan.status": "processing",
      "scan.errorMessage": null,
    });

    // file paths
    const prepResultPath = path.join(prepDir, "prep_result.json");
    const cleanedFastaPath = path.join(prepDir, "sequences.fasta.cleaned");
    const prepLogPath = path.join(prepDir, "prep.log");

    // run python prep script
    const PREP_SCRIPT = process.env.PREP_SCRIPT || "/app/python/data_prep.py";

    const prepResult = await runPython(PREP_SCRIPT, [
      "--input",
      inputPath,
      "--outdir",
      prepDir,
      "--min-length",
      "150",
      "--force",
    ]);

    // save logs
    await fsp.writeFile(prepLogPath, `${prepResult.stdout}\n${prepResult.stderr}`, "utf8");

    // upload outputs to spaces
    const prepOutputBlob = await uploadFileToSpaces(prepResultPath, `jobs/${jobId}/prep/prep_result.json`, "application/json");
    const cleanedFastaBlob = await uploadFileToSpaces(cleanedFastaPath, `jobs/${jobId}/prep/sequences.fasta.cleaned`, "text/plain");
    const prepLogBlob = await uploadFileToSpaces(prepLogPath, `jobs/${jobId}/prep/prep.log`, "text/plain");

    // update job after prep
    await Job.findByIdAndUpdate(jobId, {
      status: "prep_done",
      "prep.status": "completed",
      "prep.outputBlob": prepOutputBlob,
      "prep.cleanedFastaBlob": cleanedFastaBlob,
      "prep.logBlob": prepLogBlob,
      "prep.completedAt": new Date(),
    });

    // -------------------------
    // 2. embedding stage
    // -------------------------

    const runId = `run-${Date.now()}`;

    // mark embedding as running
    await Job.findByIdAndUpdate(jobId, {
      status: "embed_running",
      currentRunId: runId,
      $push: {
        embeddingRuns: {
          runId,
          status: "running",
          params: { model: "setbert", device: "cpu" },
          dummy: true,
          createdAt: new Date(),
        },
      },
    });

    // file paths
    const embedOutputPath = path.join(embedDir, "embedding_output.json");
    const embedLogPath = path.join(embedDir, "embed.log");

    // run embedding script
    const EMBED_SCRIPT = process.env.EMBED_SCRIPT || "/app/python/embed_setbert.py";

    const embedResult = await runPython(EMBED_SCRIPT, [
      "--prep-dir",
      prepDir,
      "--outdir",
      embedDir,
      "--device",
      "cpu",
      "--dummy",
      "--force",
    ]);

    await fsp.writeFile(embedLogPath, `${embedResult.stdout}\n${embedResult.stderr}`, "utf8");

    // upload embedding results
    const embedOutputBlob = await uploadFileToSpaces(embedOutputPath, `jobs/${jobId}/embeddings/${runId}/embedding_output.json`, "application/json");
    const embedLogBlob = await uploadFileToSpaces(embedLogPath, `jobs/${jobId}/embeddings/${runId}/embed.log`, "text/plain");

    // mark job complete
    await Job.findOneAndUpdate(
      { _id: jobId, "embeddingRuns.runId": runId },
      {
        status: "completed",
        currentRunId: runId,
        $set: {
          "embeddingRuns.$.status": "completed",
          "embeddingRuns.$.outputBlob": embedOutputBlob,
          "embeddingRuns.$.logBlob": embedLogBlob,
          "embeddingRuns.$.completedAt": new Date(),
        },
      }
    );

    // update file status
    await FileRecord.findByIdAndUpdate(fileDoc._id, {
      "scan.status": "complete",
    });

  } catch (err) {
    // error handling for entire pipeline

    const activeJob = await Job.findById(jobId);
    const runId = activeJob?.currentRunId;

    await Job.findByIdAndUpdate(jobId, {
      status: "failed",
      errorMessage: err.message,
      "prep.errorMessage": err.message,
    });

    if (runId) {
      await Job.findOneAndUpdate(
        { _id: jobId, "embeddingRuns.runId": runId },
        {
          $set: {
            "embeddingRuns.$.status": "failed",
            "embeddingRuns.$.errorMessage": err.message,
          },
        }
      );
    }

    await FileRecord.findByIdAndUpdate(fileDoc._id, {
      "scan.status": "failed",
      "scan.errorMessage": err.message,
    });

    throw err;
  }
}

/* ===========================
   multer setup (file uploads)
=========================== */

// configure multer to store files in memory (not disk)
const upload = multer({
  storage: multer.memoryStorage(),

  // limit file size (250mb max)
  limits: {
    fileSize: 1024 * 1024 * 250,
  },

  // only allow specific file types
  fileFilter: (req, file, cb) => {
    const allowedTypes = [".fasta", ".fastq", ".fq", ".fa"];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(ext)) cb(null, true);
    else cb(new Error("Only FASTA and FASTQ files are allowed"), false);
  },
});


/* ===========================
   routes (api endpoints)
=========================== */

// upload file -> stores in spaces + creates job
app.post("/api/upload", upload.single("sequenceFile"), async (req, res) => {
  try {
    // make sure file exists
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded or invalid file type."
      });
    }

    // detect file type from extension
    const ext = path.extname(req.file.originalname).toLowerCase().replace(".", "");
    const type = ["fasta", "fastq", "fq", "fa"].includes(ext) ? ext : "other";

    // create unique key for spaces
    const objectKey = makeObjectKey(req.file.originalname);

    // upload raw file buffer to spaces
    await s3.send(
      new PutObjectCommand({
        Bucket: DO_SPACES_BUCKET,
        Key: objectKey,
        Body: req.file.buffer,
        ContentType: "text/plain",
      })
    );

    // basic fasta scan (counts sequences + sample headers)
    let sequenceCount = 0;
    let sampleHeaders = [];

    if (["fasta", "fa"].includes(type)) {
      const text = req.file.buffer.toString("utf8");
      const lines = text.split(/\r?\n/);

      for (const line of lines) {
        if (line.startsWith(">")) {
          sequenceCount++;

          // store first few headers for preview
          if (sampleHeaders.length < 5) {
            sampleHeaders.push(line.substring(1).trim());
          }
        }
      }
    }
    
    
    const doc = await FileRecord.create({
      //owner: user, // <--- Link to Traefik user
      name: req.file.originalname,
      originalFilename: req.file.originalname,
      storedFilename: objectKey,
      type,
      blob: {
        kind: "s3",
        bucket: DO_SPACES_BUCKET,
        key: objectKey,
      },
      sizeBytes: req.file.size,
      scan: { status: "uploaded", sequenceCount, sampleHeaders },
    });
     
    // const doc = await FileRecord.create({
    //   name: req.file.originalname,
    //   originalFilename: req.file.originalname,
    //   storedFilename: objectKey,
    //   type,
    //   blob: {
    //     kind: "s3",
    //     bucket: DO_SPACES_BUCKET,
    //     key: objectKey,
    //   },
    //   sizeBytes: req.file.size,
    //   scan: {
    //     status: "uploaded",
    //     sequenceCount,
    //     sampleHeaders,
    //   },
    // });

    // create job tied to this file
    const job = await Job.create({
      fileId: doc._id,
      status: "queued",

      prep: {
        status: "not_started",
        params: {
          minSequenceLength: 150,
        },
        scriptVersion: "v1",
      },

      embeddingRuns: [],
    });

    // start pipeline async (do not block request)
    processJob(job._id, doc, req.file.buffer).catch((err) => {
      console.error(`Pipeline failed for job ${job._id}:`, err.message);
    });

    // return response immediately
    return res.status(202).json({
      message: "File uploaded successfully. Pipeline started.",
      file: doc,
      jobId: job._id,
    });

  } catch (err) {
    console.error("Upload error:", err);

    return res.status(500).json({
      error: err.message || "Upload failed"
    });
  }
});


// get all files (used by frontend dashboard)
app.get("/api/files", async (req, res) => {
  try {
    const files = await FileRecord.find({})
      .sort({ createdAt: -1 }) // newest first
      .select("_id name originalFilename storedFilename sizeBytes createdAt type blob scan");

    res.status(200).json({ files });

  } catch (err) {
    console.error("Files error:", err);

    res.status(500).json({
      error: "Error reading files from DB"
    });
  }
});


// generate download link (presigned url)
app.get("/api/files/:id/download", async (req, res) => {
  try {
    const doc = await FileRecord.findById(req.params.id)
      .select("blob originalFilename");

    if (!doc) {
      return res.status(404).json({ error: "File not found" });
    }

    // validate blob is s3
    if (!doc.blob || doc.blob.kind !== "s3") {
      return res.status(400).json({
        error: "File blob mapping is not S3/Spaces"
      });
    }

    // create temporary signed url (5 minutes)
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: doc.blob.bucket,
        Key: doc.blob.key,

        // forces download with original filename
        ResponseContentDisposition: `attachment; filename="${safeFilename(
          doc.originalFilename || "download"
        )}"`,
      }),
      { expiresIn: 60 * 5 }
    );

    return res.status(200).json({ url });

  } catch (err) {
    console.error("Download error:", err);

    return res.status(500).json({
      error: err.message || "Download failed"
    });
  }
});


// get job status (used for polling in frontend)
app.get("/api/jobs/:id", async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).lean();

    if (!job) {
      return res.status(404).json({
        error: "Job not found"
      });
    }

    return res.status(200).json({ job });

  } catch (err) {
    console.error("Job fetch error:", err);

    return res.status(500).json({
      error: "Failed to fetch job"
    });
  }
});


/* ===========================
   Start Server
=========================== */

async function startServer() {
  try {
    await connectDB();
  } catch (err) {
    console.error("Mongo connection failed:", err.message);
    console.warn("Starting API anyway so auth checks and static routes stay available.");
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();