// src/filesystem.ts
import * as pathPosix from "path";
import * as fsNode from "fs";

/**
 * File system simulator (Option A: OS-like features for PBL)
 *
 * - In-memory hierarchical tree (directories and file nodes)
 * - Block-based storage simulation with free-block bitmap
 * - Permissions (basic UNIX-like rwx string and owner)
 * - Metadata (createdAt, updatedAt, size)
 * - Persistence: saveToFile / loadFromFile (JSON)
 * - VFSManager: mount multiple FileSystem instances on mount points
 * - Useful methods for CLI/frontend integration
 */

/* ----------------------- Types ----------------------- */

export type ModeString = string; // e.g. "rwxr-xr--"

export interface BaseNodeMeta {
  createdAt: number;
  updatedAt: number;
  owner: string;
  mode: ModeString; // "rwxr-xr-x"
}

export interface FileNode {
  type: "file";
  name: string;
  blocks: number[]; // block ids on the FS
  size: number; // total bytes
  meta: BaseNodeMeta;
}

export interface DirectoryNode {
  type: "directory";
  name: string;
  children: Record<string, FSNode>;
  meta: BaseNodeMeta;
}

export type FSNode = FileNode | DirectoryNode;

export interface FileSystemDump {
  name: string;
  totalBlocks: number;
  blockSize: number;
  freeBlockMap: number[];
  blocks: string[]; // stored data per block (string)
  root: DirectoryNode;
}

/* ---------------------- Utilities --------------------- */

function now(): number {
  return Date.now();
}

