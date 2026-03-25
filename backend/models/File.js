// models/File.js
const mongoose = require("mongoose");

const BlobSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["filesystem", "gridfs", "s3"], required: true },
    path: { type: String }, // filesystem path (legacy)
    bucket: { type: String }, // Spaces bucket
    key: { type: String },    // Spaces object key
    fileId: { type: mongoose.Schema.Types.ObjectId }, // GridFS later
  },
  { _id: false }
);

const ScanSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["uploaded", "processing", "complete", "failed"],
      default: "uploaded",
    },
    sequenceCount: { type: Number, default: 0 },
    sampleHeaders: [{ type: String }],
    errorMessage: { type: String, default: null },
  },
  { _id: false }
);

const FileSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, index: true }, // later
    uploadedBy: { type: mongoose.Schema.Types.ObjectId }, // later

    name: { type: String, required: true }, // display
    originalFilename: { type: String, required: true },

    // For filesystem uploads this was the on-disk name.
    // For Spaces uploads we set it to the object key (optional).
    storedFilename: { type: String },

    type: {
      type: String,
      enum: ["fasta", "fastq", "fa", "fq", "other"],
      default: "other",
    },

    blob: { type: BlobSchema, required: true },

    sizeBytes: { type: Number, required: true },
    scan: { type: ScanSchema, default: () => ({}) },
  },
  { collection: "files", timestamps: true }
);

// Useful indexes
FileSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model("File", FileSchema);