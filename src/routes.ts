import { Router } from "express";
import { VFSManager, FileSystem } from "./filesystem";

export const router = Router();
const vfs = new VFSManager();

router.get("/disk-usage", (req, res) => {
  const { path } = req.query;
  try {
    const { fs } = vfs.resolve(String(path));
    const totalBytes = fs.totalBlocks * fs.blockSize;
    const usedBytes = fs.blocks.reduce((sum, b) => sum + (b ? b.length : 0), 0);
    const freeBytes = totalBytes - usedBytes;
    res.json({ totalBytes, usedBytes, freeBytes });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
router.post("/file", (req, res) => {
    const { path, content, permissions } = req.body;
    vfs.createFile(path, content, { mode: permissions });
    res.json({ success: true });
});

// Read file
router.get("/file", (req, res) => {
    const { path } = req.query;
    const data = vfs.readFile(String(path));
    res.json({ content: data });
});

// Write file
router.put("/file", (req, res) => {
    const { path, content } = req.body;
    vfs.writeFile(path, content);
    res.json({ success: true });
});

// Delete file/folder
router.delete("/node", (req, res) => {
    const { path } = req.body;
    vfs.delete(path);
    res.json({ success: true });
});

// Create directory
router.post("/directory", (req, res) => {
    console.log("received!!")
    const { path, permissions } = req.body;
    vfs.createDirectory(path, { mode: permissions });
    res.json({ success: true });
});

// List directory
router.get("/directory", (req, res) => {
    const { path } = req.query;
    const result = vfs.listDirectory(String(path));
    res.json(result);
});

// Rename (move with new name)
router.put("/rename", (req, res) => {
    const { path, newName } = req.body;

    const newPath =
        path.replace(/\/[^\/]+$/, "") + "/" + newName;

    vfs.move(path, newPath);
    res.json({ success: true });
});

// Move
router.put("/move", (req, res) => {
    const { oldPath, newPath } = req.body;
    vfs.move(oldPath, newPath);
    res.json({ success: true });
});

// Copy
// router.post("/copy", (req, res) => {
//     const { source, destination } = req.body;
//     vfs.copy(source, destination);
//     res.json({ success: true });
// });

// Paste (copy or move)
router.post("/paste", (req, res) => {
  const { sourcePath, destinationPath, action } = req.body;
  // action: "copy" or "move"

  try {
    if (action === "copy") {
      vfs.copy(sourcePath, destinationPath);
    } else if (action === "move") {
      vfs.move(sourcePath, destinationPath);
    } else {
      return res.status(400).json({ error: "Invalid action. Use 'copy' or 'move'." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Paste error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Search
router.get("/search", (req, res) => {
    const { root, query } = req.query;
    const results = vfs.resolve(String(root)).fs.search(
        String(root),
        (node, path) => node.name.includes(String(query))
    );
    res.json(results);
});

// Metadata
router.get("/meta", (req, res) => {
    const { path } = req.query;
    const { fs, innerPath } = vfs.resolve(String(path));
    const meta = fs.stat(innerPath);
    res.json(meta);
});

// Tree (from root FS only)
router.get("/tree", (req, res) => {
    const { fs } = vfs.resolve("/");
    res.json(fs.getTree());
});

/* ========== MOUNT SYSTEM ========== */

router.post("/mount", (req, res) => {
    const { mountPath, name, totalBlocks, blockSize } = req.body;

    const newDisk = new FileSystem({ name, totalBlocks, blockSize });
    vfs.mount(newDisk, mountPath);

    res.json({ success: true });
});

router.post("/unmount", (req, res) => {
    const { mountPath } = req.body;
    vfs.unmount(mountPath);
    res.json({ success: true });
});

/* ========== CLI SIMULATION ========== */

router.post("/cli", (req, res) => {
    const { command } = req.body;

    try {
        const output = command;
        res.json({ output });
    } catch (e) {
        res.json({ output: String(e) });
    }
});
