/**
 * 工作流模版库：侧栏 + 封面网格（导演稿布局）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shell = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/InfiniteCanvasShell.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

assert(shell.includes('workflow-template-nav'), 'missing sidebar nav');
assert(shell.includes('data-wf-filter="recent"'), 'missing recent nav');
assert(shell.includes('data-wf-filter="mine"'), 'missing mine nav');
assert(shell.includes('data-wf-filter="public"'), 'missing public nav');
assert(shell.includes('workflowTemplateViewTitle'), 'missing view title');
assert(shell.includes('workflow-template-create-btn'), 'missing create btn');
assert(css.includes('.workflow-template-card-cover'), 'missing cover card CSS');
assert(css.includes('grid-template-columns:repeat(auto-fill, minmax(148px'), 'missing dense grid');
assert(engine.includes('rememberWorkflowTemplateRecent'), 'missing recent memory');
assert(engine.includes('workflowTemplateCoverStyle'), 'missing cover fallback');
assert(engine.includes("workflowTemplateKindFilter = 'public'"), 'default should be public library');

console.log('check-wf-template-gallery: pass');
