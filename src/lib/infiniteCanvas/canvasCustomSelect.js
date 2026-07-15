/** Custom dark dropdown for canvas nodes; keeps native <select> for .value / .onchange / innerHTML. */

let openInstance = null;

export function closeAllCanvasCustomSelects() {
    if(!openInstance) return;
    openInstance.close();
    openInstance = null;
}

export function mountCanvasCustomSelect(selectEl) {
    if(!selectEl || selectEl.tagName !== 'SELECT') return null;
    if(selectEl.dataset.canvasCustomSelectMounted === '1') return selectEl.__canvasCustomSelect || null;
    selectEl.dataset.canvasCustomSelectMounted = '1';

    const host = document.createElement('div');
    host.className = 'canvas-custom-select';
    if(selectEl.style.cssText) host.style.cssText = selectEl.style.cssText;

    function syncHostClasses() {
        const hostManaged = new Set(['canvas-custom-select', 'is-open', 'is-disabled']);
        Array.from(selectEl.classList).forEach(cls => {
            if(cls === 'canvas-custom-select-native' || cls === 'select-lite') return;
            host.classList.add(cls);
        });
        Array.from(host.classList).forEach(cls => {
            if(hostManaged.has(cls) || cls === 'select-lite') return;
            if(!selectEl.classList.contains(cls)) host.classList.remove(cls);
        });
        if(selectEl.style.cssText !== host.style.cssText) host.style.cssText = selectEl.style.cssText;
    }

    function syncVisibility() {
        const hidden = Boolean(selectEl.hidden) || selectEl.classList.contains('is-hidden');
        host.classList.toggle('is-hidden', hidden);
        host.toggleAttribute('hidden', Boolean(selectEl.hidden));
        if(hidden) host.style.display = 'none';
        else host.style.removeProperty('display');
    }

    const parent = selectEl.parentNode;
    parent.insertBefore(host, selectEl);
    host.appendChild(selectEl);
    selectEl.classList.add('canvas-custom-select-native');
    selectEl.tabIndex = -1;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'canvas-custom-select-trigger select-lite';
    trigger.setAttribute('aria-haspopup', 'listbox');

    const label = document.createElement('span');
    label.className = 'canvas-custom-select-label';
    const chevron = document.createElement('span');
    chevron.className = 'canvas-custom-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(label, chevron);

    const menu = document.createElement('div');
    menu.className = 'canvas-custom-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    host.append(trigger, menu);

    const themeRoot = selectEl.closest('.infinite-canvas-root') || document.documentElement;
    const portalRoot = document.body;
    let activeIndex = -1;
    let outsideHandler = null;

    function syncMenuTheme(){
        const dark = themeRoot.classList.contains('theme-dark')
            || themeRoot.classList.contains('studio-theme-dark')
            || Boolean(selectEl.closest('.theme-dark'));
        menu.classList.toggle('canvas-custom-select-menu--dark', dark || menu.classList.contains('canvas-custom-select-menu-portal'));
    }

    function visibleOptions() {
        return Array.from(selectEl.options).filter(opt => !opt.hidden);
    }

    function selectedLabel() {
        const opt = selectEl.selectedOptions[0] || selectEl.options[0];
        return opt ? opt.textContent.trim() : '';
    }

    function syncDisabled() {
        trigger.disabled = Boolean(selectEl.disabled);
        host.classList.toggle('is-disabled', Boolean(selectEl.disabled));
        syncVisibility();
    }

    function rebuildMenu() {
        menu.innerHTML = '';
        const currentValue = selectEl.value;
        visibleOptions().forEach(opt => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'canvas-custom-select-option';
            item.setAttribute('role', 'option');
            item.dataset.value = opt.value;
            item.textContent = opt.textContent.trim();
            if(opt.disabled){
                item.disabled = true;
                item.classList.add('is-disabled');
            }
            if(opt.value === currentValue){
                item.classList.add('is-selected');
                item.setAttribute('aria-selected', 'true');
            } else {
                item.setAttribute('aria-selected', 'false');
            }
            item.onmousedown = e => e.stopPropagation();
            item.onclick = e => {
                e.stopPropagation();
                if(opt.disabled) return;
                pickValue(opt.value);
            };
            menu.appendChild(item);
        });
        label.textContent = selectedLabel();
        syncHostClasses();
        syncDisabled();
    }

    function pickValue(value) {
        if(selectEl.value !== value) selectEl.value = value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        close();
        rebuildMenu();
    }

    function detachOutside() {
        if(!outsideHandler) return;
        portalRoot.removeEventListener('mousedown', outsideHandler, true);
        outsideHandler = null;
    }

    function resetMenuPosition() {
        menu.style.position = '';
        menu.style.left = '';
        menu.style.top = '';
        menu.style.right = '';
        menu.style.width = '';
        menu.style.minWidth = '';
        menu.style.maxHeight = '';
        menu.style.zIndex = '';
    }

    function positionMenu() {
        const rect = trigger.getBoundingClientRect();
        const width = Math.max(rect.width, 160);
        menu.style.position = 'fixed';
        menu.style.left = `${rect.left}px`;
        menu.style.width = `${width}px`;
        menu.style.minWidth = `${rect.width}px`;
        menu.style.maxHeight = '220px';
        menu.style.zIndex = '10050';
        menu.style.top = `${rect.bottom + 6}px`;
        const overflow = rect.bottom + 6 + Math.min(menu.scrollHeight || 220, 220) - window.innerHeight;
        if(overflow > 0) menu.style.top = `${Math.max(8, rect.top - 6 - Math.min(menu.scrollHeight || 220, 220))}px`;
    }

    function close() {
        if(!host.classList.contains('is-open')) return;
        host.classList.remove('is-open');
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        activeIndex = -1;
        menu.querySelectorAll('.canvas-custom-select-option.is-active').forEach(el => el.classList.remove('is-active'));
        host.appendChild(menu);
        menu.classList.remove('canvas-custom-select-menu-portal');
        resetMenuPosition();
        detachOutside();
        if(openInstance === api) openInstance = null;
    }

    function open() {
        closeAllCanvasCustomSelects();
        rebuildMenu();
        host.classList.add('is-open');
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        openInstance = api;
        syncMenuTheme();
        portalRoot.appendChild(menu);
        menu.classList.add('canvas-custom-select-menu-portal');
        positionMenu();
        requestAnimationFrame(() => positionMenu());
        outsideHandler = e => {
            if(host.contains(e.target) || menu.contains(e.target)) return;
            close();
        };
        portalRoot.addEventListener('mousedown', outsideHandler, true);
    }

    function toggle() {
        if(trigger.disabled) return;
        if(host.classList.contains('is-open')) close();
        else open();
    }

    function highlightItem(items, index) {
        items.forEach((el, i) => el.classList.toggle('is-active', i === index));
        items[index]?.scrollIntoView({ block: 'nearest' });
    }

    trigger.onmousedown = e => e.stopPropagation();
    trigger.onclick = e => {
        e.stopPropagation();
        toggle();
    };
    trigger.onkeydown = e => {
        e.stopPropagation();
        const items = Array.from(menu.querySelectorAll('.canvas-custom-select-option:not(.is-disabled):not([disabled])'));
        if(e.key === 'Escape'){ close(); return; }
        if(e.key === 'Enter' || e.key === ' '){
            e.preventDefault();
            toggle();
            return;
        }
        if(!host.classList.contains('is-open')){
            if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
                e.preventDefault();
                open();
                activeIndex = Math.max(0, items.findIndex(el => el.classList.contains('is-selected')));
                highlightItem(items, activeIndex);
            }
            return;
        }
        if(e.key === 'ArrowDown'){
            e.preventDefault();
            activeIndex = Math.min(items.length - 1, activeIndex + 1);
            highlightItem(items, activeIndex);
        } else if(e.key === 'ArrowUp'){
            e.preventDefault();
            activeIndex = Math.max(0, activeIndex - 1);
            highlightItem(items, activeIndex);
        } else if(e.key === 'Enter'){
            e.preventDefault();
            const item = items[activeIndex >= 0 ? activeIndex : 0];
            if(item) pickValue(item.dataset.value || '');
        }
    };

    const observer = new MutationObserver(() => rebuildMenu());
    observer.observe(selectEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'class'] });
    selectEl.addEventListener('change', rebuildMenu);

    rebuildMenu();

    const api = {
        close,
        refresh: rebuildMenu,
        destroy(){
            observer.disconnect();
            close();
            selectEl.classList.remove('canvas-custom-select-native');
            delete selectEl.dataset.canvasCustomSelectMounted;
            delete selectEl.__canvasCustomSelect;
            host.replaceWith(selectEl);
        },
    };
    selectEl.__canvasCustomSelect = api;
    return api;
}

export function mountCanvasCustomSelects(root, selector = 'select.select-lite') {
    if(!root) return;
    root.querySelectorAll(selector).forEach(el => {
        // 跳过刻意隐藏的备份 select，避免幽灵下拉挡住点击
        if(el.hidden || el.classList.contains('is-hidden') || el.classList.contains('gen-dock-hidden-select')) return;
        mountCanvasCustomSelect(el);
    });
}
