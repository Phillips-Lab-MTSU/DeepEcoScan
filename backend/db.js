// db.js
const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set");

  // Helps avoid "strictQuery" warnings depending on Mongoose version
  mongoose.set("strictQuery", true);

  await mongoose.connect(uri);
  console.log("Mongo connected");
}

module.exports = { connectDB };
