/** Auto-generated from canvas.html — re-run scripts/html-to-jsx-shell.mjs */
import { memo, useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import {
  applyImageEdit,
  clearEditDrawing,
  closeImageEditor,
  redoEditDrawing,
  resetCropBox,
  resetImageEditZoom,
  restoreAnnotationBase,
  setBrushTool,
  setCropAspectLock,
  setImageEditMode,
  undoEditDrawing,
} from '../../lib/infiniteCanvas/canvasEngine.js';

const canvasWin = window as unknown as Record<string, (...args: unknown[]) => void>;

function assignRootRef(rootRef: Ref<HTMLDivElement>, node: HTMLDivElement | null) {
  if (typeof rootRef === 'function') rootRef(node);
  else if (rootRef && 'current' in rootRef) rootRef.current = node;
}

/** 首帧保持 gate 可见；shell 默认 no-canvas，避免编辑器顶栏在引擎就绪前闪现 */
function seedCanvasRootMarkers(node: HTMLDivElement) {
  if (node.dataset.editorSession == null) node.dataset.editorSession = '0';
  if (node.dataset.canvasOpen == null) node.dataset.canvasOpen = '0';
  const shell = node.querySelector('#shell');
  if (shell && !shell.classList.contains('no-canvas')) {
    shell.classList.add('no-canvas');
  }
}

type Props = { rootRef: Ref<HTMLDivElement> };

type AgentFlyoutItem = {
  icon: string;
  label: string;
  action: () => void;
};

const AGENT_FLYOUT_ITEMS: AgentFlyoutItem[] = [
  { icon: 'bot', label: '复刻 Agent', action: () => canvasWin['addReplicaAgentNode']?.() },
  { icon: 'wand-sparkles', label: '修图 Agent', action: () => canvasWin['addImageRepairAgentNode']?.() },
  { icon: 'layout-grid', label: 'Poster Agent', action: () => canvasWin['addBatchPosterAgentNode']?.() },
  { icon: 'grid-3x3', label: '九宫格 Agent', action: () => canvasWin['addNineGridAgentNode']?.() },
];

function ToolbarAgentFlyout() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ left: 0, bottom: 0 });
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.querySelector('.infinite-canvas-root');
    setPortalRoot(root instanceof HTMLElement ? root : null);
  }, []);

  const syncMenuPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({
      left: rect.left + rect.width / 2,
      bottom: window.innerHeight - rect.top + 8,
    });
  }, []);

  const refreshFlyoutIcons = useCallback(() => {
    const lucide = (window as unknown as { lucide?: { createIcons?: () => void } }).lucide;
    lucide?.createIcons?.();
  }, []);

  const openMenu = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    syncMenuPos();
    setOpen(true);
    queueMicrotask(refreshFlyoutIcons);
  }, [refreshFlyoutIcons, syncMenuPos]);

  const scheduleClose = useCallback(() => {
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 140);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onLayout = () => syncMenuPos();
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [open, syncMenuPos]);

  useEffect(() => () => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const menu = open && portalRoot ? createPortal(
    <div
      className="toolbar-flyout-menu toolbar-flyout-menu-portal toolbar-flyout-menu-agents is-open"
      role="menu"
      aria-label="Agent nodes"
      style={{ left: `${menuPos.left}px`, bottom: `${menuPos.bottom}px` }}
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <div className="toolbar-flyout-heading">Agent</div>
      <div className="toolbar-flyout-grid">
        {AGENT_FLYOUT_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            className="toolbar-flyout-item toolbar-flyout-item-grid"
            role="menuitem"
            title={item.label}
            onClick={() => {
              setOpen(false);
              item.action();
            }}
          >
            <i data-lucide={item.icon} className="w-4 h-4"></i>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>,
    portalRoot,
  ) : null;

  return (
    <>
      <div
        className={`toolbar-flyout${open ? ' is-open' : ''}`}
        onMouseEnter={openMenu}
        onMouseLeave={scheduleClose}
      >
        <button
          ref={triggerRef}
          type="button"
          className="tool-btn tool-btn-ghost tool-btn-icon-only toolbar-flyout-trigger"
          title="Agent"
          aria-label="Agent"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            syncMenuPos();
            setOpen((value) => !value);
            queueMicrotask(refreshFlyoutIcons);
          }}
        >
          <i data-lucide="bot" className="w-4 h-4"></i>
          <span>Agent</span>
        </button>
      </div>
      {menu}
    </>
  );
}