function defaultMode(isDir = false): ModeString {
  // basic default: dirs 755, files 644
  return isDir ? "rwxr-xr-x" : "rw-r--r--";
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function normalizePath(p: string): string {
  if (!p) throw p = "/";
  const np = pathPosix.posix.normalize(p);
  return np.startsWith("/") ? np : "/" + np;
}

/* -------------------- FileSystem Class -------------------- */

export class FileSystem {
  name: string;
  totalBlocks: number;
  blockSize: number; // bytes per block
  freeBlockMap: number[]; // 0=free,1=used
  blocks: string[]; // data stored in each block (string). empty string means empty block
  root: DirectoryNode;

  constructor(opts?: { name?: string; totalBlocks?: number; blockSize?: number }) {
    this.name = opts?.name || "disk";
    this.totalBlocks = opts?.totalBlocks ?? 1024;
    this.blockSize = opts?.blockSize ?? 4096;
    this.freeBlockMap = new Array(this.totalBlocks).fill(0);
    this.blocks = new Array(this.totalBlocks).fill("");
    this.root = this.createEmptyDir("/");
  }

  private createEmptyDir(name: string): DirectoryNode {
    return {
      type: "directory",
      name,
      children: {},
      meta: {
        createdAt: now(),
        updatedAt: now(),
        owner: "root",
        mode: defaultMode(true),
      },
    };
  }

  /* ------------------- Block allocation ------------------- */

  allocateBlock(): number | null {
    const idx = this.freeBlockMap.indexOf(0);
    if (idx === -1) return null;
    this.freeBlockMap[idx] = 1;
    this.blocks[idx] = ""; // initialize
    return idx;
  }

  freeBlock(idx: number) {
    if (idx < 0 || idx >= this.totalBlocks) return;
    this.freeBlockMap[idx] = 0;
    this.blocks[idx] = "";
  }

  getFreeBlockCount(): number {
    return this.freeBlockMap.reduce((sum, v) => sum + (v === 0 ? 1 : 0), 0);
  }

  /* -------------------- Path resolution -------------------- */

  // returns parent directory node and the final name
  private resolveParent(p: string): { parent: DirectoryNode; name: string } {
    const normalized = normalizePath(p);
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 0) throw new Error("Invalid path - root has no parent");
    let current: DirectoryNode = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const child = current.children[part];
      if (!child || child.type !== "directory") {
        throw new Error(`Directory not found: ${parts.slice(0, i + 1).join("/")}`);
      }
      current = child;
    }
    return { parent: current, name: parts[parts.length - 1] };
  }

  // return node at path (root allowed)
  getNode(p: string): FSNode {
    const normalized = normalizePath(p);
    if (normalized === "/") return this.root;
    const parts = normalized.split("/").filter(Boolean);
    let current: FSNode = this.root;
    for (const part of parts) {
      if (current.type !== "directory") throw new Error(`Not a directory while resolving path: ${part}`);
      const child = current.children[part] as any;
      if (!child) throw new Error(`Path does not exist: ${part} (while resolving ${p})`);
      current = child;
    }
    return current;
  }

  exists(p: string): boolean {
    try {
      this.getNode(p);
      return true;
    } catch {
      return false;
    }
  }

  /* -------------------- Directory operations -------------------- */

  createDirectory(p: string, opts?: { owner?: string; mode?: ModeString }) {
    const normalized = normalizePath(p);
    if (normalized === "/") throw new Error("Root already exists");
    const { parent, name } = this.resolveParent(normalized);
    if (parent.children[name]) throw new Error("Entry already exists");
    const dir: DirectoryNode = {
      type: "directory",
      name,
      children: {},
      meta: {
        createdAt: now(),
        updatedAt: now(),
        owner: opts?.owner ?? "root",
        mode: opts?.mode ?? defaultMode(true),
      },
    };
    parent.children[name] = dir;
    parent.meta.updatedAt = now();
    return dir;
  }

  listDirectory(p: string): { name: string; type: "file" | "directory"; size?: number; meta: BaseNodeMeta }[] {
    const node = this.getNode(p);
    if (node.type !== "directory") throw new Error("Not a directory");
    return Object.entries(node.children).map(([name, child]) => ({
      name,
      type: child.type,
      size: child.type === "file" ? child.size : undefined,
      meta: child.meta,
    }));
  }

  /* -------------------- File operations -------------------- */

  private createFileNode(name: string, content: string, owner = "root", mode?: ModeString): FileNode {
    // allocate blocks for content
    const bs = this.blockSize;
    const blocks: number[] = [];
    let cursor = 0;
    while (cursor < content.length) {
      const b = this.allocateBlock();
      if (b === null) {
        // rollback
        for (const bid of blocks) this.freeBlock(bid);
        throw new Error("Disk full while creating file");
      }
      const chunk = content.slice(cursor, cursor + bs);
      this.blocks[b] = chunk;
      blocks.push(b);
      cursor += bs;
    }
    const node: FileNode = {
      type: "file",
      name,
      blocks,
      size: content.length,
      meta: {
        createdAt: now(),
        updatedAt: now(),
        owner,
        mode: mode ?? defaultMode(false),
      },
    };
    return node;
  }

  createFile(p: string, content = "", opts?: { owner?: string; mode?: ModeString }) {
    const normalized = normalizePath(p);
    const { parent, name } = this.resolveParent(normalized);
    if (parent.children[name]) throw new Error("Entry already exists");
    const node = this.createFileNode(name, content, opts?.owner ?? "root", opts?.mode);
    parent.children[name] = node;
    parent.meta.updatedAt = now();
    return node;
  }

  readFile(p: string): string {
    const node = this.getNode(p);
    if (node.type !== "file") throw new Error("Not a file");
    // reconstruct from blocks
    return node.blocks.map((b) => this.blocks[b] ?? "").join("");
  }

  writeFile(p: string, content: string) {
    const normalized = normalizePath(p);
    const node = this.getNode(normalized);
    if (node.type !== "file") throw new Error("Not a file");
    // free current blocks
    for (const b of node.blocks) this.freeBlock(b);
    // allocate new blocks
    const bs = this.blockSize;
    const newBlocks: number[] = [];
    let cursor = 0;
    while (cursor < content.length) {
      const b = this.allocateBlock();
      if (b === null) {
        // rollback
        for (const bid of newBlocks) this.freeBlock(bid);
        throw new Error("Disk full while writing file");
      }
      const chunk = content.slice(cursor, cursor + bs);
      this.blocks[b] = chunk;
      newBlocks.push(b);
      cursor += bs;
    }
    node.blocks = newBlocks;
    node.size = content.length;
    node.meta.updatedAt = now();
    return node;
  }

  appendFile(p: string, extra: string) {
    const node = this.getNode(p);
    if (node.type !== "file") throw new Error("Not a file");
    const current = this.readFile(p);
    return this.writeFile(p, current + extra);
  }

  deleteNode(p: string) {
    const normalized = normalizePath(p);
    if (normalized === "/") throw new Error("Cannot delete root");
    const { parent, name } = this.resolveParent(normalized);
    const node = parent.children[name];
    if (!node) throw new Error("Path not found");
    // recursive delete if directory
    const deleteRec = (n: FSNode) => {
      if (n.type === "file") {
        for (const b of n.blocks) this.freeBlock(b);
      } else {
        for (const ch of Object.values(n.children)) deleteRec(ch);
      }
    };
    deleteRec(node);
    delete parent.children[name];
    parent.meta.updatedAt = now();
    return true;
  }

  rename(p: string, newName: string) {
    const normalized = normalizePath(p);
    const { parent, name } = this.resolveParent(normalized);
    const node = parent.children[name];
    if (!node) throw new Error("Path not found");
    if (parent.children[newName]) throw new Error("Destination name already exists");
    delete parent.children[name];
    node.name = newName;
    parent.children[newName] = node;
    parent.meta.updatedAt = now();
    return node;
  }

  move(src: string, dst: string) {
    const sn = normalizePath(src);
    const dn = normalizePath(dst);
    const { parent: sParent, name: sName } = this.resolveParent(sn);
    const node = sParent.children[sName];
    if (!node) throw new Error("Source not found");
    // destination may be directory or full path
    let destParent: DirectoryNode;
    let destName: string;
    try {
      const dnode = this.getNode(dn);
      // if dst exists and is dir -> move into it, keep same name
      if (dnode.type === "directory") {
        destParent = dnode;
        destName = node.name;
      } else {
        // dst exists and is file -> cannot move onto existing file
        throw new Error("Destination exists and is not a directory");
      }
    } catch {
      // dst not found -> interpret as full path specifying new name
      const res = this.resolveParent(dn);
      destParent = res.parent;
      destName = res.name;
    }
    if (destParent.children[destName]) throw new Error("Destination entry already exists");
    // detach from source parent
    delete sParent.children[sName];
    // attach
    node.name = destName;
    destParent.children[destName] = node;
    sParent.meta.updatedAt = now();
    destParent.meta.updatedAt = now();
    return node;
  }

  copy(src: string, dst: string) {
    const node = this.getNode(src);
    // dst must not already exist OR must be directory (then copy inside)
    const dn = normalizePath(dst);
    let destParent: DirectoryNode;
    let destName: string;
    try {
      const dnode = this.getNode(dn);
      if (dnode.type === "directory") {
        destParent = dnode;
        destName = node.name;
      } else {
        throw new Error("Destination exists and is not a directory");
      }
    } catch {
      const res = this.resolveParent(dn);
      destParent = res.parent;
      destName = res.name;
    }
    if (destParent.children[destName]) throw new Error("Destination entry already exists");

    // deep copy node; for files allocate new blocks and copy data
    const cloneRec = (n: FSNode): FSNode => {
      if (n.type === "file") {
        const content = n.blocks.map((b) => this.blocks[b] ?? "").join("");
        return this.createFileNode(destName, content, n.meta.owner, n.meta.mode);
      } else {
        const dir: DirectoryNode = {
          type: "directory",
          name: destName,
          children: {},
          meta: { ...n.meta, createdAt: now(), updatedAt: now() },
        };
        for (const [k, child] of Object.entries(n.children)) {
          const childClone = cloneRec(child);
          dir.children[childClone.name] = childClone;
        }
        return dir;
      }
    };

    const copied = cloneRec(node);
    destParent.children[destName] = copied;
    destParent.meta.updatedAt = now();
    return copied;
  }

  stat(p: string) {
    const node = this.getNode(p);
    if (node.type === "file") {
      return {
        type: "file",
        name: node.name,
        size: node.size,
        blocks: node.blocks.slice(),
        meta: node.meta,
      };
    } else {
      return {
        type: "directory",
        name: node.name,
        childrenCount: Object.keys(node.children).length,
        meta: node.meta,
      };
    }
  }

  search(rootPath: string, predicate: (n: FSNode, fullPath: string) => boolean): string[] {
    const start = this.getNode(rootPath);
    if (start.type !== "directory") throw new Error("search root must be directory");
    const out: string[] = [];

    const walk = (n: FSNode, curPath: string) => {
      if (predicate(n, curPath)) out.push(curPath);
      if (n.type === "directory") {
        for (const [k, child] of Object.entries(n.children)) {
          walk(child, pathPosix.posix.join(curPath, k));
        }
      }
    };

    walk(start, normalizePath(rootPath));
    return out;
  }

  getTree(): DirectoryNode {
    return this.root;
  }

  format(opts?: { zeroBlocks?: boolean }) {
    this.freeBlockMap = new Array(this.totalBlocks).fill(0);
    if (opts?.zeroBlocks) this.blocks = new Array(this.totalBlocks).fill("");
    this.root = this.createEmptyDir("/");
  }

  /* -------------------- Persistence -------------------- */

  export(): FileSystemDump {
    return {
      name: this.name,
      totalBlocks: this.totalBlocks,
      blockSize: this.blockSize,
      freeBlockMap: this.freeBlockMap.slice(),
      blocks: this.blocks.slice(),
      root: this.root,
    };
  }

  saveToFile(filePath: string) {
    const dump = this.export();
    fsNode.writeFileSync(filePath, JSON.stringify(dump, null, 2), "utf8");
  }

  static loadFromFile(filePath: string): FileSystem {
    const raw = fsNode.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as FileSystemDump;
    const fsys = new FileSystem({ name: parsed.name, totalBlocks: parsed.totalBlocks, blockSize: parsed.blockSize });
    fsys.freeBlockMap = parsed.freeBlockMap.slice();
    fsys.blocks = parsed.blocks.slice();
    fsys.root = parsed.root;
    return fsys;
  }

  importDump(dump: FileSystemDump) {
    this.name = dump.name;
    this.totalBlocks = dump.totalBlocks;
    this.blockSize = dump.blockSize;
    this.freeBlockMap = dump.freeBlockMap.slice();
    this.blocks = dump.blocks.slice();
    this.root = dump.root;
  }
}

