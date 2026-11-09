// Read complete question illustrations, including images outside the viewport.
// Never substitute a partial screenshot or a text-only guess for a failed read.
(function () {
    function nodes(question) {
        const found = new Set<Element>();
        for (const region of [question.visualRegion, ...question.options.map(option => option.node)]) {
            if (!region) continue;
            const candidates = region.matches('img,svg,canvas') ? [region] : region.querySelectorAll('img,svg,canvas');
            for (const node of candidates) {
                if (node.closest('#assistant-root,nav,aside,button') || !node.getClientRects().length) continue;
                if (node.parentElement?.closest('svg')) continue;
                const width = node.naturalWidth || node.width?.baseVal?.value || Number(node.getAttribute('width'));
                const height = node.naturalHeight || node.height?.baseVal?.value || Number(node.getAttribute('height'));
                if (width > 0 && height > 0 && width <= 32 && height <= 32) continue;
                found.add(node);
            }
        }
        return [...found];
    }
    function source(node) {
        if (node.tagName.toLowerCase() === 'canvas') return node.toDataURL('image/png');
        if (node.tagName.toLowerCase() === 'svg') return new XMLSerializer().serializeToString(node);
        return node.currentSrc || node.src || node.getAttribute('src') || '';
    }
    function fingerprint(question) { return JSON.stringify(nodes(question).map(source)); }
    async function capture(question, sendMessage) {
        const visuals = nodes(question);
        if (visuals.length > 5) throw new Error('Question has more than five illustrations; review them manually.');
        const before = fingerprint(question);
        const images = [];
        for (const node of visuals) {
            let data = source(node);
            if (!data) throw new Error('Question illustration has not loaded. No answer was selected.');
            if (node.tagName.toLowerCase() === 'svg') data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
            else if (!data.startsWith('data:')) {
                const response = await sendMessage({action:'questionImage',url:new URL(data,location.href).href});
                if (!response?.dataUrl) throw new Error(response?.error || 'Question illustration could not be read.');
                data = response.dataUrl;
            }
            const picture = await new Promise<HTMLImageElement>((resolve,reject) => {
                const img = new Image();
                const timer = window.setTimeout(()=>{img.src='';reject(new Error('Question illustration loading timed out.'));},10000);
                img.onload=()=>{window.clearTimeout(timer);resolve(img);};
                img.onerror=()=>{window.clearTimeout(timer);reject(new Error('Question illustration could not be decoded.'));};
                img.src=data;
            });
            const canvas = document.createElement('canvas');
            const scale = Math.min(1,2400/Math.max(picture.naturalWidth,picture.naturalHeight));
            canvas.width=Math.max(1,Math.round(picture.naturalWidth*scale));
            canvas.height=Math.max(1,Math.round(picture.naturalHeight*scale));
            const context=canvas.getContext('2d');
            context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);
            context.drawImage(picture,0,0,canvas.width,canvas.height);
            // Keep chart labels and code crisp; the backend compresses once.
            images.push(canvas.toDataURL('image/png'));
        }
        if (before !== fingerprint(question)) throw new Error('Question illustration changed while loading. Please restart.');
        return {images,fingerprint:before};
    }
    async function requireBackend(apiRequest, imageCount = 1) {
        const health=await apiRequest('/health','GET');
        if (!health?.ok || health.data?.vision_question_context !== true) {
            throw new Error('Restart the Browser Assistant server to enable chart questions (build 2.6.50). No answer was selected.');
        }
        if (imageCount > 3 && health.data.vision_batching !== true) {
            throw new Error('Update and restart the Browser Assistant backend to enable all five images. No partial image request was sent.');
        }
    }

    async function reviewCapture(dataUrl: string, question): Promise<string | null> {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        const canvas = document.createElement('canvas');
        let x = 0, y = 0, width = image.naturalWidth, height = image.naturalHeight;
        // Crop only when every required region is present in the screenshot.
        const regions = [question?.visualRegion, ...(question?.options || []).map(option => option.node)];
        if (question?.visualRegion && regions.every(node => node?.getBoundingClientRect)) {
            const rects = regions.map(node => node.getBoundingClientRect());
            const left = Math.min(...rects.map(rect => rect.left)), right = Math.max(...rects.map(rect => rect.right));
            const top = Math.min(...rects.map(rect => rect.top)), bottom = Math.max(...rects.map(rect => rect.bottom));
            if (left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight && right > left && bottom > top) {
                x = left * width / innerWidth; y = top * height / innerHeight;
                width *= (right-left) / innerWidth; height *= (bottom-top) / innerHeight;
            }
        }
        const scale = Math.min(1, 2400 / Math.max(width,height));
        canvas.width = Math.max(1, Math.round(width*scale));
        canvas.height = Math.max(1, Math.round(height*scale));
        const context = canvas.getContext('2d');
        if (!context) throw Error('Screenshot preview is unavailable.');
        const reset = () => context.drawImage(image,x,y,width,height,0,0,canvas.width,canvas.height);
        reset();
        canvas.style.cssText = 'display:block;max-width:100%;max-height:60vh;object-fit:contain;touch-action:none;margin:8px auto';
        canvas.setAttribute('aria-label','Captured question preview. Drag over private areas to cover them.');
        const point = (event: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            return {x:(event.clientX-rect.left)*canvas.width/rect.width, y:(event.clientY-rect.top)*canvas.height/rect.height};
        };
        let start: {x:number;y:number};
        canvas.addEventListener('pointerdown', event => {
            if (!event.isTrusted) return;
            start = point(event);
            canvas.setPointerCapture(event.pointerId);
        });
        canvas.addEventListener('pointerup', event => {
            if (!event.isTrusted || !start) return;
            const end = point(event);
            context.fillStyle = '#000';
            context.fillRect(Math.min(start.x,end.x),Math.min(start.y,end.y),Math.abs(start.x-end.x),Math.abs(start.y-end.y));
            start = undefined;
        });
        canvas.addEventListener('pointercancel', () => {start = undefined;});
        return new Promise(resolve => {
            const host = document.createElement('div');
            const shadow = host.attachShadow({mode:'closed'});
            const dialog = document.createElement('dialog');
            dialog.setAttribute('aria-label','Review screenshot before sending');
            dialog.style.cssText = 'max-width:min(92vw,900px);color:#17233c;background:white;padding:16px;border:2px solid #5b39db;border-radius:10px;font:14px system-ui';
            const title = document.createElement('strong');
            title.textContent = 'Review screenshot before sending to the vision provider';
            const help = document.createElement('p');
            help.textContent = 'Drag over private information to cover it, or cancel and use Text Scan.';
            const finish = (value: string | null) => {clearTimeout(timeout); host.remove(); resolve(value);};
            const action = (label: string, fn: () => void) => {
                const button = document.createElement('button');
                button.type = 'button'; button.textContent = label;
                button.style.marginRight = '8px';
                button.addEventListener('click', event => {if (event.isTrusted) fn();});
                return button;
            };
            const cancel = action('Cancel', () => finish(null));
            dialog.append(title,help,canvas,cancel,action('Reset masks',reset),
                action('Send reviewed image',() => finish(canvas.toDataURL('image/png'))));
            dialog.addEventListener('cancel', event => {event.preventDefault(); finish(null);});
            shadow.appendChild(dialog);
            document.documentElement.appendChild(host);
            const timeout = setTimeout(() => finish(null),120000);
            dialog.showModal();
            cancel.focus();
        });
    }

    window.BrowserAssistantQuestionVisuals=Object.freeze({nodes,fingerprint,capture,requireBackend,reviewCapture});
})();
