// db.js
const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set");

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri);

  console.log("CONNECTED TO DB:", mongoose.connection.name);
}

module.exports = { connectDB };