/* -------------------- VFSManager -------------------- */

/**
 * VFSManager maintains multiple FileSystem instances mounted at mount points.
 * It resolves a vfs path (e.g. /, /mnt/usb/docs.txt) to an underlying fs and inner path.
 */
export class VFSManager {
  private mounts: { mountPoint: string; fs: FileSystem }[] = [];

  constructor() {
    // default: create a main root fs
    const main = new FileSystem({ name: "root", totalBlocks: 4096, blockSize: 4096 });
    this.mounts.push({ mountPoint: "/", fs: main });
    this.sortMounts();
  }

  listMounts() {
    return this.mounts.map((m) => ({ mountPoint: m.mountPoint, fsName: m.fs.name }));
  }

  createDisk(name: string, opts?: { totalBlocks?: number; blockSize?: number }) {
    const fsys = new FileSystem({ name, totalBlocks: opts?.totalBlocks, blockSize: opts?.blockSize });
    return fsys;
  }

  mount(fsys: FileSystem, mountPoint: string) {
    mountPoint = normalizePath(mountPoint);
    // disallow duplicate mount points
    if (this.mounts.some((m) => m.mountPoint === mountPoint)) throw new Error("Mount point already used");
    this.mounts.push({ mountPoint, fs: fsys });
    this.sortMounts();
  }

