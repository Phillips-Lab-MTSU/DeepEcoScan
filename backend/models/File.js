// models/File.js
// this model represents an uploaded file and its metadata

const mongoose = require("mongoose");

/*
this schema describes where the actual file is stored
we support multiple storage types (local, gridfs, s3)
*/
const BlobSchema = new mongoose.Schema(
  {
    // tells us what storage system is being used
    kind: { type: String, enum: ["filesystem", "gridfs", "s3"], required: true },

    // used if storing locally on disk (older method)
    path: { type: String },

    // used for s3 / digitalocean spaces
    bucket: { type: String }, // bucket name
    key: { type: String },    // object key inside the bucket

    // placeholder for future gridfs support
    fileId: { type: mongoose.Schema.Types.ObjectId },
  },
  { _id: false } // prevents mongoose from creating an _id for this subdocument
);

/*
this tracks the status of scanning/processing the file
*/
const ScanSchema = new mongoose.Schema(
  {
    // current processing state of the file
    status: {
      type: String,
      enum: ["uploaded", "processing", "complete", "failed"],
      default: "uploaded",
    },

    // number of sequences found in the file
    sequenceCount: { type: Number, default: 0 },

    // small sample of headers for preview/debugging
    sampleHeaders: [{ type: String }],

    // if something fails during processing, we store the error here
    errorMessage: { type: String, default: null },
  },
  { _id: false }
);

/*
main file schema
this stores metadata about uploaded files
*/
const FileSchema = new mongoose.Schema(
  {
    // project this file belongs to (for grouping later)
    projectId: { type: mongoose.Schema.Types.ObjectId, index: true },

    // user who uploaded the file (will be used with auth later)
    uploadedBy: { type: mongoose.Schema.Types.ObjectId },

    // display name (what user sees)
    name: { type: String, required: true },

    // original name from user upload
    originalFilename: { type: String, required: true },

    /*
    stored filename depends on storage:
    - local: actual file name on disk
    - s3: object key
    */
    storedFilename: { type: String },

    // file type based on extension
    type: {
      type: String,
      enum: ["fasta", "fastq", "fa", "fq", "other"],
      default: "other",
    },

    // reference to where the file is stored
    blob: { type: BlobSchema, required: true },

    // file size in bytes
    sizeBytes: { type: Number, required: true },

    // scan results (processing info)
    scan: { type: ScanSchema, default: () => ({}) },
  },
  {
    collection: "files", // forces collection name in mongodb
    timestamps: true,    // adds createdAt and updatedAt automatically
  }
);

/*
index to speed up queries:
- filter by project
- sort by newest first
*/
FileSchema.index({ projectId: 1, createdAt: -1 });

// export model so it can be used in backend
module.exports = mongoose.model("File", FileSchema);