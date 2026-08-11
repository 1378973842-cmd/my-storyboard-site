/**
 * 右键图片 / 生图图台：保存到素材库
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const checks = [
  [eng.includes('data-image-save-library'), 'image node ctx: save-library attr'],
  [eng.includes('data-gen-save-library'), 'gen stage ctx: save-library attr'],
  [eng.includes("en ? 'Save to library' : '保存到素材库'"), 'save-to-library label'],
  [eng.includes('void openAssetLibrarySaveModal(url, nodeTitleForMedia(node) || outputImageName(url))'), 'image menu opens asset modal'],
  [eng.includes('void openAssetLibrarySaveModal(url, histItem?.name || outputImageName(url))'), 'gen menu opens asset modal'],
  [eng.includes('const canSaveLibrary = canPreview'), 'image save gated by previewable image'],
  [eng.includes('const canSaveLibrary = url && !isMissingAssetUrl(url) && !isVideoUrl(url) && !isAudioUrl(url)'), 'gen save skips video/audio'],
];

let failed = 0;
for(const [ok, label] of checks){
  if(!ok){
    console.error('FAIL:', label);
    failed++;
  } else {
    console.log('OK:', label);
  }
}
if(failed){
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ncheck-ctx-save-library: all passed');
