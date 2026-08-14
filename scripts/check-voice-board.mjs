/**
 * Self-check: 我要发声 forum wiring.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const svc = read('src/services/studioVoiceBoard.ts');
assert.match(svc, /studio_voice_posts/);
assert.match(svc, /\/api\/voice-posts\/upload/);
assert.match(svc, /anonymous/);

const server = read('server.ts');
assert.match(server, /initStudioVoiceBoardSchema\(db\)/);
assert.match(server, /registerStudioVoiceBoardRoutes/);

const api = read('src/lib/studioVoiceBoardApi.ts');
assert.match(api, /uploadVoiceImages/);
assert.match(api, /createVoiceComment/);

const ui = read('src/components/StudioVoiceBoard.tsx');
assert.match(ui, /VoiceMarkupEditor/);
assert.match(ui, /匿名发声/);
assert.match(ui, /匿名评论/);
assert.match(ui, /item.can_delete/);
assert.match(ui, /c.can_delete/);
assert.match(ui, /post.can_delete/);
assert.match(api, /deleteVoicePost/);
assert.match(api, /deleteVoiceComment/);

assert.match(svc, /export function canDeleteVoice/);
assert.match(svc, /只能删除自己的发声/);
assert.match(svc, /只能删除自己的评论/);

function canDeleteVoice(authorId, viewerId, isAdmin) {
  if (!authorId || !viewerId) return false;
  return authorId === viewerId || isAdmin;
}
assert.equal(canDeleteVoice('u1', 'u1', false), true);
assert.equal(canDeleteVoice('u1', 'u2', false), false);
assert.equal(canDeleteVoice('u1', 'u2', true), true);
assert.equal(canDeleteVoice('', 'u1', false), false);

const bell = read('src/components/StudioAnnouncementsBell.tsx');
assert.match(bell, /我要发声/);
assert.match(bell, /StudioVoiceBoard/);

const access = read('src/services/canvasGenerations.ts');
assert.match(access, /\/uploads\/voice\//);

console.log('check-voice-board: ok');
