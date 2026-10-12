/** 本机视角界面：先让视角 Agent 写成新画面英文，再用 nano 出图。 */
import { readFileSync, writeFileSync } from "fs";
import { config } from "dotenv";
import path from "path";
import sharp from "sharp";
import type { Request } from "express";
import { fileURLToPath } from "url";
import { generateViewpointAgentOnServer } from "../src/services/canvasViewpointAgentBridge.ts";
import { arrowMassingPixelSize, parseArrowMassing } from "../src/lib/infiniteCanvas/novelViewCamera.js";
import { runStoryboardRunningHubGenerateJob, runStoryboardRunningHubJob } from "../src/services/runningHubStoryboardImage.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env") });

if (process.argv[2] === "--paint-check") {
  const sample = parseArrowMassing('```json\n{"masses":[{"depth":"near","cx":0.3,"cy":0.7,"size":0.4}]}\n```');
  if (sample.length !== 1 || sample[0].band !== "near") throw new Error("灰块解析失败");
  const png = await paintMassing(64, 36, sample);
  if (png.length < 50) throw new Error("灰块没有画出来");
  process.stdout.write("paint-ok\n");
  process.exit(0);
}

const jobPath = process.argv[2];
if (!jobPath) {
  throw new Error("缺少任务文件");
}
const job = JSON.parse(readFileSync(jobPath, "utf8")) as {
  intent?: string;
  prompt?: string;
  image?: string;
  aspectRatio?: string;
  promptOut?: string;
  displayOut?: string;
  massingOut?: string;
  massing?: string;
  ready?: boolean;
  textOnly?: boolean;
  references?: string[];
};
const image = String(job.image || "").trim();
const intent = String(job.intent || "").trim();
let prompt = String(job.prompt || "").trim();
if (!image || (!intent && !prompt)) throw new Error("任务缺少图片或视角说明");
const dataUrl = `data:image/png;base64,${readFileSync(image).toString("base64")}`;
if (job.ready && prompt) {
  if (job.promptOut) writeFileSync(job.promptOut, prompt, "utf8");
  const refs = (job.references || []).map((item) => String(item || "").trim()).filter(Boolean);
  const readyUrl = refs.length
    ? await runStoryboardRunningHubJob({
        prompt,
        images: refs.map((file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`),
        image_size: "2K",
        aspect_ratio: job.aspectRatio || "16:9",
        projectRoot: root,
      })
    : await runStoryboardRunningHubGenerateJob({
        prompt,
        image_size: "2K",
        aspect_ratio: job.aspectRatio || "16:9",
        projectRoot: root,
      });
  process.stdout.write(`${readyUrl}\n`);
  process.exit(0);
}
let displayText = "";
if (intent) {
  const agent = await generateViewpointAgentOnServer({} as Request, root, {
    intent,
    imageUrls: [dataUrl],
  });
  prompt = String(agent.english_prompt || "").trim();
  displayText = String(agent.display_text || "");
  if (!prompt) throw new Error("视角 Agent 没有写出英文提示词");
  if (job.displayOut) writeFileSync(job.displayOut, displayText, "utf8");
}
const masses = parseArrowMassing(displayText);
const meta = await sharp(image).metadata();
const px = arrowMassingPixelSize(meta.width || 1024, meta.height || 576);
let massingUrl = "";
if (masses.length) {
  const png = await paintMassing(px.w, px.h, masses);
  if (job.massingOut) writeFileSync(job.massingOut, png);
  massingUrl = `data:image/png;base64,${png.toString("base64")}`;
}
prompt = editPrompt(prompt, Boolean(massingUrl));
if (job.promptOut) writeFileSync(job.promptOut, prompt, "utf8");
const images = massingUrl ? [dataUrl, massingUrl] : [dataUrl];
const url = await runStoryboardRunningHubJob({
  prompt,
  images,
  image_size: "2K",
  aspect_ratio: job.aspectRatio || "16:9",
  projectRoot: root,
});
process.stdout.write(`${url}\n`);

function editPrompt(english: string, hasMassing: boolean): string {
  const lines = [
    "Image 1 is the original place. Use it only for materials and light. Do not copy its left-to-right order or its camera angle.",
  ];
  if (hasMassing) {
    lines.push("Image 2 is a flat gray layout of the new camera only. Larger darker shapes are closer and lower. Smaller lighter shapes are farther. Match image 2 for where each thing sits and how big it is. Do not paint the gray blocks. Anything not shown in image 2 is behind the camera and must not appear.");
  }
  lines.push("", "New camera:", english.trim());
  return lines.join("\n");
}

async function paintMassing(w: number, h: number, masses: Array<{ band: string; cx: number; cy: number; size: number }>) {
  const buf = Buffer.alloc(w * h * 3, 0x14);
  const rank: Record<string, number> = { far: 0, mid: 1, near: 2 };
  const sorted = [...masses].sort((a, b) => (rank[a.band] ?? 1) - (rank[b.band] ?? 1));
  for (const mass of sorted) {
    const color = mass.band === "near" ? 0x2a : mass.band === "far" ? 0xa3 : 0x5c;
    const bw = mass.size * w;
    const bh = mass.size * h * 0.72;
    const x0 = Math.round(mass.cx * w - bw / 2);
    const y0 = Math.round(mass.cy * h - bh / 2);
    const x1 = Math.round(x0 + bw);
    const y1 = Math.round(y0 + bh);
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x += 1) {
        const i = (y * w + x) * 3;
        buf[i] = color;
        buf[i + 1] = color;
        buf[i + 2] = color;
      }
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}
