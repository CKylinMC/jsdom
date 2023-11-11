/**
 * JSDOM
 * @description A simple DOM manipulation library for JavaScript with reactive support.
 * @author CKylinMC <canszj@yeah.net>
 * @version 0.1
 */

(function () {
    class Reactive {
        #_value = undefined;
        #subscribers = [];
        constructor(value) {
            this.#_value = value;
        }

        get value() {
            return this.#_value;
        }
        set value(value) {
            this.#_value = value;
            this.#subscribers.forEach(subscriber => subscriber(value));
        }

        subscribe(subscriber) {
            this.#subscribers.push(subscriber);
            return () => this.#subscribers = this.#subscribers.filter(sub => sub !== subscriber);
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

    const _ = function (value) {
        return Reactive.of(value);
    };

    class DOMTree {
        #dom;
        #reactive = {};

        constructor() {
            let args = [...arguments];
            if (args.length === 0) {
                this.#dom = document.createElement('div');
            } else {
                let first = args.shift();
                if (typeof (first) === 'string') {
                    // tagname setup mode
                    const manifest = {
                        tagname: first,
                        props: {},
                        text: '',
                        children: [],
                    };
                    for(let arg of args.slice(0,2)) {
                        if (typeof (arg) === 'string') {
                            manifest.text = arg;
                        } else if (arg instanceof Reactive) {
                            manifest.text = arg;
                        } else if (typeof (arg) === 'object') {
                            manifest.props = arg;
                        } else if (Array.isArray(arg)) {
                            manifest.children = arg;
                        }
                    }

                    this.setup(manifest.tagname, manifest.props, manifest.text, manifest.children);
                }else if (first instanceof HTMLElement) {
                    this.#dom = first;
                } else if (first instanceof DOMTree) {
                    this.#dom = first.#dom;
                } else if (Array.isArray(first)) {
                    this.parseTemplate([first, ...args]);
                } else {
                    throw new Error('Invalid argument');
                }
            }
        }

        parseTemplate(templateArr = ['']) {
            // parser of h`` template literal, build DOMTree instance from raw HTML
            // usage: h`<div id="1" class="${name}"><a href="/1">test</a></div>`
            let baseArr = templateArr.shift();// splited by ${} expression

            // merge all splited string and expression
            let mergedArr = [];
            for (let i = 0; i < baseArr.length; i++) {
                mergedArr.push(baseArr[i]);
                if (i < templateArr.length) {
                    mergedArr.push(templateArr[i]);
                }
            }

            // merge to one string
            let mergedStr = mergedArr.join('');
            // convert to HTMLElement
            let dom = document.createElement('span');
            dom.innerHTML = mergedStr;
            if(dom.children.length === 1) {
                dom = dom.children[0];
            } else {
                console.warn("Dom Tree only accept one root element. For multiple root elements, Dom Tree will create one SPAN to handle them.")
            }
            this.#dom = dom;
            return;
        }

        #unregReactive(type) {
            if (this.#reactive[type]) {
                this.#reactive[type].unsubscribe();
                delete this.#reactive[type];
            }
        }

        #callReactive(type,...args) {
            if (this.#reactive[type]) {
                this.#reactive[type].update(...args);
            }
        }

        setup(tagname, props = {}, text = '', children = []) {
            this.#dom = document.createElement(tagname);
            this.props(props);
            this.text(text);
            this.append(...children);
            return this;
        }

        setClass(...classes) {
            this.#dom.className = classes.join(' ');
            return this;
        }

        toggleClass(...names) {
            names.forEach(name => this.#dom.classList.toggle(name));
            return this;
        }

        addClass(...names) {
            names.forEach(name => this.#dom.classList.add(name));
            return this;
        }

        delClass(...names) {
            names.forEach(name => this.#dom.classList.remove(name));
            return this;
        }

        toString() {
            return this.#dom.outerHTML;
        }

        toHTML() {
            return this.#dom.outerHTML;
        }

        valueOf() {
            return this.#dom;
        }

        get tagname() {
            return this.#dom.tagName;
        }

        get dom() {
            return this.#dom;
        }

        text(innerText = '') {
            if (innerText instanceof Reactive) {
                this.#reactive.text = innerText.value;
                let unsub = innerText.subscribe((value) => {
                    this.#dom.innerText = value;
                });
                this.#reactive.text = {
                    unsubscribe: () => {
                        unsub();
                        delete this.#reactive.text;
                    },
                    update: ()=>{},
                };
            } else if (innerText instanceof Function) {
                this.#reactive.text = innerText();
                this.#reactive.text = {
                    unsubscribe: () => {
                        delete this.#reactive.text;
                    },
                    update: () => {
                        this.#dom.innerText = innerText();
                    },
                };
            } else this.#dom.innerText = innerText;
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
            if(append) {
                this.#dom.style.cssText += cssText;
            } else {
                this.#dom.style.cssText = cssText;
            }
            return this;
        }

        appendTo(parent) {
            if (parent instanceof DOMTree) {
                parent.append(this);
            } else if (parent instanceof HTMLElement) {
                parent.appendChild(this.#dom);
            } else {
                throw new Error('Not a valid parent');
            }
            return this;
        }

        append(...children) {
            children.forEach(child => {
                if (child instanceof DOMTree) {
                    this.#dom.appendChild(child.dom);
                } else if (child instanceof HTMLElement) {
                    this.#dom.appendChild(child);
                } else if (child instanceof Array) {
                    this.append(...child);
                } else {
                    this.#dom.appendChild(document.createTextNode(child));
                }
            });
            return this;
        }

        insertBefore(child, refChild) {
            if (child instanceof DOMTree) {
                this.#dom.insertBefore(child.dom, refChild);
            } else if (child instanceof HTMLElement) {
                this.#dom.insertBefore(child, refChild);
            } else if (child instanceof Array) {
                this.insertBefore(...child);
            } else {
                this.#dom.insertBefore(document.createTextNode(child), refChild);
            }
            return this;
        }

        value(val,noreactive = false) {
            if (
                this.tagname === 'SELECT' || (
                    this.#dom.tagName === 'INPUT' &&
                    (
                        [
                            'text',
                            'number',
                            'password',
                            'email',
                            'search',
                            'tel',
                            'url',
                        ].includes(this.#dom.type)
                    ))
            ) {
                this.#dom.value = val;
            } else if (
                (this.#dom.tagName === 'INPUT' &&
                    [
                        'checkbox',
                        'radio',
                    ].includes(this.#dom.type))
            ) {
                this.#dom.checked = !!val;
            } else if (
                this.#dom.tagName === 'TEXTAREA'
            ) {
                this.#dom.innerText = val;
            }else {
                throw new Error('Not a value element');
            }

            if(!noreactive) this.#callReactive('value');
            return this;
        }

        getValue() {
            if (
                this.tagname === 'SELECT' || (
                    this.#dom.tagName === 'INPUT' &&
                    (
                        [
                            'text',
                            'number',
                            'password',
                            'email',
                            'search',
                            'tel',
                            'url',
                        ].includes(this.#dom.type)
                    ))
            ) {
                return this.#dom.value;
            } else if (
                (this.#dom.tagName === 'INPUT' &&
                    [
                        'checkbox',
                        'radio',
                    ].includes(this.#dom.type))
            ) {
                return this.#dom.checked;
            } else if (
                this.#dom.tagName === 'TEXTAREA'
            ) {
                return this.#dom.innerText;
            }else {
                throw new Error('Not a value element');
            }
        }

        props(props = {}) {
            Object.assign(this.#dom, props);
            return this;
        }

        on(event, handler) {
            this.#dom.addEventListener(event, handler);
            return this;
        }

        off(event, handler) {
            this.#dom.removeEventListener(event, handler);
            return this;
        }

        set(name, value) {
            this.#dom.setAttribute(name, value);
            return this;
        }

        get(name) {
            return this.#dom.getAttribute(name);
        }

        unset(name) {
            this.#dom.removeAttribute(name);
            return this;
        }

        bindValue(reactive) {
            this.#unregReactive('value');
            if (reactive instanceof Reactive) {
                this.#unregReactive('value');
                this.#reactive.value = reactive;
                const updater = (val) => {
                    this.#callReactive('value', this.getValue());
                }
                this.on('input', updater);
                let unsub = reactive.subscribe((value) => {
                    this.value(value, true);
                });
                this.#reactive.value = {
                    unsubscribe: () => {
                        unsub();
                        this.off('input', updater);
                        delete this.#reactive.value;
                    },
                    update: (val) => {
                        reactive.value = val;
                    },
                };
                this.#callReactive('value', this.getValue());
            } else {
                throw new Error('Not a reactive object');
            }
            return this;
        }

        addEventListener(event, handler) {
            this.#dom.addEventListener(event, handler);
            return this;
        }

        removeEventListener(event, handler) {
            this.#dom.removeEventListener(event, handler);
            return this;
        }

        get style() {
            return this.#dom.style;
        }

        get innerHTML() {
            return this.#dom.innerHTML;
        }

        set innerHTML(value) {
            this.html(value);
        }

        get innerText() {
            return this.#dom.innerText;
        }

        set innerText(value) {
            this.text(value);
        }

        get classList() {
            return this.#dom.classList;
        }

        get className() {
            return this.#dom.className;
        }

        set className(value) {
            this.#dom.className = value;
        }

        get id() {
            return this.#dom.id;
        }

        set id(value) {
            this.#dom.id = value;
        }

        get name() {
            return this.#dom.name;
        }

        set name(value) {
            this.#dom.name = value;
        }

        getAttribute(name) {
            return this.#dom.getAttribute(name);
        }

        setAttribute(name, value) {
            this.#dom.setAttribute(name, value);
        }

        removeAttribute(name) {
            this.#dom.removeAttribute(name);
        }

        get textContent() {
            return this.#dom.textContent;
        }

        set textContent(value) {
            this.text(value);
        }

        get children() {
            return this.#dom.children;
        }

        set children(value) {
            this.#dom.innerHTML = '';
            this.append(...value);
        }
    }

    const h = function () {
        return new DOMTree(...arguments);
    };

    Object.defineProperties(h, {
        ...([
            'div',
            'span',
            'a',
            'p',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'img',
            'input',
            'select',
            'option',
            'button',
            'form',
            'label',
            'textarea',
            'table',
            'tr',
            'td',
            'th',
            'thead',
            'tbody',
            'tfoot',
            'ul',
            'ol',
            'li',
            'dl',
            'dt',
            'dd',
            'pre',
            'code',
            'blockquote',
            'i',
            'b',
            'strong',
            'em',
            'mark',
            'small',
            'sub',
            'sup',
            'ins',
            'hr',
            'br',
            'style',
            'header',
            'script'
        ].map(
            tagname => ({
                [tagname]: {
                    value: function () {
                        return h(tagname, ...arguments);
                    }
                }
            })
        ).reduce((acc, cur) => ({ ...acc, ...cur }), {})),
        space: {
            value: function (height = "10px") {
                return h.div({ style: { height } });
            }
        },
        alink: {
            value: function (href, text) {
                return h.a({ href }, text);
            }
        },
        image: {
            value: function (src, alt) {
                return h.img({ src, alt });
            }
        },
        btn: {
            value: function (text, onclick) {
                return h.button({ onclick }, text);
            }
        },
        inputfield: {
            value: function (type = 'text', value = '', onchange) {
                let properties = { type, name, value, onchange };
                if (value instanceof Reactive) {
                    delete properties.value;
                }
                let ipt = h.input(properties);
                if (value instanceof Reactive) {
                    ipt.bindValue(value);
                }
                return ipt;
            }
        },
        check: {
            value: function (checked = false, onchange) {
                let properties = { type: 'checkbox', checked, onchange };
                if (checked instanceof Reactive) {
                    delete properties.checked;
                }
                let ipt = h.input(properties);
                if (checked instanceof Reactive) {
                    ipt.bindValue(checked);
                }
                return ipt;
            }
        },
        linkcss: {
            value: function (href) {
                return h.link({ rel: 'stylesheet', href });
            }
        },
        linkjs: {
            value: function (src) {
                return h.script({ src });
            }
        },
        css: {
            value: function (cssText) {
                return h.style({ innerHTML: cssText });
            }
        },
        text: {
            value: function (text) {
                return document.createTextNode(text);
            }
        },
        react: {
            value: function (react) {
                if(react instanceof Reactive) {
                    const textnode = document.createTextNode(react.value);
                    react.subscribe((value) => {
                        textnode.textContent = value;
                    });
                } else {
                    throw new Error('Not a reactive object');
                }
            }
        },
        body: {
            get value () {
                return h(document.body);
            }
        },
        head: {
            get value () {
                return h(document.head);
            }
        },
        html: {
            get value () {
                return h(document.documentElement);
            }
        },
        _: {
            value: _
        },
    });
    window.h = h;
    window._ = _;
    window.q = (query, parent = document) => parent.querySelector(query);
    window.qall = (query, parent = document) => [...parent.querySelectorAll(query)];
})();
