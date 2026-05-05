// models/Job.js
// represents a full pipeline job (data prep + embeddings)

const mongoose = require("mongoose");

/*
this schema represents ONE embedding run
important: a job can have MANY embedding runs (re-run support)
*/
const embeddingRunSchema = new mongoose.Schema(
  {
    // unique id for this run (you generate this manually)
    runId: { type: String, required: true },

    // current state of this embedding run
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed"],
      default: "queued",
    },

    // parameters used for this run (lets you rerun with different configs)
    params: {
      model: { type: String, default: "setbert" },
      device: { type: String, default: "cpu" },
    },

    // where embedding output is stored (DO Spaces / S3)
    outputBlob: {
      kind: { type: String, default: "s3" },
      bucket: String,
      key: String,
    },

    // logs for debugging the embedding process
    logBlob: {
      kind: { type: String, default: "s3" },
      bucket: String,
      key: String,
    },

    // timestamps for tracking run lifecycle
    createdAt: { type: Date, default: Date.now },
    completedAt: Date,

    // if something fails, store error here
    errorMessage: { type: String, default: null },

    // flag for dummy/test runs (like your current cpu embedding)
    dummy: { type: Boolean, default: false },
  },
  { _id: false }
);

/*
main job schema
this represents the entire pipeline for ONE uploaded file
*/
const jobSchema = new mongoose.Schema(
  {
    // --- ownership ---
    // user who owns the job (will be used with auth)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },

    // reference to the file this job is processing
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "File",
      required: true,
    },

    // --- overall job status ---
    // tracks high-level pipeline stage
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

    /*
    --- data prep stage ---
    IMPORTANT: only ONE prep per job
    (you prep once, then reuse for multiple embedding runs)
    */
    prep: {
      // current prep status
      status: {
        type: String,
        enum: ["not_started", "running", "completed", "failed"],
        default: "not_started",
      },

      // parameters for prep script
      params: {
        minSequenceLength: { type: Number, default: 150 },
      },

      // output of prep (json summary, etc)
      outputBlob: {
        kind: { type: String, default: "s3" },
        bucket: String,
        key: String,
      },

      // cleaned fasta file generated during prep
      cleanedFastaBlob: {
        kind: { type: String, default: "s3" },
        bucket: String,
        key: String,
      },

      // logs for prep step
      logBlob: {
        kind: { type: String, default: "s3" },
        bucket: String,
        key: String,
      },

      // version of the prep script used (good for debugging changes later)
      scriptVersion: { type: String, default: "v1" },

      // when prep finished
      completedAt: Date,

      // error if prep fails
      errorMessage: { type: String, default: null },
    },

    /*
    --- embedding runs ---
    MANY per job
    this is what allows "rerun embeddings" without redoing prep
    */
    embeddingRuns: [embeddingRunSchema],

    // overall error (fallback if something breaks at job level)
    errorMessage: { type: String, default: null },

    // tracks which embedding run is currently active
    currentRunId: { type: String, default: null },
  },
  {
    // automatically adds createdAt + updatedAt
    timestamps: true,
  }
);

// export model so backend can create/find jobs
module.exports = mongoose.model("Job", jobSchema);