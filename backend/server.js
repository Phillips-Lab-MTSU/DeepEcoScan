const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const crypto = require("crypto");

// for helper functions leveraged in job running
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const { spawn } = require("child_process");

const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { connectDB } = require("./db");
const FileRecord = require("./models/File"); 
const Job = require("./models/Job");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());


/* ===========================
   DigitalOcean Spaces (S3)
=========================== */

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const DO_SPACES_ENDPOINT = requireEnv("DO_SPACES_ENDPOINT"); // e.g. https://nyc3.digitaloceanspaces.com
const DO_SPACES_BUCKET = requireEnv("DO_SPACES_BUCKET");
const DO_SPACES_KEY = requireEnv("DO_SPACES_KEY");
const DO_SPACES_SECRET = requireEnv("DO_SPACES_SECRET");

// AWS SDK v3 wants a region even with a custom endpoint
const DO_SPACES_REGION = process.env.DO_SPACES_REGION || "us-east-1";

const s3 = new S3Client({
  region: DO_SPACES_REGION,
  endpoint: DO_SPACES_ENDPOINT,
  forcePathStyle: false,
  credentials: {
  accessKeyId: DO_SPACES_KEY,
  secretAccessKey: DO_SPACES_SECRET,
  },
});

function safeFilename(name) {
  // keep it simple: strip weird chars, keep dots/dashes/underscores
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function makeObjectKey(originalName) {
  const rand = crypto.randomBytes(8).toString("hex");
  const base = safeFilename(path.basename(originalName));
  return `${Date.now()}-${rand}-${base}`;
}

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

  return {
    kind: "s3",
    bucket: DO_SPACES_BUCKET,
    key,
  };
}

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

async function processJob(jobId, fileDoc, originalBuffer) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error("Job not found");

  const workDir = path.join(os.tmpdir(), `deepecoscan-job-${jobId}`);
  const inputDir = path.join(workDir, "input");
  const prepDir = path.join(workDir, "prep");
  const embedDir = path.join(workDir, "embeddings");

  await fsp.mkdir(inputDir, { recursive: true });
  await fsp.mkdir(prepDir, { recursive: true });
  await fsp.mkdir(embedDir, { recursive: true });

  const inputPath = path.join(inputDir, safeFilename(fileDoc.originalFilename));
  await fsp.writeFile(inputPath, originalBuffer);

  try {
    // -------------------------
    // 1. DATA PREP
    // -------------------------
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

    const prepResultPath = path.join(prepDir, "prep_result.json");
    const cleanedFastaPath = path.join(prepDir, "sequences.fasta.cleaned");
    const prepLogPath = path.join(prepDir, "prep.log");

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

    await fsp.writeFile(prepLogPath, `${prepResult.stdout}\n${prepResult.stderr}`, "utf8");

    const prepOutputBlob = await uploadFileToSpaces(
      prepResultPath,
      `jobs/${jobId}/prep/prep_result.json`,
      "application/json"
    );
    
    const cleanedFastaBlob = await uploadFileToSpaces(
      cleanedFastaPath,
      `jobs/${jobId}/prep/sequences.fasta.cleaned`,
      "text/plain"
    );

    const prepLogBlob = await uploadFileToSpaces(
      prepLogPath,
      `jobs/${jobId}/prep/prep.log`,
      "text/plain"
    );

    await Job.findByIdAndUpdate(jobId, {
      status: "prep_done",
      "prep.status": "completed",
      "prep.outputBlob": prepOutputBlob,
      "prep.cleanedFastaBlob": cleanedFastaBlob,
      "prep.logBlob": prepLogBlob,
      "prep.completedAt": new Date(),
    });

    // -------------------------
    // 2. EMBEDDING RUN (DUMMY CPU)
    // -------------------------
    const runId = `run-${Date.now()}`;

    await Job.findByIdAndUpdate(jobId, {
      status: "embed_running",
      currentRunId: runId,
      $push: {
        embeddingRuns: {
          runId,
          status: "running",
          params: {
            model: "setbert",
            device: "cpu",
          },
          dummy: true,
          createdAt: new Date(),
        },
      },
    });

    const embedOutputPath = path.join(embedDir, "embedding_output.json");
    const embedLogPath = path.join(embedDir, "embed.log");
    const embedResultPath = path.join(embedDir, "result.json");

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

    const embedOutputBlob = await uploadFileToSpaces(
      embedOutputPath,
      `jobs/${jobId}/embeddings/${runId}/embedding_output.json`,
      "application/json"
    );

    const embedLogBlob = await uploadFileToSpaces(
      embedLogPath,
      `jobs/${jobId}/embeddings/${runId}/embed.log`,
      "text/plain"
    );

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
          "embeddingRuns.$.dummy": true,
        },
      }
    );

    await FileRecord.findByIdAndUpdate(fileDoc._id, {
      "scan.status": "complete",
    });
  } catch (err) {
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
   Multer Setup (memory)
=========================== */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // adjust if you expect bigger files
    fileSize: 1024 * 1024 * 250, // 250 MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [".fasta", ".fastq", ".fq", ".fa"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) cb(null, true);
    else cb(new Error("Only FASTA and FASTQ files are allowed"), false);
  },
});

