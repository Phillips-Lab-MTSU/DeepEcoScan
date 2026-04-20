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
    errorMessage: { type: String, default: null },
    dummy: { type: Boolean, default: false },
  },
  { _id: false }
);

const jobSchema = new mongoose.Schema(
  {
    // --- Ownership ---
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
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
      
      cleanedFastaBlob: {
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
      errorMessage: { type: String, default: null },
    },

    // --- Embedding Runs (MANY per job) ---
        embeddingRuns: [embeddingRunSchema],

        errorMessage: { type: String, default: null },
        currentRunId: { type: String, default: null },
  },
  {
    timestamps: true, // adds createdAt + updatedAt automatically
  }
);

module.exports = mongoose.model("Job", jobSchema);