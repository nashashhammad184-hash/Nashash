import "dotenv/config";
import express from "express";
import router from "./routes/index";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use("/api", router);

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(port, () => {
  console.log(`API Server running on port ${port}`);
});
