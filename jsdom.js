/**
 * JSDOM
 * @description A simple DOM manipulation library for JavaScript with reactive support.
 * @version 0.3
 * @author CKylinMC
 */

var jsdom = (function (window = window, document = document) {
    let currentDependencies = null;
    let currentRenderContext = null; // DOMTree instance for template/condition functions
    const __elToDomTreeSet = new WeakMap();
    let __scopeIdCounter = 0;

    function __genScopeClass() {
        __scopeIdCounter += 1;
        return `jsd-${__scopeIdCounter.toString(36)}`;
    }

    function __toKebabCase(prop) {
        return prop
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .replace(/^ms-/, '-ms-')
            .toLowerCase();
    }

    function __cssObjectToString(obj, indent = '') {
        const lines = [];
        Object.entries(obj || {}).forEach(([selector, value]) => {
            // Check if it's @self - treat it as a regular selector, not an at-rule
            const isSelfSelector = selector === '@self' || selector.startsWith('@self:') || selector.startsWith('@self::') || selector.startsWith('@self.');
            
            if (selector.startsWith('@') && !isSelfSelector) {
                // Real at-rules like @media, @keyframes, etc.
                if (typeof value === 'string') {
                    lines.push(`${indent}${selector}{${value}}`);
                } else if (typeof value === 'object') {
                    lines.push(`${indent}${selector}{`);
                    lines.push(__cssObjectToString(value, indent + '  '));
                    lines.push(`${indent}}`);
                }
            } else if (typeof value === 'object') {
                // Regular selector or @self with object value
                const decls = Object.entries(value)
                    .filter(([, v]) => v !== null && typeof v !== 'undefined' && v !== false)
                    .map(([k, v]) => `${indent}  ${__toKebabCase(k)}: ${String(v)};`)
                    .join('\n');
                lines.push(`${indent}${selector}{`);
                if (decls) lines.push(decls);
                lines.push(`${indent}}`);
            } else if (typeof value === 'string') {
                lines.push(`${indent}${selector}{${value}}`);
            }
        });
        return lines.join('\n');
    }

    function __stripComments(css) {
        return String(css).replace(/\/\*[\s\S]*?\*\//g, '');
    }

    function __findMatchingBrace(str, start) {
        let depth = 0;
        for (let i = start; i < str.length; i++) {
            const ch = str[i];
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) return i;
            }
        }
        return -1;
    }

    function __prefixSelectorsBlock(selectorsText, prefix) {
        // split by commas not inside brackets/quotes
        const sels = [];
        let buf = '';
        let depthParen = 0, depthBracket = 0;
        let inStr = false, strCh = '';
        const push = () => { const s = buf.trim(); if (s) sels.push(s); buf = ''; };
        for (let i = 0; i < selectorsText.length; i++) {
            const c = selectorsText[i];
            if (inStr) {
                buf += c;
                if (c === strCh && selectorsText[i - 1] !== '\\') { inStr = false; }
                continue;
            }
            if (c === '"' || c === '\'') { inStr = true; strCh = c; buf += c; continue; }
            if (c === '(') { depthParen++; buf += c; continue; }
            if (c === ')') { depthParen--; buf += c; continue; }
            if (c === '[') { depthBracket++; buf += c; continue; }
            if (c === ']') { depthBracket--; buf += c; continue; }
            if (c === ',' && depthParen === 0 && depthBracket === 0) { push(); continue; }
            buf += c;
        }
        push();
        const prefixed = sels.map(s => {
            const t = s.trim();
            if (!t) return '';
            
            // Check if @self appears anywhere in the selector
            if (t.includes('@self')) {
                // Replace @self with the prefix class
                // Handle different cases:
                // - @self alone or with pseudo-classes/elements: @self, @self:hover, @self::before
                // - @self with class/id/attr: @self.active, @self#id, @self[attr]
                // - @self in compound selectors: body.dark @self, @self > div, .parent @self:hover
                
                let result = t;
                
                // Replace @self followed by pseudo-classes, pseudo-elements, classes, ids, or attributes
                // Pattern: @self followed by (::, :, ., #, [, or whitespace/end)
                result = result.replace(/@self(::?[a-zA-Z-]+|\.[a-zA-Z_-][a-zA-Z0-9_-]*|#[a-zA-Z_-][a-zA-Z0-9_-]*|\[[^\]]+\])?/g, 
                    (match, suffix) => `.${prefix}${suffix || ''}`
                );
                
                return result;
            }
            
            // do not prefix :root globally; simply scope it to prefix itself
            if (t === ':root') return `.${prefix}`;
            // If selector already includes the prefix, keep it
            if (t.includes(`.${prefix}`)) return t;
            // handle html/body special-case: keep structure
            return `.${prefix} ${t}`;
        }).filter(Boolean);
        return prefixed.join(',');
    }

    function __scopeCSSText(cssText, prefixClass) {
        const css = __stripComments(cssText);
        let i = 0;
        const len = css.length;
        let out = '';
        while (i < len) {
            // skip whitespace
            while (i < len && /\s/.test(css[i])) { out += css[i]; i++; }
            if (i >= len) break;

            if (css[i] === '@') {
                const start = i;
                // read at-rule name
                let nameEnd = i;
                while (nameEnd < len && /[^\s\{;]/.test(css[nameEnd])) nameEnd++;
                const atRuleName = css.slice(i, nameEnd).toLowerCase();
                
                // Check if it's @self - treat as normal selector, not at-rule
                const isSelfSelector = atRuleName === '@self' || atRuleName.startsWith('@self:') || 
                                      atRuleName.startsWith('@self::') || atRuleName.startsWith('@self.');
                
                if (isSelfSelector) {
                    // Treat @self as a normal selector
                    let selEnd = nameEnd;
                    while (selEnd < len && css[selEnd] !== '{') selEnd++;
                    if (selEnd >= len) { out += css.slice(i); break; }
                    const selectorsText = css.slice(i, selEnd).trim();
                    const blockStart = selEnd;
                    const blockEnd = __findMatchingBrace(css, blockStart);
                    if (blockEnd === -1) { out += css.slice(i); break; }
                    const prefixedSelectors = __prefixSelectorsBlock(selectorsText, prefixClass);
                    const decls = css.slice(blockStart + 1, blockEnd);
                    out += `${prefixedSelectors}{${decls}}`;
                    i = blockEnd + 1;
                    continue;
                }
                
                // read through to next '{' or ';'
                let j = nameEnd;
                while (j < len && css[j] !== '{' && css[j] !== ';') j++;
                if (j >= len) { out += css.slice(i); break; }
                if (css[j] === ';') {
                    // e.g. @import ...;
                    out += css.slice(i, j + 1);
                    i = j + 1;
                    continue;
                }
                // it's a block at-rule: @media/@supports/@keyframes/...
                const blockStart = j;
                const blockEnd = __findMatchingBrace(css, blockStart);
                if (blockEnd === -1) { out += css.slice(i); break; }
                const header = css.slice(start, blockStart + 1); // includes '{'
                const inner = css.slice(blockStart + 1, blockEnd);
                if (/^@keyframes|^@font-face|^@page|^@counter-style/.test(atRuleName)) {
                    // keep inner as-is for animation/font/page
                    out += header + inner + '}';
                } else {
                    out += header + __scopeCSSText(inner, prefixClass) + '}';
                }
                i = blockEnd + 1;
            } else {
                // normal ruleset
                let selEnd = i;
                while (selEnd < len && css[selEnd] !== '{') selEnd++;
                if (selEnd >= len) { out += css.slice(i); break; }
                const selectorsText = css.slice(i, selEnd).trim();
                const blockStart = selEnd;
                const blockEnd = __findMatchingBrace(css, blockStart);
                if (blockEnd === -1) { out += css.slice(i); break; }
                const prefixedSelectors = __prefixSelectorsBlock(selectorsText, prefixClass);
                const decls = css.slice(blockStart + 1, blockEnd);
                out += `${prefixedSelectors}{${decls}}`;
                i = blockEnd + 1;
            }
        }
        return out;
    }

    function __registerInstance(el, inst) {
        let set = __elToDomTreeSet.get(el);
        if (!set) {
            set = new Set();
            __elToDomTreeSet.set(el, set);
        }
        set.add(inst);
    }

    function __unregisterInstance(el, inst) {
        const set = __elToDomTreeSet.get(el);
        if (set) {
            set.delete(inst);
            if (set.size === 0) __elToDomTreeSet.delete(el);
        }
    }

    class Reactive {
        #_value = undefined;
        #subscribers = [];

        constructor(value) {
            this.#_value = value;
        }

        get value() {
            if (currentDependencies) {
                currentDependencies.add(this);
            }
            return this.#_value;
        }

        set value(value) {
            if (this.#_value !== value) {
                this.#_value = value;
                this.#subscribers.forEach(subscriber => subscriber(value));
            }
        }

        subscribe(subscriber) {
            this.#subscribers.push(subscriber);
            return () => this.#subscribers = this.#subscribers.filter(s => s !== subscriber);
        }

        update(updater) {
            this.value = updater(this.value);
        }

        set(value) {
            this.value = value;
        }

        static of(value) {
            return new Reactive(value);
        }
    }


    class Computed extends Reactive {
        #compute;
        #dependencies = new Set();
        #unsubscribers = [];

        constructor(compute) {
            super();
            this.#compute = compute;
            this.#recompute();
        }

        #recompute() {
            this.#unsubscribers.forEach(unsub => unsub());
            this.#unsubscribers = [];
            this.#dependencies.clear();

            const prevDeps = currentDependencies;
            currentDependencies = this.#dependencies;

            try {
                const newValue = this.#compute();
                super.value = newValue;
            } finally {
                currentDependencies = prevDeps;
            }

            this.#dependencies.forEach(dep => {
                const unsub = dep.subscribe(() => this.#recompute());
                this.#unsubscribers.push(unsub);
            });
        }

        get value() {
            return super.value;
        }

        set value(val) {
            throw new Error('Cannot set value of computed reactive');
        }
    }

    const _ = function (value) {
        return Reactive.of(value);
    };

    const computed = function (compute) {
        return new Computed(compute);
    };

    const effect = function (fn) {
        const dependencies = new Set();
        const unsubscribers = [];

        const run = () => {
            unsubscribers.forEach(unsub => unsub());
            unsubscribers.length = 0;
            dependencies.clear();

            const prevDeps = currentDependencies;
            currentDependencies = dependencies;

            try {
                fn();
            } finally {
                currentDependencies = prevDeps;
            }

            dependencies.forEach(dep => {
                const unsub = dep.subscribe(() => run());
                unsubscribers.push(unsub);
            });
        };

        run();

        return () => {
            unsubscribers.forEach(unsub => unsub());
        };
    };

    class DOMTree {
        #dom;
        #scopeClass = null;
        #stateReactives = new Map();
        #stateProxy = null;
        #reactive = {};
        #lifecycle = {
            onMount: [],
            beforeUnmount: []
        };
        #observer = null;
        #eventListeners = [];
        #mounted = false;
        #scopedStyleEl = null;

        constructor(tagname, ...args) {
            if (typeof tagname === 'string') {
                this.#dom = document.createElement(tagname);
                this.#processArgs(args);
            } else if (tagname instanceof HTMLElement) {
                this.#dom = tagname;
            } else if (tagname instanceof DOMTree) {
                this.#dom = tagname.dom;
            } else if (Array.isArray(tagname)) {
                // const fragment = document.createDocumentFragment();
                this.#dom = document.createElement('div'); // temporary container
                this.append(...tagname);
                return this;
            } else {
                throw new Error('Invalid arguments for DOMTree constructor');
            }

            this.#ensureScopeClass();
            this.#setupLifecycleObserver();
            __registerInstance(this.#dom, this);
        }

        #ensureScopeClass() {
            // Reuse existing scope if present
            const existing = this.#dom.dataset ? this.#dom.dataset.jsdomScope : null;
            const scope = existing || __genScopeClass();
            this.#scopeClass = scope;
            try { this.#dom.classList.add(scope); } catch (_) {
                this.#dom.setAttribute('class', `${(this.#dom.getAttribute('class') || '').trim()} ${scope}`.trim());
            }
            try { this.#dom.dataset.jsdomScope = scope; } catch (_) {}
        }

        #setupLifecycleObserver() {
            this.#observer = new MutationObserver(() => {
                const isInDOM = document.body.contains(this.#dom);
                if (isInDOM && !this.#mounted) {
                    this.#mounted = true;
                    this.#lifecycle.onMount.forEach(cb => cb.call(this, this));
                } else if (!isInDOM && this.#mounted) {
                    this.#mounted = false;
                    this.#lifecycle.beforeUnmount.forEach(cb => cb.call(this, this));
                }
            });

            const startObserving = () => {
                if (this.#dom.parentNode) {
                    this.#observer.observe(this.#dom.parentNode, {
                        childList: true,
                        subtree: true
                    });
                }
            };

            if (document.body.contains(this.#dom)) {
                this.#mounted = true;
                this.#lifecycle.onMount.forEach(cb => cb.call(this, this));
            }

            // 直接开始观察（若当前已有父节点），并存下重启观察函数供迁移后调用
            startObserving();
            this.#reactive._startObserver = startObserving;
        }

        #processArgs(args) {
            args.forEach(arg => {
                if (arg === null || arg === undefined) {
                    return;
                } else if (typeof arg === 'function' && !(arg instanceof Reactive)) {
                    this.append(arg);
                } else if (arg && typeof arg === 'object' && !Array.isArray(arg) &&
                    !(arg instanceof DOMTree) && !(arg instanceof HTMLElement) &&
                    !(arg instanceof Reactive) && !(arg instanceof Text)) {
                    this.props(arg);
                } else {
                    this.append(arg);
                }
            });
        }

        #createReactiveNode(reactive) {
            const textNode = document.createTextNode(reactive.value);
            const unsub = reactive.subscribe((value) => {
                textNode.textContent = value;
            });
            this.#reactive.textSubs = this.#reactive.textSubs || [];
            this.#reactive.textSubs.push(unsub);
            return textNode;
        }

        append(...children) {
            children.filter(child => typeof child !== 'undefined' && child !== null).forEach(child => {
                if (child instanceof Reactive || child instanceof Computed) {
                    this.#dom.appendChild(this.#createReactiveNode(child));
                } else if (child instanceof DOMTree) {
                    this.#dom.appendChild(child.dom);
                } else if (child instanceof HTMLElement) {
                    this.#dom.appendChild(child);
                } else if (child instanceof Text) {
                    this.#dom.appendChild(child);
                } else if (child instanceof DocumentFragment) {
                    this.#dom.appendChild(child);
                } else if (Array.isArray(child)) {
                    this.append(...child);
                } else if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') {
                    this.#dom.appendChild(document.createTextNode(child.toString()));
                } else if (typeof child === 'function') {
                    this.#appendReactiveFunction(child);
                } else if (child && typeof child.appendTo === 'function') {
                    child.appendTo(this);
                } else {
                    console.warn('Unknown child type:', child);
                    this.#dom.appendChild(document.createTextNode(String(child)));
                }
            });
            return this;
        }

        #appendReactiveFunction(fn) {
            const placeholder = document.createComment('reactive-function');
            this.#dom.appendChild(placeholder);

            let currentNodes = [];
            const cleanup = effect(() => {
                currentNodes.forEach(node => node.remove());
                currentNodes = [];
                const prevCtx = currentRenderContext;
                currentRenderContext = this;
                let result;
                try {
                    // Bind this and also pass context as first argument
                    result = fn.call(this, this);
                } finally {
                    currentRenderContext = prevCtx;
                }
                const nodes = this.#resultToNodes(result);

                nodes.forEach(node => {
                    placeholder.parentNode.insertBefore(node, placeholder);
                    currentNodes.push(node);
                });
            });

            this.#reactive.functions = this.#reactive.functions || [];
            this.#reactive.functions.push(cleanup);
        }

        #resultToNodes(result) {
            if (result === null || result === undefined) {
                return [];
            } else if (result instanceof DOMTree) {
                return [result.dom];
            } else if (result instanceof HTMLElement || result instanceof Text) {
                return [result];
            } else if (Array.isArray(result)) {
                return result.flatMap(item => this.#resultToNodes(item));
            } else if (result instanceof Reactive || result instanceof Computed) {
                const textNode = this.#createReactiveNode(result);
                return [textNode];
            } else {
                return [document.createTextNode(String(result))];
            }
        }

        replaceChilds(...children) {
            // Cascade unmount all child DOMTree instances first
            this.#cascadeUnmountChildren();
            if (this.#reactive) {
                if (typeof this.#reactive.value === 'function') { try { this.#reactive.value(); } catch(_){} }
                if (Array.isArray(this.#reactive.functions)) { this.#reactive.functions.forEach(fn => { try { fn(); } catch(_){} }); this.#reactive.functions = []; }
                if (Array.isArray(this.#reactive.textSubs)) { this.#reactive.textSubs.forEach(unsub => { try { unsub(); } catch(_){} }); this.#reactive.textSubs = []; }
                if (Array.isArray(this.#reactive.effects)) { this.#reactive.effects.forEach(stop => { try { stop(); } catch(_){} }); this.#reactive.effects = []; }
            }
            this.#dom.innerHTML = '';
            return this.append(...children);
        }

        mount(...children) {
            return this.replaceChilds(...children);
        }

        mountTo(parent) {
            if (this.#mounted) {
                // clean previous side effects before moving
                this.unmount();
            }
            if (parent instanceof DOMTree) {
                parent.dom.appendChild(this.#dom);
            } else if (parent instanceof HTMLElement) {
                parent.appendChild(this.#dom);
            } else if (typeof parent === 'string') {
                document.querySelector(parent)?.appendChild(this.#dom);
            }
            if (this.#reactive && typeof this.#reactive._startObserver === 'function') {
                try { this.#reactive._startObserver(); } catch(_){}
            }
            this.#mounted = true;
            return this;
        }

        mountChilds(...children) {
            const fragment = document.createDocumentFragment();
            const tempContainer = document.createElement('div');

            children.forEach(child => {
                if (child instanceof Reactive) {
                    tempContainer.appendChild(this.#createReactiveNode(child));
                } else if (child instanceof DOMTree) {
                    tempContainer.appendChild(child.dom);
                } else if (child instanceof HTMLElement) {
                    tempContainer.appendChild(child);
                } else if (Array.isArray(child)) {
                    child.forEach(c => this.mountChilds(c));
                } else {
                    tempContainer.appendChild(document.createTextNode(String(child)));
                }
            });

            while (tempContainer.firstChild) {
                fragment.appendChild(tempContainer.firstChild);
            }

            this.#dom.appendChild(fragment);
            return this;
        }

        text(innerText = '') {
            if (innerText instanceof Reactive) {
                this.#dom.textContent = innerText.value;
                const unsubscribe = innerText.subscribe((value) => {
                    this.#dom.textContent = value;
                });
                this.#reactive.text = unsubscribe;
            } else {
                this.#dom.textContent = innerText;
            }
            return this;
        }

        html(innerHTML = '') {
            this.#dom.innerHTML = innerHTML;
            return this;
        }

        css(css = {}) {
            Object.assign(this.#dom.style, css);
            return this;
        }

        cssText(cssText = '', append = false) {
            if (append) {
                this.#dom.style.cssText += cssText;
            } else {
                this.#dom.style.cssText = cssText;
            }
            return this;
        }

        appendTo(parent) {
            if (this.#mounted) {
                // clean previous side effects before moving
                this.unmount();
            }
            if (parent instanceof DOMTree) {
                parent.dom.appendChild(this.#dom);
            } else if (parent instanceof HTMLElement) {
                parent.appendChild(this.#dom);
            } else if (typeof parent === 'string') {
                document.querySelector(parent)?.appendChild(this.#dom);
            }
            if (this.#reactive && typeof this.#reactive._startObserver === 'function') {
                try { this.#reactive._startObserver(); } catch(_){}
            }
            return this;
        }

        props(props = {}) {
            if (!props || typeof props !== 'object') return this;
            const pendingScoped = [];
            const pendingSetup = [];

            // First pass: initialize state if provided
            if (Object.prototype.hasOwnProperty.call(props, 'state')) {
                const s = props.state;
                if (s && typeof s === 'object' && !Array.isArray(s)) {
                    Object.entries(s).forEach(([k, v]) => {
                        try {
                            this.state[k] = (typeof v === 'function') ? v() : v;
                        } catch (_) {
                            this.state[k] = v;
                        }
                    });
                }
            }

            // Second pass: handle other props, queue scopedcss and setup to apply after base props
            Object.entries(props).forEach(([key, value]) => {
                if (key === 'state') {
                    // already handled
                    return;
                }
                if (key === 'style' && value && typeof value === 'object') {
                    this.css(value);
                    return;
                }
                if (key === 'class') {
                    // Support reactive class attribute
                    if (typeof value === 'function') {
                        const updateClass = () => {
                            const result = value.call(this, this);
                            this.setClass(result);
                        };
                        const stop = effect(updateClass);
                        this.registerEffectCleanup(stop);
                    } else if (value instanceof Reactive || value instanceof Computed) {
                        const updateClass = () => {
                            this.setClass(value.value);
                        };
                        const stop = effect(updateClass);
                        this.registerEffectCleanup(stop);
                    } else {
                        this.setClass(value);
                    }
                    return;
                }
                if (key === 'value') {
                    // Support reactive value attribute
                    if (typeof value === 'function') {
                        const updateValue = () => {
                            const result = value.call(this, this);
                            this.value(result);
                        };
                        const stop = effect(updateValue);
                        this.registerEffectCleanup(stop);
                    } else if (value instanceof Reactive || value instanceof Computed) {
                        const updateValue = () => {
                            this.value(value.value);
                        };
                        const stop = effect(updateValue);
                        this.registerEffectCleanup(stop);
                    } else {
                        this.value(value);
                    }
                    return;
                }
                if (key === 'attr' && value && typeof value === 'object') {
                    // Support attr object with reactive values
                    Object.entries(value).forEach(([attrName, attrValue]) => {
                        if (typeof attrValue === 'function') {
                            const updateAttr = () => {
                                const result = attrValue.call(this, this);
                                this.set(attrName, result);
                            };
                            const stop = effect(updateAttr);
                            this.registerEffectCleanup(stop);
                        } else if (attrValue instanceof Reactive || attrValue instanceof Computed) {
                            const updateAttr = () => {
                                this.set(attrName, attrValue.value);
                            };
                            const stop = effect(updateAttr);
                            this.registerEffectCleanup(stop);
                        } else {
                            this.set(attrName, attrValue);
                        }
                    });
                    return;
                }
                if (key === 'setup') {
                    // Queue setup function to run after all props are set
                    if (typeof value === 'function') {
                        pendingSetup.push(value);
                    }
                    return;
                }
                if (key === 'onMount') {
                    // Add to lifecycle hooks
                    if (typeof value === 'function') {
                        this.onMount(value);
                    }
                    return;
                }
                if (key === 'beforeUnmount') {
                    // Add to lifecycle hooks
                    if (typeof value === 'function') {
                        this.beforeUnmount(value);
                    }
                    return;
                }
                if (key === 'scopedcss') {
                    pendingScoped.push(value);
                    return;
                }
                if (typeof key === 'string' && key.startsWith('on')) {
                    const event = key.slice(2).toLowerCase();
                    this.on(event, value);
                    return;
                }
                this.set(key, value);
            });

            // Apply scopedcss definitions at the end to ensure state is ready
            if (pendingScoped.length) {
                pendingScoped.forEach(def => {
                    try { this.scopedcss(def); } catch (_) {}
                });
            }

            // Run setup functions last, after all props and state are initialized
            if (pendingSetup.length) {
                pendingSetup.forEach(fn => {
                    try { fn.call(this, this); } catch (e) { console.error('Setup error:', e); }
                });
            }

            return this;
        }

        on(event, handler) {
            this.#dom.addEventListener(event, handler);
            this.#eventListeners.push({ event, handler });
            return this;
        }

        off(event, handler) {
            this.#dom.removeEventListener(event, handler);
            this.#eventListeners = this.#eventListeners.filter(e => !(e.event === event && e.handler === handler));
            return this;
        }

        set(name, value) {
            if (name === 'checked') {
                const boolVal = !!value;
                this.#dom.checked = boolVal;
                if (boolVal) {
                    this.#dom.setAttribute('checked', '');
                } else {
                    this.#dom.removeAttribute('checked');
                }
                return this;
            }

            if (name === 'value') {
                this.#dom.value = value ?? '';
                return this;
            }

            if (value === false || value === null || typeof value === 'undefined') {
                this.#dom.removeAttribute(name);
            } else {
                this.#dom.setAttribute(name, value);
            }
            return this;
        }

        get(name) {
            return this.#dom.getAttribute(name);
        }

        setClass(...classes) {
            const set = new Set(classes.filter(Boolean).map(String));
            // Always preserve scope class
            if (this.#scopeClass) set.add(this.#scopeClass);
            this.#dom.className = Array.from(set).join(' ');
            return this;
        }

        addClass(...names) {
            this.#dom.classList.add(...names);
            return this;
        }

        removeClass(...names) {
            // Prevent removing scope class
            const filtered = names.filter(n => n !== this.#scopeClass);
            if (filtered.length) this.#dom.classList.remove(...filtered);
            return this;
        }

        toggleClass(...names) {
            names.forEach(name => {
                if (name === this.#scopeClass) return;
                this.#dom.classList.toggle(name);
            });
            return this;
        }

        value(val, noreactive = false) {
            if (arguments.length === 0) {
                return this.getValue();
            }

            if (val instanceof Reactive && !noreactive) {
                this.bindValue(val);
            } else {
                const value = val instanceof Reactive ? val.value : val;
                if (this.#dom.type === 'checkbox' || this.#dom.type === 'radio') {
                    this.#dom.checked = value;
                } else {
                    this.#dom.value = value;
                }
            }
            return this;
        }

        getValue() {
            if (this.#dom.type === 'checkbox' || this.#dom.type === 'radio') {
                return this.#dom.checked;
            }
            return this.#dom.value;
        }

        bindValue(reactive) {
            if (!(reactive instanceof Reactive)) {
                throw new Error('bindValue requires a Reactive object');
            }

            this.value(reactive.value, true);

            const unsubscribe = reactive.subscribe((value) => {
                this.value(value, true);
            });

            const updateReactive = () => {
                reactive.value = this.getValue();
            };

            this.on('input', updateReactive);
            this.on('change', updateReactive);

            this.#reactive.value = () => {
                unsubscribe();
                this.off('input', updateReactive);
                this.off('change', updateReactive);
            };

            return this;
        }

        onMount(callback) {
            this.#lifecycle.onMount.push(callback);
            if (this.#mounted) {
                callback(); // Call immediately if already mounted
            }
            return this;
        }

        beforeUnmount(callback) {
            this.#lifecycle.beforeUnmount.push(callback);
            return this;
        }

        registerEffectCleanup(fn) {
            this.#reactive.effects = this.#reactive.effects || [];
            this.#reactive.effects.push(fn);
            return this;
        }

        #cascadeUnmountChildren() {
            const visited = new Set();
            const els = this.#dom.querySelectorAll('*');
            els.forEach(el => {
                const set = __elToDomTreeSet.get(el);
                if (set && set.size) {
                    set.forEach(inst => {
                        if (inst !== this && !visited.has(inst)) {
                            visited.add(inst);
                            try { inst.unmount(); } catch(_){}
                        }
                    });
                }
            });
        }

        unmount() {
            if (this.#mounted) {
                this.#mounted = false;
                this.#lifecycle.beforeUnmount.forEach(cb => {
                    try { cb.call(this, this); } catch (_) {}
                });
            }
            // First cascade to children
            this.#cascadeUnmountChildren();
            // remove event listeners
            if (this.#eventListeners && this.#eventListeners.length) {
                this.#eventListeners.forEach(({ event, handler }) => {
                    try { this.#dom.removeEventListener(event, handler); } catch (_) {}
                });
                this.#eventListeners = [];
            }
            // cleanup reactive pieces
            if (this.#reactive) {
                if (typeof this.#reactive.value === 'function') { try { this.#reactive.value(); } catch(_){} delete this.#reactive.value; }
                if (Array.isArray(this.#reactive.functions)) { this.#reactive.functions.forEach(fn => { try { fn(); } catch(_){} }); this.#reactive.functions = []; }
                if (Array.isArray(this.#reactive.textSubs)) { this.#reactive.textSubs.forEach(unsub => { try { unsub(); } catch(_){} }); this.#reactive.textSubs = []; }
                if (Array.isArray(this.#reactive.effects)) { this.#reactive.effects.forEach(stop => { try { stop(); } catch(_){} }); this.#reactive.effects = []; }
            }
            // disconnect observer
            if (this.#observer) {
                try { this.#observer.disconnect(); } catch (_) {}
            }
            // unregister mapping to avoid retention
            __unregisterInstance(this.#dom, this);
            return this;
        }

        if(condition, thenContent, elseContent = null) {
            this.append(() => {
                const ctx = this;
                const cond = condition instanceof Reactive ? condition.value : (typeof condition === 'function' ? condition.call(ctx, ctx) : condition);
                const resolve = (c) => typeof c === 'function' ? c.call(ctx, ctx) : c;
                return cond ? resolve(thenContent) : resolve(elseContent);
            });
            return this;
        }

        show(condition) {
            if (condition instanceof Reactive) {
                effect(() => {
                    this.#dom.style.display = condition.value ? '' : 'none';
                });
            } else {
                this.#dom.style.display = condition ? '' : 'none';
            }
            return this;
        }

        for(items, renderFn) {
            this.append(() => {
                const itemsArray = items instanceof Reactive ? items.value : items;
                if (!Array.isArray(itemsArray)) return null;
                return itemsArray.map((item, index) => renderFn.call(this, item, index, this));
            });
            return this;
        }

        get dom() { return this.#dom; }
        get tagname() { return this.#dom.tagName.toLowerCase(); }
        get style() { return this.#dom.style; }
        get classList() { return this.#dom.classList; }
        get className() { return this.#dom.className; }
        set className(value) {
            const v = String(value || '');
            if (this.#scopeClass && !new RegExp(`(^|\\s)${this.#scopeClass}(?=$|\\s)`).test(v)) {
                this.#dom.className = (v + ' ' + this.#scopeClass).trim();
            } else {
                this.#dom.className = v;
            }
        }
        get id() { return this.#dom.id; }
        set id(value) { this.#dom.id = value; }
        get innerHTML() { return this.#dom.innerHTML; }
        set innerHTML(value) { this.#dom.innerHTML = value; }
        get innerText() { return this.#dom.innerText; }
        set innerText(value) { this.#dom.innerText = value; }
        get textContent() { return this.#dom.textContent; }
        set textContent(value) { this.#dom.textContent = value; }
        get children() { return this.#dom.children; }

        get state() {
            if (!this.#stateProxy) {
                const self = this;
                this.#stateProxy = new Proxy({}, {
                    get(_, prop) {
                        const key = String(prop);
                        if (!self.#stateReactives.has(key)) return undefined;
                        return self.#stateReactives.get(key).value;
                    },
                    set(_, prop, value) {
                        const key = String(prop);
                        let r = self.#stateReactives.get(key);
                        if (!r) {
                            r = Reactive.of(value);
                            // Keep underlying state in sync with reactive changes
                            r.subscribe(v => {
                                // no-op: proxy reads from reactive directly
                            });
                            self.#stateReactives.set(key, r);
                        } else {
                            r.value = value;
                        }
                        return true;
                    },
                    has(_, prop) {
                        return self.#stateReactives.has(String(prop));
                    },
                    deleteProperty(_, prop) {
                        const key = String(prop);
                        return self.#stateReactives.delete(key);
                    },
                    ownKeys() {
                        return Array.from(self.#stateReactives.keys());
                    },
                    getOwnPropertyDescriptor() {
                        return { enumerable: true, configurable: true };
                    }
                });
            }
            return this.#stateProxy;
        }

        useState(nameOrInit, maybeInit) {
            let key;
            let initVal;
            if (typeof nameOrInit === 'string') {
                key = nameOrInit;
                initVal = maybeInit;
            } else {
                key = `_s${this.#stateReactives.size}`;
                initVal = nameOrInit;
            }

            if (!this.#stateReactives.has(key)) {
                const initial = initVal instanceof Function ? initVal() : initVal;
                const r = Reactive.of(initial);
                // Keep proxy readable; writes go through reactive
                r.subscribe(() => {});
                this.#stateReactives.set(key, r);
            }
            return this.#stateReactives.get(key);
        }

        scopedcss(definition) {
            this.#ensureScopeClass();
            if (!this.#scopedStyleEl || this.#scopedStyleEl.parentNode !== this.#dom) {
                this.#scopedStyleEl = document.createElement('style');
                this.#scopedStyleEl.type = 'text/css';
                this.#scopedStyleEl.setAttribute('data-jsdom-scoped', '');
                try {
                    this.#dom.insertBefore(this.#scopedStyleEl, this.#dom.firstChild);
                } catch (_) {
                    this.#dom.appendChild(this.#scopedStyleEl);
                }
            }

            // Cleanup previous scopedcss effect
            if (this.#reactive._scopedcss && typeof this.#reactive._scopedcss.stop === 'function') {
                try { this.#reactive._scopedcss.stop(); } catch (_) {}
                this.#reactive._scopedcss = null;
            }

            const applyText = (text) => {
                const scoped = __scopeCSSText(String(text || ''), this.#scopeClass);
                this.#scopedStyleEl.textContent = scoped;
            };

            const applyObject = (obj) => {
                const raw = __cssObjectToString(obj || {});
                const scoped = __scopeCSSText(raw, this.#scopeClass);
                this.#scopedStyleEl.textContent = scoped;
            };

            const handle = (val) => {
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                    applyObject(val);
                } else {
                    applyText(val);
                }
            };

            if (typeof definition === 'function') {
                const run = () => {
                    const prevCtx = currentRenderContext;
                    currentRenderContext = this;
                    let res;
                    try { res = definition.call(this, this); }
                    finally { currentRenderContext = prevCtx; }
                    handle(res);
                };
                const stop = effect(run);
                this.#reactive._scopedcss = { stop };
                this.registerEffectCleanup(stop);
            } else if (definition instanceof Reactive || definition instanceof Computed) {
                const stop = effect(() => handle(definition.value));
                this.#reactive._scopedcss = { stop };
                this.registerEffectCleanup(stop);
            } else {
                handle(definition);
            }

            return this;
        }
    }


    const h = function (...args) {
        if (args.length === 1 && Array.isArray(args[0])) {
            const fragment = document.createDocumentFragment();
            args[0].forEach(item => {
                if (item instanceof DOMTree) {
                    fragment.appendChild(item.dom);
                } else if (item instanceof HTMLElement) {
                    fragment.appendChild(item);
                } else if (item instanceof Reactive) {
                    const textNode = document.createTextNode(item.value);
                    item.subscribe((value) => {
                        textNode.textContent = value;
                    });
                    fragment.appendChild(textNode);
                }
            });

            return {
                appendTo(parent) {
                    if (parent instanceof DOMTree) {
                        parent.dom.appendChild(fragment);
                    } else if (parent instanceof HTMLElement) {
                        parent.appendChild(fragment);
                    }
                },
                dom: fragment
            };
        }
        return new DOMTree(...args);
    };

    const html = function (strings, ...values) {
        const createTemplate = (boundCtx = null) => {
            let htmlString = '';
            const reactiveIndices = [];
            strings.forEach((str, i) => {
                htmlString += str;
                if (i < values.length) {
                    const value = values[i];
                    if (value instanceof Reactive || value instanceof Computed) {
                        htmlString += `<span data-reactive="${i}"></span>`;
                        reactiveIndices.push(i);
                    } else if (value instanceof DOMTree) {
                        htmlString += `<span data-domtree="${i}"></span>`;
                    } else if (Array.isArray(value)) {
                        htmlString += `<span data-array="${i}"></span>`;
                    } else if (typeof value === 'function') {
                        htmlString += `<span data-function="${i}"></span>`;
                    } else {
                        htmlString += value;
                    }
                }
            });

            const template = document.createElement('template');
            template.innerHTML = htmlString.trim();
            const fragment = template.content;

            fragment.querySelectorAll('[data-reactive]').forEach(span => {
                const index = parseInt(span.getAttribute('data-reactive'));
                const reactive = values[index];
                const textNode = document.createTextNode(reactive.value);
                reactive.subscribe((value) => {
                    textNode.textContent = value;
                });
                span.parentNode.replaceChild(textNode, span);
            });

            fragment.querySelectorAll('[data-domtree]').forEach(span => {
                const index = parseInt(span.getAttribute('data-domtree'));
                const domTree = values[index];
                span.parentNode.replaceChild(domTree.dom, span);
            });

            fragment.querySelectorAll('[data-array]').forEach(span => {
                const index = parseInt(span.getAttribute('data-array'));
                const array = values[index];
                const frag = document.createDocumentFragment();
                array.forEach(item => {
                    if (item instanceof DOMTree) {
                        frag.appendChild(item.dom);
                    } else if (item instanceof HTMLElement) {
                        frag.appendChild(item);
                    } else {
                        frag.appendChild(document.createTextNode(String(item)));
                    }
                });
                span.parentNode.replaceChild(frag, span);
            });

            fragment.querySelectorAll('[data-function]').forEach(span => {
                const index = parseInt(span.getAttribute('data-function'));
                const fn = values[index];
                const placeholder = document.createComment('function-result');
                span.parentNode.replaceChild(placeholder, span);

                let currentNodes = [];
                const stop = effect(() => {
                    currentNodes.forEach(node => node.remove());
                    currentNodes = [];

                    const prevCtx = currentRenderContext;
                    currentRenderContext = boundCtx || prevCtx;
                    let result;
                    try {
                        result = fn.call(currentRenderContext || null, currentRenderContext || null);
                    } finally {
                        currentRenderContext = prevCtx;
                    }
                    const nodes = resultToNodes(result);

                    nodes.forEach(node => {
                        placeholder.parentNode.insertBefore(node, placeholder);
                        currentNodes.push(node);
                    });
                });
                if (boundCtx && boundCtx instanceof DOMTree && typeof boundCtx.registerEffectCleanup === 'function') {
                    boundCtx.registerEffectCleanup(stop);
                }
            });

            return fragment;
        };

        const resultToNodes = (result) => {
            if (result === null || result === undefined) {
                return [];
            } else if (result instanceof DOMTree) {
                return [result.dom];
            } else if (result instanceof HTMLElement || result instanceof Text) {
                return [result];
            } else if (Array.isArray(result)) {
                return result.flatMap(item => resultToNodes(item));
            } else {
                return [document.createTextNode(String(result))];
            }
        };

        const hasReactive = values.some(v =>
            v instanceof Reactive ||
            v instanceof Computed ||
            typeof v === 'function'
        );

        if (hasReactive) {
            return () => {
                const boundCtx = currentRenderContext;
                const fragment = createTemplate(boundCtx);
                if (fragment.children.length === 1) {
                    return new DOMTree(fragment.children[0]);
                }
                return Array.from(fragment.childNodes).map(node =>
                    node instanceof HTMLElement ? new DOMTree(node) : node
                );
            };
        } else {
            const fragment = createTemplate();
            if (fragment.children.length === 1) {
                return new DOMTree(fragment.children[0]);
            }

            return Array.from(fragment.children).map(el => new DOMTree(el));
        }
    };

    const tags = [
        'div', 'span', 'a', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'img', 'input', 'select', 'option', 'button', 'form', 'label',
        'textarea', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot',
        'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'pre', 'code', 'blockquote',
        'i', 'b', 'strong', 'em', 'mark', 'small', 'sub', 'sup', 'ins',
        'hr', 'br', 'style', 'header', 'script', 'link', 'nav', 'section',
        'article', 'aside', 'footer', 'main'
    ];

    tags.forEach(tag => {
        Object.defineProperty(h, tag, {
            value: function (...args) {
                return h(tag, ...args);
            }
        });
    });


    Object.defineProperties(h, {
        body: {
            get() {
                return new DOMTree(document.body);
            }
        },
        head: {
            get() {
                return new DOMTree(document.head);
            }
        },
        space: {
            value: function (height = "10px") {
                return h.div({ style: { height } });
            }
        },
        inputfield: {
            value: function (type = 'text', value = '', onchange, name) {
                const props = { type };
                if (name) props.name = name;
                if (onchange) props.onchange = onchange;
                const input = h.input(props);

                if (value instanceof Reactive) {
                    input.bindValue(value);
                } else if (value) {
                    input.value(value);
                }

                return input;
            }
        },
        check: {
            value: function (checked = false, onchange) {
                const props = { type: 'checkbox' };
                if (onchange) props.onchange = onchange;
                const input = h.input(props);

                if (checked instanceof Reactive) {
                    input.bindValue(checked);
                } else {
                    input.value(checked);
                }

                return input;
            }
        },
        _: {
            value: _
        }
    });

    class Component {
        constructor(name, render) {
            this.name = name;
            this.render = render;
            this.instances = new WeakMap();
        }

        create(props = {}, slots = null) {
            const instance = {
                props: props,
                state: {},
                refs: {},
                slots: {},
            };

            if (slots && typeof slots === 'object') {
                Object.entries(slots).forEach(([slotName, slotContent]) => {
                    instance.slots[slotName] = slotContent;
                });
            } else if (typeof slots === 'function' || slots instanceof DOMTree || Array.isArray(slots)) {
                instance.slots['default'] = slots;
            } else {
                instance.slots['default'] = null;
            }

            const ctx = {
                props,
                state: instance.state,
                refs: instance.refs,
                onMount: (cb) => instance.onMount = cb,
                beforeUnmount: (cb) => instance.beforeUnmount = cb,
                slots: instance.slots
            };
            ctx.useState = function(initVal){
                const key = `_s${Object.keys(instance.state).length}`;  
                if(!(key in instance.state)){                          
                    instance.state[key] = (initVal instanceof Function ? initVal() : initVal);
                }
                return Reactive.of(instance.state[key]);
            };

            const element = this.render.call(ctx, props, instance.slots);

            if (element instanceof DOMTree) {
                this.instances.set(element.dom, instance);
                if (instance.onMount) {
                    element.onMount(instance.onMount);
                }
                if (instance.beforeUnmount) {
                    element.beforeUnmount(instance.beforeUnmount);
                }
            }

            return element;
        }
    }

    const component = function (name, render) {
        const comp = new Component(name, render);

        Object.defineProperty(h, name, {
            value: function (props = {}, slots = {}) {
                return comp.create(props, slots);
            },
            configurable: true
        });

        return comp;
    };

    const when = (condition, thenContent, elseContent = null) => {
        return function () {
            const ctx = currentRenderContext || this;
            const cond = condition instanceof Reactive ? condition.value : (typeof condition === 'function' ? condition.call(ctx, ctx) : condition);
            const resolve = (c) => typeof c === 'function' ? c.call(ctx, ctx) : c;
            return cond ? resolve(thenContent) : resolve(elseContent);
        };
    };

    const each = (items, renderFn) => {
        return function () {
            const ctx = currentRenderContext || this;
            const source = (items instanceof Reactive) ? items.value : (typeof items === 'function' ? items.call(ctx, ctx) : items);
            const itemsArray = source;
            if (!Array.isArray(itemsArray)) return null;
            return itemsArray.map((item, index) => renderFn.call(ctx, item, index, ctx));
        };
    };

    const watch = (source, callback, options = {}) => {
        const { immediate = false, deep = false } = options || {};

        const getter = () => {
            if (Array.isArray(source)) {
                return source.map(s => (typeof s === 'function' ? s() : (s instanceof Reactive || s instanceof Computed ? s.value : s)));
            }
            if (typeof source === 'function') return source();
            if (source instanceof Reactive || source instanceof Computed) return source.value;
            return source;
        };

        const clone = (v) => {
            if (!deep) return v;
            try {
                return JSON.parse(JSON.stringify(v));
            } catch (e) {
                return v;
            }
        };

        let oldValue;
        let initialized = false;

        const stop = effect(() => {
            const newValue = getter();
            if (!initialized) {
                initialized = true;
                if (immediate) callback(newValue, oldValue);
            } else {
                callback(newValue, oldValue);
            }
            oldValue = clone(newValue);
        });


        return () => {
            if (typeof stop === 'function') stop();
        };
    };


    window.h = h;
    window.html = html;
    window._ = _;
    window.reactive = _;
    window.computed = computed;
    window.effect = effect;
    window.component = component;
    window.when = when;
    window.each = each;
    window.q = (query, parent = document) => parent.querySelector(query);
    window.qall = (query, parent = document) => [...parent.querySelectorAll(query)];
    window.unmount = (target) => {
        try {
            if (!target) return;
            if (target instanceof DOMTree) return target.unmount();
            if (target instanceof HTMLElement) return new DOMTree(target).unmount();
        } catch (_) {}
    };

    console.log("JSDOM v0.3 loaded.");

    return {
        h, html, _, reactive,
        computed, effect,
        component, when, each, watch,
        DOMTree, Reactive, Computed, Component
    };
})(window, document);
