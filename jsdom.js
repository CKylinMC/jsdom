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

            this.#setupLifecycleObserver();
            __registerInstance(this.#dom, this);
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
            Object.entries(props).forEach(([key, value]) => {
                if (key === 'style' && typeof value === 'object') {
                    this.css(value);
                } else if (key === 'class') {
                    this.setClass(value);
                } else if (key.startsWith('on')) {
                    const event = key.slice(2).toLowerCase();
                    this.on(event, value);
                } else {
                    this.set(key, value);
                }
            });
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
            this.#dom.className = classes.join(' ');
            return this;
        }

        addClass(...names) {
            this.#dom.classList.add(...names);
            return this;
        }

        removeClass(...names) {
            this.#dom.classList.remove(...names);
            return this;
        }

        toggleClass(...names) {
            names.forEach(name => this.#dom.classList.toggle(name));
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
        set className(value) { this.#dom.className = value; }
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

    console.log("JSDOM Reimplemented v0.3 loaded.");

    return {
        h, html, _, reactive,
        computed, effect,
        component, when, each, watch,
        DOMTree, Reactive, Computed, Component
    };
})(window, document);