  unmount(mountPoint: string) {
    mountPoint = normalizePath(mountPoint);
    const idx = this.mounts.findIndex((m) => m.mountPoint === mountPoint);
    if (idx === -1) throw new Error("Mount point not found");
    if (this.mounts[idx].mountPoint === "/") throw new Error("Cannot unmount root");
    this.mounts.splice(idx, 1);
  }

  private sortMounts() {
    // longest mountPoint first for longest-prefix matching
    this.mounts.sort((a, b) => b.mountPoint.length - a.mountPoint.length);
  }

  /**
   * Resolve a vfs path to a mounted fs and inner path inside it.
   * Example:
   *  - mounts: [ { "/" -> fsRoot }, { "/mnt/usb" -> fsUsb } ]
   *  - resolve("/mnt/usb/docs/a.txt") -> { fs: fsUsb, inner: "/docs/a.txt", mountPoint: "/mnt/usb" }
   */
  resolve(vfsPath: string): { fs: FileSystem; innerPath: string; mountPoint: string } {
    let p = normalizePath(vfsPath);
    for (const m of this.mounts) {
      if (m.mountPoint === "/") {
        // root matches everything; keep checking for longer matches first
        continue;
      }
      if (p === m.mountPoint || p.startsWith(m.mountPoint + "/")) {
        const inner = p.slice(m.mountPoint.length) || "/";
        return { fs: m.fs, innerPath: normalizePath(inner), mountPoint: m.mountPoint };
      }
    }
    // fallback to root mount
    const rootMount = this.mounts.find((m) => m.mountPoint === "/")!;
    return { fs: rootMount.fs, innerPath: p, mountPoint: "/" };
  }

