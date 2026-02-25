require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const crypto = require("crypto");

const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { connectDB } = require("./db");
const FileRecord = require("./models/File"); 

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
app.post("/upload", upload.single("sequenceFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded or invalid file type." });
    }

    const ext = path.extname(req.file.originalname).toLowerCase().replace(".", "");
    const type = ["fasta", "fastq", "fq", "fa"].includes(ext) ? ext : "other";

    const objectKey = makeObjectKey(req.file.originalname);

    // Upload bytes to DigitalOcean Spaces
    await s3.send(
      new PutObjectCommand({
        Bucket: DO_SPACES_BUCKET,
        Key: objectKey,
        Body: req.file.buffer,
        // ContentType is optional; most FASTA/FASTQ are text
        ContentType: "text/plain",
      })
    );

    // Write mapping doc to MongoDB
    const doc = await FileRecord.create({
      name: req.file.originalname,
      originalFilename: req.file.originalname,
      storedFilename: objectKey, // keep field, but now it's the objectKey
      type,
      blob: {
        kind: "s3",
        bucket: DO_SPACES_BUCKET,
        key: objectKey,
      },
      sizeBytes: req.file.size,
    });

    return res.status(200).json({
      message: "File uploaded successfully",
      fileId: doc._id,
      bucket: DO_SPACES_BUCKET,
      key: objectKey,
      sizeBytes: req.file.size,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: err.message || "Upload failed" });
  }
});

// List files (Mongo mapping only)
app.get("/files", async (req, res) => {
  try {
    const files = await FileRecord.find({})
      .sort({ createdAt: -1 })
      .select("_id name originalFilename storedFilename sizeBytes createdAt type blob");

    res.status(200).json({ files });
  } catch (err) {
    console.error("Files error:", err);
    res.status(500).json({ error: "Error reading files from DB" });
  }
});

// Download (returns a presigned URL to Spaces)
app.get("/files/:id/download", async (req, res) => {
  try {
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

/* ===========================
   Start Server After DB
=========================== */

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Mongo connection failed:", err.message);
    process.exit(1);
  });