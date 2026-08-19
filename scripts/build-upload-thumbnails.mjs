// 为 public/uploads/ 下的存量图片批量生成 WebP 缩略图（/uploads/gallery/{base}_thumb.webp）。
// 画布节点渲染走缩略图省带宽；此脚本补齐历史图。幂等：已存在则跳过，可安全重跑。
// 用法：node scripts/build-upload-thumbnails.mjs [--dry-run]
import { existsSync, mkdirSync } from "fs";
import { readdir, stat } from "fs/promises";
import path from "path";
import sharp from "sharp";

const projectRoot = (process.env.APP_ROOT && String(process.env.APP_ROOT).trim()) || process.cwd();
const dryRun = process.argv.includes("--dry-run");
const uploadsRoot = path.join(projectRoot, "public", "uploads");
const galleryDir = path.join(uploadsRoot, "gallery");

const IMG_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
// ponytail: 头像/封面/发声不参与画布缩略展示，跳过；gallery 是缩略图本身，跳过。
const SKIP_DIRS = new Set(["gallery", "avatars", "covers", "voice"]);

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(path.join(dir, e.name), out);
    } else if (e.isFile() && IMG_EXT.has(path.extname(e.name).toLowerCase())) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

async function fileSize(abs) {
  try { return (await stat(abs)).size; } catch { return 0; }
}

async function main() {
  if (!existsSync(uploadsRoot)) {
    console.log(`[thumb] no uploads dir: ${uploadsRoot}`);
    return;
  }
  mkdirSync(galleryDir, { recursive: true });
  const files = await walk(uploadsRoot);
  console.log(`[thumb] found ${files.length} images under ${uploadsRoot}${dryRun ? " (dry-run)" : ""}`);

  let done = 0, skipped = 0, failed = 0, totalBytes = 0;
  for (let i = 0; i < files.length; i++) {
    const abs = files[i];
    // base 平铺到 gallery 下；文件名均为 uuid/hash 前缀，冲突概率可忽略
    const base = path.basename(abs, path.extname(abs));
    const thumbAbs = path.join(galleryDir, `${base}_thumb.webp`);
    if (existsSync(thumbAbs)) {
      skipped++;
    } else if (dryRun) {
      done++;
    } else {
      try {
        await sharp(abs)
          .rotate()
          .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(thumbAbs);
        done++;
        totalBytes += await fileSize(thumbAbs);
      } catch (err) {
        failed++;
        console.warn(`[thumb] FAIL ${abs}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if ((i + 1) % 200 === 0 || i === files.length - 1) {
      console.log(`[thumb] progress ${i + 1}/${files.length} (done ${done}, skipped ${skipped}, failed ${failed})`);
    }
  }
  console.log(`[thumb] DONE: generated ${done}, skipped(existing) ${skipped}, failed ${failed}`);
}

main().catch((e) => {
  console.error("[thumb] fatal:", e);
  process.exit(1);
});