  // convenience wrappers
  createDirectory(vfsPath: string, opts?: { owner?: string; mode?: ModeString }) {
    const { fs, innerPath } = this.resolve(vfsPath);
    return fs.createDirectory(innerPath, opts);
  }

  createFile(vfsPath: string, content?: string, opts?: { owner?: string; mode?: ModeString }) {
    const { fs, innerPath } = this.resolve(vfsPath);
    return fs.createFile(innerPath, content ?? "", opts);
  }

  readFile(vfsPath: string) {
    const { fs, innerPath } = this.resolve(vfsPath);
    return fs.readFile(innerPath);
  }

  writeFile(vfsPath: string, content: string) {
    const { fs, innerPath } = this.resolve(vfsPath);
    return fs.writeFile(innerPath, content);
  }

  listDirectory(vfsPath: string) {
    const { fs, innerPath } = this.resolve(vfsPath);
    return fs.listDirectory(innerPath);
  }

  delete(vfsPath: string) {
    const { fs, innerPath } = this.resolve(vfsPath);
    return fs.deleteNode(innerPath);
  }

  move(srcVfs: string, dstVfs: string) {
    const rsrc = this.resolve(srcVfs);
    const rdst = this.resolve(dstVfs);
    if (rsrc.fs !== rdst.fs) throw new Error("Cross-disk move not supported in VFS convenience (use manual mount handling)");
    return rsrc.fs.move(rsrc.innerPath, rdst.innerPath);
  }

  copy(srcVfs: string, dstVfs: string) {
    const rsrc = this.resolve(srcVfs);
    const rdst = this.resolve(dstVfs);
    if (rsrc.fs !== rdst.fs) throw new Error("Cross-disk copy not supported in VFS convenience");
    return rsrc.fs.copy(rsrc.innerPath, rdst.innerPath);
  }
}

/* -------------------- End of Module -------------------- */