/* ===========================
   Routes
=========================== */

// Upload file -> Spaces blob, Mongo mapping
app.post("/api/upload", upload.single("sequenceFile"), async (req, res) => {
  try {
    /*
    const user = getAuthUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    
    */
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded or invalid file type." });
    }

    const ext = path.extname(req.file.originalname).toLowerCase().replace(".", "");
    const type = ["fasta", "fastq", "fq", "fa"].includes(ext) ? ext : "other";

    const objectKey = makeObjectKey(req.file.originalname);

    // Upload raw bytes to DigitalOcean Spaces
    await s3.send(
      new PutObjectCommand({
        Bucket: DO_SPACES_BUCKET,
        Key: objectKey,
        Body: req.file.buffer,
        ContentType: "text/plain",
      })
    );

    // Basic FASTA parsing
    let sequenceCount = 0;
    let sampleHeaders = [];

    if (["fasta", "fa"].includes(type)) {
      const text = req.file.buffer.toString("utf8");
      const lines = text.split(/\r?\n/);

      for (const line of lines) {
        if (line.startsWith(">")) {
          sequenceCount++;
          if (sampleHeaders.length < 5) {
            sampleHeaders.push(line.substring(1).trim());
          }
        }
      }
    }
    
    /*
    const doc = await FileRecord.create({
      owner: user, // <--- Link to Traefik user
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
     */
    const doc = await FileRecord.create({
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
      scan: {
        status: "uploaded",
        sequenceCount,
        sampleHeaders,
      },
    });

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

    processJob(job._id, doc, req.file.buffer).catch((err) => {
      console.error(`Pipeline failed for job ${job._id}:`, err.message);
    });

    return res.status(202).json({
      message: "File uploaded successfully. Pipeline started.",
      file: doc,
      jobId: job._id,
    });

  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: err.message || "Upload failed" });
  }
});

// List files (Mongo mapping only)
app.get("/api/files", async (req, res) => {
  try {
    // const user = getAuthUser(req);
    // if (!user) return res.status(401).json({ error: "Unauthorized" });
    const files = await FileRecord.find({})
      .sort({ createdAt: -1 })
      .select("_id name originalFilename storedFilename sizeBytes createdAt type blob scan");

    res.status(200).json({ files });
  } catch (err) {
    console.error("Files error:", err);
    res.status(500).json({ error: "Error reading files from DB" });
  }
});

// Download (returns a presigned URL to Spaces)
app.get("/api/files/:id/download", async (req, res) => {
  try {
    // const user = getAuthUser(req);
    // if (!user) return res.status(401).json({ error: "Unauthorized" });
    const doc = await FileRecord.findById(req.params.id).select("blob originalFilename");
    if (!doc) return res.status(404).json({ error: "File not found" });

    if (!doc.blob || doc.blob.kind !== "s3" || !doc.blob.bucket || !doc.blob.key) {
      return res.status(400).json({ error: "File blob mapping is not S3/Spaces" });
    }

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: doc.blob.bucket,
        Key: doc.blob.key,
        ResponseContentDisposition: `attachment; filename="${safeFilename(
          doc.originalFilename || "download"
        )}"`,
      }),
      { expiresIn: 60 * 5 } // 5 minutes
    );

    return res.status(200).json({ url });
  } catch (err) {
    console.error("Download error:", err);
    return res.status(500).json({ error: err.message || "Download failed" });
  }
});

app.get("/api/jobs/:id", async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).lean();
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    return res.status(200).json({ job });
  } catch (err) {
    console.error("Job fetch error:", err);
    return res.status(500).json({ error: "Failed to fetch job" });
  }
});

/* ===========================
   Start Server After DB
=========================== */

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Mongo connection failed:", err.message);
    process.exit(1);
  });