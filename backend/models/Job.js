// models/Job.js
const mongoose = require("mongoose");

const embeddingRunSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true },

    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed"],
      default: "queued",
    },

    params: {
      model: { type: String, default: "setbert" },
      device: { type: String, default: "cpu" },
    },

    outputBlob: {
      kind: { type: String, default: "s3" },
      bucket: String,
      key: String,
    },

    logBlob: {
      kind: { type: String, default: "s3" },
      bucket: String,
      key: String,
    },

    createdAt: { type: Date, default: Date.now },
    completedAt: Date,
  },
  { _id: false }
);

const jobSchema = new mongoose.Schema(
  {
    // --- Ownership ---
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "File",
      required: true,
    },

    // --- Overall Status ---
    status: {
      type: String,
      enum: [
        "queued",
        "prep_running",
        "prep_done",
        "embed_running",
        "completed",
        "failed",
      ],
      default: "queued",
    },

    // --- Data Prep (ONE per job) ---
    prep: {
      status: {
        type: String,
        enum: ["not_started", "running", "completed", "failed"],
        default: "not_started",
      },

      params: {
        minSequenceLength: { type: Number, default: 150 },
      },

      outputBlob: {
        kind: { type: String, default: "s3" },
        bucket: String,
        key: String,
      },

      logBlob: {
        kind: { type: String, default: "s3" },
        bucket: String,
        key: String,
      },

      scriptVersion: { type: String, default: "v1" },

      completedAt: Date,
    },

    // --- Embedding Runs (MANY per job) ---
    embeddingRuns: [embeddingRunSchema],
  },
  {
    timestamps: true, // adds createdAt + updatedAt automatically
  }
);

module.exports = mongoose.model("Job", jobSchema);