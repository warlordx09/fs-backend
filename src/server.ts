// src/server.ts
import express from "express";
import bodyParser from "body-parser";
import { router } from "./routes";
import cors from "cors";


const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use("/fs", router);

app.listen(5000, () => {
    console.log("File System Simulator running on port 3000");
});
