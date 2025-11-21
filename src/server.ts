
import express from "express";
import bodyParser from "body-parser";
import { router } from "./routes";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use("/fs", router);

app.post("/fs/ai",async(req,res)=>{
    const {prompt} = req.body;

     if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }
const combinedPrompt = `
You are an AI that converts natural language into Virtual File System commands.

User may ask things like:
- "create a folder called src"
- "make a file named app.js"
- "write hello world into readme.md"
- "create login.ts and put code inside"
- "open app.ts"
- "delete components folder"
- "go inside src"
- "list files"

You MUST return ONLY valid JSON.

Valid actions:
- "mkdir"             → create folder
- "create_file"       → create empty file
- "write"             → overwrite an existing file with text
- "create_and_write"  → create a new file with initial text
- "open"              → open a file in the editor UI
- "delete"            → delete a file or folder
- "rename"            → rename a file or folder
- "cd"                → change directory
- "ls"                → list items

The JSON format must be:

{
  "action": "mkdir" | "create_file" | "write" | "create_and_write" | "open" | "delete" | "rename" | "ls" | "cd",
  "path": "path/to/file/or/folder",
  "content": "optional text content for writing"
}

NO explanations.
NO markdown.
NO code fences.
Return only raw JSON.

--- USER REQUEST ---
${prompt}
`;


     const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "AIzaSyCJmo7A6Fc6jc881a9MMuSG6xgur70pgxw",
  });
  const tools = [
    {
      googleSearch: {
      }
    },
  ];
  const config = {
    thinkingConfig: {
      thinkingBudget: -1,
    },
    tools,
  };
   const model = 'gemini-2.5-pro';

    const contents = [
    {
      role: 'user',
      parts: [
        {
          text: `${combinedPrompt}`,
        },
      ],
    },
  ];
let finalText = "";

  const response = await ai.models.generateContentStream({
    model,
    config,
    contents,
  });
  let fileIndex = 0;
  for await (const chunk of response) {
    if (chunk.text) finalText += chunk.text;
  }
     return res.status(200).json({
      success: true,
      output: finalText
    });

})


app.listen(5000, () => {
    console.log("File System Simulator running on port 5000");
});