export const InfiniteCanvasShell = memo(function InfiniteCanvasShell({ rootRef }: Props) {
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      assignRootRef(rootRef, node);
      if (node) seedCanvasRootMarkers(node);
    },
    [rootRef],
  );

  return (
    <div ref={mergedRef} className="infinite-canvas-root theme-dark">
      {/* #shell 禁止写 className，由 canvasEngine 独占 no-canvas / theme-dark */}
      <div id="shell">
              <div className="topbar editor-only">
                  <div className="panel canvas-topbar-compact">
                      <div className="canvas-topbar-nav">
                          <button id="backToManagerBtn" className="tool-btn tool-btn-back" type="button" title="返回画布管理" aria-label="返回画布管理" data-i18n-title="canvas.backToManager"><i data-lucide="arrow-left" className="w-4 h-4"></i></button>
                          <div className="canvas-nav-meta">
                              <div id="currentCanvasTitle" className="current-canvas-title">未命名画布</div>
                              <div id="currentCanvasTime" className="current-canvas-time">--</div>
                          </div>
                          <p id="saveState" style={{ display: "none" }} data-i18n="canvas.chooseFirst">请选择或新建画布</p>
                      </div>
                  </div>
              </div>

              <div className="bottombar editor-only">
                  <div id="quickToolbar" className="panel canvas-bottombar toolbar">
                      <div className="canvas-bottombar-body">
                          <div className="toolbar-dock">
                              <div className="toolbar-group">
                                  <button className="tool-btn tool-btn-ghost tool-btn-icon-only" onClick={() => canvasWin["addImageNode"]?.()} title="图片" aria-label="图片"><i data-lucide="image-plus" className="w-4 h-4"></i><span data-i18n="canvas.image">图片</span></button>
                                  <button className="tool-btn tool-btn-ghost tool-btn-icon-only" onClick={() => canvasWin["addPromptNode"]?.()} title="提示词" aria-label="提示词"><i data-lucide="text-cursor-input" className="w-4 h-4"></i><span data-i18n="canvas.prompt">提示词</span></button>
                                  <button className="tool-btn tool-btn-ghost tool-btn-icon-only" onClick={() => canvasWin["addLoopNode"]?.()} title="循环" aria-label="循环"><i data-lucide="repeat-2" className="w-4 h-4"></i><span data-i18n="canvas.loop">循环</span></button>
                              </div>
                              <span className="toolbar-dock-sep" aria-hidden="true" />
                              <div className="toolbar-group">
                                  <button className="tool-btn tool-btn-ghost tool-btn-icon-only" onClick={() => canvasWin["addLLMNode"]?.()} title="LLM" aria-label="LLM"><i data-lucide="message-square-text" className="w-4 h-4"></i><span>LLM</span></button>
                                  <button className="tool-btn tool-btn-ghost tool-btn-icon-only" onClick={() => canvasWin["addGeneratorNode"]?.()} title="图片生成" aria-label="图片生成"><i data-lucide="wand-sparkles" className="w-4 h-4"></i><span data-i18n="canvas.apiGenerate">图片生成</span></button>
                                  <ToolbarAgentFlyout />
                                  <button className="tool-btn tool-btn-ghost tool-btn-icon-only" onClick={() => canvasWin["addVideoReverseNode"]?.()} title="视频反推" aria-label="视频反推"><i data-lucide="scan-search" className="w-4 h-4"></i><span>反推</span></button>
                              </div>
                              <span className="toolbar-dock-sep" aria-hidden="true" />
                              <div className="toolbar-group">
                                  <button className="tool-btn tool-btn-ghost tool-btn-icon-only" onClick={() => canvasWin["addOutputNode"]?.()} title="Output" aria-label="Output"><i data-lucide="circle-dot" className="w-4 h-4"></i><span>Output</span></button>
                                  <button className="tool-btn tool-btn-ghost tool-btn-icon-only" onClick={() => canvasWin["createImageBatchFromSelection"]?.()} title="图片组" aria-label="图片组" data-i18n-title="canvas.imageBatchNode"><i data-lucide="images" className="w-4 h-4"></i><span data-i18n="canvas.imageBatchNode">图片组</span></button>
                                  <button className="tool-btn tool-btn-ghost tool-btn-icon-only" onClick={() => canvasWin["createPromptGroupFromSelection"]?.()} title="提示词组" aria-label="提示词组" data-i18n-title="canvas.promptGroupNode"><i data-lucide="layers" className="w-4 h-4"></i><span data-i18n="canvas.promptGroupNode">提示词组</span></button>
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
      
              <div id="canvasGate" className="canvas-gate">
                  <div className="gate-panel-ambient" aria-hidden="true" />
                  <div className="gate-panel">
                      <div className="gate-head">
                          <div className="gate-head-text">
                              <button id="gateBackBtn" className="gate-back-link" type="button"><i data-lucide="arrow-left" className="w-3.5 h-3.5"></i><span data-i18n="canvas.backToList">返回画布列表</span></button>
                              <div className="gate-title-row">
                                  <div id="gateTitleText" className="gate-title">选择画布</div>
                              </div>
                              <div id="gateSubtitle" className="gate-subtitle" hidden></div>
                          </div>
                          <div className="gate-head-actions">
                              <button id="gateRefreshBtn" className="gate-icon-btn" type="button" title="刷新列表" aria-label="刷新列表" data-i18n-title="canvas.refresh">
                                  <i data-lucide="refresh-cw" className="w-4 h-4"></i>
                              </button>
                              <button id="gateTrashBtn" className="gate-icon-btn gate-trash-entry" type="button" title="打开回收站" aria-label="打开回收站" data-i18n-title="canvas.openTrash">
                                  <i data-lucide="trash-2" className="w-4 h-4"></i>
                                  <span id="gateTrashCount" className="gate-trash-badge">0</span>
                              </button>
                              <button id="gateCreateBtn" className="primary-btn" type="button"><i data-lucide="plus" className="w-4 h-4"></i><span data-i18n="canvas.newCanvas">新建画布</span></button>
                              {/* 智能画布尚未接入本站，由 canvasEngine.refreshGateViewControls 保持 hidden */}
                              <button id="gateCreateSmartBtn" className="smart-create-btn" type="button" hidden><i data-lucide="sparkles" className="w-4 h-4"></i><span data-i18n="canvas.newSmartCanvas">新建智能画布</span></button>
                          </div>
                      </div>
                      <div id="gateStatus" className="gate-status" data-i18n="canvas.loadingCanvases">正在加载画布列表...</div>
                      <div className="gate-create-row">
                          <input id="gateTitleInput" className="gate-name-input" type="text" maxLength={80} placeholder="新画布名称（可留空使用默认）" data-i18n-placeholder="canvas.newCanvasPlaceholder" />
                          <button id="gateConfirmBtn" className="create-confirm" type="button" title="确定" aria-label="确定" data-i18n-title="common.confirm"><i data-lucide="check" className="w-4 h-4"></i></button>
                          <button id="gateCancelBtn" className="create-cancel" type="button" title="取消" aria-label="取消" data-i18n-title="common.cancel"><i data-lucide="x" className="w-4 h-4"></i></button>
                      </div>
                      <div className="trash-note"><i data-lucide="info" className="w-3.5 h-3.5 inline-block align-text-bottom mr-1"></i><span data-i18n="canvas.trashNote">回收站中的画布会在 30 天后自动清理。</span></div>
                      <div className="gate-canvas-section">
                          <div className="gate-section-head">
                              <div className="gate-section-title-row">
                                  <div className="gate-section-title" data-i18n="canvas.myCanvases">我的画布</div>
                                  <span id="gateCountPill" className="gate-count-pill">0</span>
                              </div>
                          </div>
                          <div id="gateCanvasList" className="gate-list"></div>
                      </div>
                  </div>
              </div>
      
              <div id="board" className="board editor-only">
                  <div id="dropOverlay" className="drop-overlay" data-i18n="canvas.dropImage">拖放图片到画布</div>
                  <div className="output-drag-hint editor-only" aria-live="polite">
                      <span data-i18n="canvas.outputDragHint">拖离节点后再松手，即可复制到画布</span>
                  </div>
                  <div id="selectionBox" className="selection-box"></div>
                  <div id="selectionHub" className="selection-hub"></div>
                  <div id="createMenu" className="create-menu">
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('image')}><i data-lucide="image-plus" className="w-4 h-4"></i><span data-i18n="canvas.imageCard">图片卡片</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('imageBatch')}><i data-lucide="images" className="w-4 h-4"></i><span data-i18n="canvas.imageBatchNode">图片组</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('prompt')}><i data-lucide="text-cursor-input" className="w-4 h-4"></i><span data-i18n="canvas.prompt">提示词</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('loop')}><i data-lucide="repeat-2" className="w-4 h-4"></i><span data-i18n="canvas.loopNode">循环节点</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('llm')}><i data-lucide="message-square-text" className="w-4 h-4"></i><span data-i18n="canvas.llmNode">LLM 节点</span></button>
                      <div className="menu-section-title">生成</div>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('generator')}><i data-lucide="wand-sparkles" className="w-4 h-4"></i><span data-i18n="canvas.apiGenerate">图片生成</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('video')}><i data-lucide="clapperboard" className="w-4 h-4"></i><span data-i18n="canvas.videoGenerateNode">视频生成</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('rh')}><i data-lucide="workflow" className="w-4 h-4"></i><span data-i18n="canvas.rhGenerate">RH生成</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('videoReverse')}><i data-lucide="scan-search" className="w-4 h-4"></i><span>视频反推</span></button>
                      <div className="menu-section-title">Agent</div>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('replicaAgent')}><i data-lucide="bot" className="w-4 h-4"></i><span>复刻 Agent</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('imageRepairAgent')}><i data-lucide="wand-sparkles" className="w-4 h-4"></i><span>修图 Agent</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('batchPosterAgent')}><i data-lucide="layout-grid" className="w-4 h-4"></i><span>Batch Poster Agent</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('nineGridAgent')}><i data-lucide="grid-3x3" className="w-4 h-4"></i><span>九宫格 Agent</span></button>
                      <div className="menu-section-title">输出</div>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('output')}><i data-lucide="circle-dot" className="w-4 h-4"></i><span>Output</span></button>
                  </div>
                  <div id="linkCreateMenu" className="create-menu"></div>
                  <div id="nodeInputMenu" className="create-menu"></div>
                  <div id="nodeOutputMenu" className="create-menu"></div>
                  <div id="imageNodeMenu" className="create-menu"></div>
                  <div id="selectionMenu" className="create-menu selection-menu"></div>
                  <div id="world" className="world">
                      <svg id="links" className="links"></svg>
                      <div id="linkControls" className="link-controls"></div>
                      <div id="nodes"></div>
                  </div>
                  <div id="minimap" className="minimap" title="导航地图">
                      <div id="minimapContent" className="minimap-content">
                          <div id="minimapViewport" className="minimap-viewport"></div>
                      </div>
                  </div>
              </div>
              <div className="hint editor-only" data-i18n="canvas.hint">拖拽空白处或按住空格拖动画布；滚轮缩放；中键平移。Ctrl 框选多选，拖动节点标题栏可移动节点。</div>
              <div id="outputLightbox" className="output-lightbox">
                  <div id="outputLightboxShell" className="output-lightbox-shell">
                  <div id="outputPreview" className="output-preview">
                      <div id="outputCompareContainer" className="output-compare">
                          <img id="outputCompareResult" alt="result image" />
                          <div id="outputCompareOriginalWrap" className="output-compare-original-wrap">
                              <img id="outputCompareOriginal" alt="input image" />
                          </div>
                          <div id="outputCompareSlider" className="output-compare-slider">
                              <div className="output-compare-handle"><i data-lucide="move-horizontal" className="w-4 h-4"></i></div>
                          </div>
                      </div>
                      <img id="outputLightboxImg" className="output-single-img" src="" alt="output preview" />
                      <video id="outputLightboxVideo" className="output-single-video" src="" controls playsInline disablePictureInPicture controlsList="nodownload noplaybackrate noremoteplayback" style={{ display: "none" }}></video>
                      <div className="output-preview-bar">
                          <div id="outputResolution" className="output-resolution">--</div>
                          <div className="output-preview-actions">
                              <button id="outputDownloadBtn" className="preview-icon-btn" type="button" title="下载" aria-label="下载" data-i18n-title="canvas.download"><i data-lucide="download" className="w-4 h-4"></i></button>
                              <button id="outputLightboxCloseBtn" className="preview-icon-btn" type="button" title="关闭" aria-label="关闭" data-i18n-title="common.close"><i data-lucide="x" className="w-4 h-4"></i></button>
                          </div>
                      </div>
                  </div>
                  <div id="outputPromptPanel" className="output-prompt-panel">
                      <div id="outputPromptText" className="output-prompt-text"></div>
                      <div className="output-prompt-actions">
                          <button id="outputCopyPromptBtn" className="preview-text-btn secondary" type="button"><i data-lucide="copy" className="w-3.5 h-3.5"></i><span data-i18n="canvas.copyPrompt">复制提示词</span></button>
                          <button id="outputRerunBtn" className="preview-text-btn" type="button"><i data-lucide="refresh-cw" className="w-3.5 h-3.5"></i><span data-i18n="canvas.rerun">再次运行</span></button>
                      </div>
                  </div>
                  </div>
              </div>
              <div id="workflowTemplateModal" className="workflow-template-modal" onClick={() => canvasWin["closeWorkflowTemplateModal"]?.()}>
                  <div className="workflow-template-panel" onClick={(e) => e.stopPropagation()}>
                      <div className="workflow-template-head">
                          <div>
                              <div className="workflow-template-title" data-i18n="canvas.workflowTemplates">工作流模板</div>
                              <div className="workflow-template-sub" data-i18n="canvas.workflowModalHint">插入到当前画布，或保存当前连线为模板</div>
                          </div>
                          <button className="preview-icon-btn" type="button" onClick={() => canvasWin["closeWorkflowTemplateModal"]?.()} title="关闭" data-i18n-title="common.close"><i data-lucide="x" className="w-4 h-4"></i></button>
                      </div>
                      <div className="workflow-template-actions">
                          <button id="saveWorkflowTemplateBtn" className="workflow-template-save" type="button" onClick={() => canvasWin["saveCurrentCanvasAsWorkflowTemplate"]?.()}><i data-lucide="bookmark-plus" className="w-4 h-4"></i><span data-i18n="canvas.saveWorkflowTemplate">保存当前为模板</span></button>
                      </div>
                      <div id="workflowTemplateList" className="workflow-template-list"></div>
                  </div>
              </div>
              <div id="logModal" className="log-modal" onClick={() => canvasWin["closeCanvasLog"]?.()}>
                  <div className="log-panel" onClick={(e) => e.stopPropagation()}>
                      <div className="log-head">
                          <div className="log-title" data-i18n="canvas.generationLogs">生成日志</div>
                          <button className="preview-icon-btn" type="button" onClick={() => canvasWin["closeCanvasLog"]?.()} title="关闭" data-i18n-title="common.close"><i data-lucide="x" className="w-4 h-4"></i></button>
                      </div>
                      <div id="logList" className="log-list"></div>
                  </div>
              </div>
              <div id="imageEditModal" className="image-edit-modal" onClick={() => closeImageEditor()}>
                  <div className="image-edit-panel" onClick={(e) => e.stopPropagation()}>
                      <div className="image-edit-head">
                          <div>
                              <div id="imageEditTitle" className="image-edit-title" data-i18n="canvas.editImage">编辑图片</div>
                              <div id="imageEditSub" className="image-edit-sub" data-i18n="canvas.editImageSub">选择裁剪或画笔模式</div>
                          </div>
                          <div className="image-edit-mode">
                              <button type="button" data-image-edit-mode="crop" className="active" onClick={(e) => { e.stopPropagation(); setImageEditMode('crop', true); }}><i data-lucide="crop" className="w-3.5 h-3.5"></i><span data-i18n="canvas.modeCrop">裁剪</span></button>
                              <button type="button" data-image-edit-mode="brush" onClick={(e) => { e.stopPropagation(); setImageEditMode('brush', true); }}><i data-lucide="paintbrush" className="w-3.5 h-3.5"></i><span data-i18n="canvas.modeBrush">画笔</span></button>
                          </div>
                          <button className="preview-icon-btn" type="button" onClick={() => closeImageEditor()} title="关闭" data-i18n-title="common.close"><i data-lucide="x" className="w-4 h-4"></i></button>
                      </div>
                      <div id="imageCropTools" className="image-edit-tools active">
                          <span className="image-edit-sub" data-i18n="canvas.cropAspect">裁剪比例</span>
                          <button type="button" className="crop-aspect-btn active" data-crop-aspect="original" data-i18n="canvas.cropAspectOriginal" onClick={(e) => { e.stopPropagation(); setCropAspectLock('original'); }}>原图比例</button>
                          <button type="button" className="crop-aspect-btn" data-crop-aspect="free" data-i18n="canvas.cropAspectFree" onClick={(e) => { e.stopPropagation(); setCropAspectLock('free'); }}>自由</button>
                          <button type="button" className="crop-aspect-btn" data-crop-aspect="1:1" onClick={(e) => { e.stopPropagation(); setCropAspectLock('1:1'); }}>1:1</button>
                          <button type="button" className="crop-aspect-btn" data-crop-aspect="9:16" onClick={(e) => { e.stopPropagation(); setCropAspectLock('9:16'); }}>9:16</button>
                          <button type="button" className="crop-aspect-btn" data-crop-aspect="16:9" onClick={(e) => { e.stopPropagation(); setCropAspectLock('16:9'); }}>16:9</button>
                          <button type="button" className="crop-aspect-btn" data-crop-aspect="4:3" onClick={(e) => { e.stopPropagation(); setCropAspectLock('4:3'); }}>4:3</button>
                          <button type="button" className="crop-aspect-btn" data-crop-aspect="3:4" onClick={(e) => { e.stopPropagation(); setCropAspectLock('3:4'); }}>3:4</button>
                          <span id="cropAspectHint" className="image-edit-sub"></span>
                      </div>
                      <div id="imageBrushTools" className="image-edit-tools">
                          <button className="image-edit-btn primary" type="button" data-brush-tool="free" onClick={(e) => { e.stopPropagation(); setBrushTool('free'); }} title="自由画笔"><i data-lucide="paintbrush" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" data-brush-tool="rect" onClick={(e) => { e.stopPropagation(); setBrushTool('rect'); }} title="矩形"><i data-lucide="square" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" data-brush-tool="ellipse" onClick={(e) => { e.stopPropagation(); setBrushTool('ellipse'); }} title="椭圆"><i data-lucide="circle" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" data-brush-tool="label" onClick={(e) => { e.stopPropagation(); setBrushTool('label'); }} title="角色编号标注"><i data-lucide="list-ordered" className="w-4 h-4"></i></button>
                          <label><span data-i18n="canvas.color">颜色</span> <input id="paintBrushColor" type="color" value="#ff2d55" /></label>
                          <label><span data-i18n="canvas.brushSize">笔刷</span> <input id="paintBrushSize" type="range" min={2} max={80} value={14} /></label>
                          <button id="brushUndoBtn" className="image-edit-btn secondary" type="button" onClick={(e) => { e.stopPropagation(); undoEditDrawing(); }} title="撤销"><i data-lucide="undo-2" className="w-4 h-4"></i></button>
                          <button id="brushRedoBtn" className="image-edit-btn secondary" type="button" onClick={(e) => { e.stopPropagation(); redoEditDrawing(); }} title="恢复"><i data-lucide="redo-2" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" onClick={(e) => { e.stopPropagation(); clearEditDrawing(); }}><i data-lucide="eraser" className="w-4 h-4"></i><span data-i18n="canvas.clear">清空</span></button>
                          <div id="annotationLabelPick" className="annotation-label-pick" style={{ display: "none" }} />
                          <button id="annotationRestoreBtn" className="image-edit-btn secondary" type="button" onClick={(e) => { e.stopPropagation(); restoreAnnotationBase(); }} title="恢复标注前的原图"><i data-lucide="rotate-ccw" className="w-4 h-4"></i><span>恢复原图</span></button>
                      </div>
                      <div id="imageEditStage" className="image-edit-stage">
                          <div className="image-edit-stage-inner">
                              <div id="cropCanvas" className="crop-canvas">
                                  <img id="cropImage" alt="crop source" />
                                  <canvas id="editDrawCanvas" className="edit-draw-canvas"></canvas>
                                  <div id="cropBox" className="crop-box">
                                      <div id="cropHandle" className="crop-handle"></div>
                                  </div>
                              </div>
                          </div>
                      </div>
                      <div className="image-edit-actions">
                          <span id="imageEditZoomLabel" style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800, padding: "0 4px", marginRight: "auto", cursor: "pointer", userSelect: "none" }} title="双击重置缩放" onDoubleClick={() => resetImageEditZoom()}>100%</span>
                          <button className="image-edit-btn secondary" type="button" onClick={() => resetCropBox()}><i data-lucide="rotate-ccw" className="w-4 h-4"></i><span data-i18n="canvas.reset">重置</span></button>
                          <button className="image-edit-btn secondary" type="button" onClick={() => closeImageEditor()} data-i18n="common.cancel">取消</button>
                          <button id="imageEditApplyBtn" className="image-edit-btn primary" type="button" onClick={() => applyImageEdit()}><i data-lucide="crop" className="w-4 h-4"></i><span data-i18n="canvas.applyCrop">应用裁剪</span></button>
                      </div>
                  </div>
              </div>
              <div id="errorModal" className="error-modal" onClick={() => canvasWin["closeErrorModal"]?.()}>
                  <div className="error-panel" onClick={(e) => e.stopPropagation()}>
                      <div className="error-head">
                          <div id="errorTitle" className="error-title" data-i18n="canvas.generationFailed">生成失败</div>
                          <button className="preview-icon-btn" type="button" title="关闭" aria-label="关闭" onClick={() => canvasWin["closeErrorModal"]?.()}><i data-lucide="x" className="w-4 h-4"></i></button>
                      </div>
                      <div id="errorMessage" className="error-message"></div>
                      <div className="error-actions">
                          <button className="error-btn" type="button" onClick={() => canvasWin["copyErrorMessage"]?.()}><i data-lucide="copy" className="w-4 h-4"></i><span>复制</span></button>
                          <button className="error-btn primary" type="button" onClick={() => canvasWin["closeErrorModal"]?.()}>关闭</button>
                      </div>
                  </div>
              </div>
          </div>
      
          
    </div>
  );
});
