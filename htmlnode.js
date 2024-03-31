class HTMLNode {
        tagName;
        _styles = {};

        get style() {
            return new Proxy(this._styles, {
                get: (target, property) => {
                    let realProperty = property.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
                    return target[realProperty];
                },
                set: (target, property, value) => {
                    let realProperty = property.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
                    target[realProperty] = value;
                    return true;
                }
            });
        }

        set style(value) {
            if (typeof value === 'object' && value !== null) {
                for (let key in value) {
                    let realKey = key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
                    this._styles[realKey] = value[key];
                }
            } else {
                throw new Error('Style must be an object');
            }
        }
        content = "";
        children = [];
        events = {};
        isTextNode = false;
        isCommentNode = false;
        classes = [];
        id = "";

        constructor(tagName = '', content = '', isTextNode = false) {
            this.tagName = tagName;
            this.isTextNode = isTextNode;
            if (this.isTextNode) {
                this.content = this.escapeHTML(content);
            } else {
                this.content = content;
            }
        }

        escapeHTML(content) {
            return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        
        static createComment(text) {
            const comment = new HTMLNode('', text, true);
            comment.isCommentNode = true;
            return comment;
        }

        static createTextNode(text) {
            return new HTMLNode('', text, true);
        }

        static createElement(tagName) {
            return new HTMLNode(tagName);
        }

        createTextNode(text) {
            // create and append
            let node = HTMLNode.createTextNode(text);
            this.children.push(node);
            return node;
        }

        createElement(tagName) {
            // create and append
            let node = HTMLNode.createElement(tagName);
            this.children.push(node);
            return node;
        }

        createComment(text) {
            // create and append
            let node = HTMLNode.createComment(text);
            this.children.push(node);
            return node;
        }

        set innerHTML(value) {
            // Parse the HTML string into HTMLNode objects and set them as children
            let parser = new DOMParser();
            let doc = parser.parseFromString(value, 'text/html');
            this.children = this.convertNodeListToHTMLNodes(doc.body.childNodes);
        }

        get innerHTML() {
            // Convert the children HTMLNodes back into an HTML string
            return this.children.map(child => child.toString()).join('');
        }

        convertNodeListToHTMLNodes(nodeList) {
            let htmlNodes = [];
            for (let i = 0; i < nodeList.length; i++) {
                let node = nodeList[i];
                let htmlNode = new HTMLNode();
                htmlNode.tagName = node.nodeName;
                htmlNode.content = node.textContent;
                if (node.nodeName.startsWith('<!--')) {
                    htmlNode.isTextNode = true;
                    htmlNode.isCommentNode = true;
                }
                if (node.attributes) {
                    for (let j = 0; j < node.attributes.length; j++) {
                        let attr = node.attributes[j];
                        htmlNode.setAttribute(attr.name, attr.value);
                    }
                }
                if (node.childNodes.length > 0) {
                    htmlNode.children = this.convertNodeListToHTMLNodes(node.childNodes);
                }
                htmlNodes.push(htmlNode);
            }
            return htmlNodes;
        }

        set innerText(value) {
            let textNode = this.createTextNode(value);
            this.children = [textNode];
        }

        get innerText() {
            if (this.children[0] && this.children[0].isTextNode) {
                return this.children[0].content;
            }
            return '';
        }

        setAttribute(name, value) {
            this.style[name] = value;
        }

        getAttribute(name) {
            return this.style[name];
        }

        removeAttribute(name) {
            delete this.style[name];
        }

        addEventListener(event, handler) {
            if (!this.events[event]) {
                this.events[event] = [];
            }
            if (typeof handler === 'function') {
                this.events[event].push(`(${handler.toString()})()`);
            } else {
                this.events[event].push(handler);
            }
        }

        removeEventListener(event, handler) {
            if (this.events[event]) {
                this.events[event] = this.events[event].filter(h => h !== handler);
            }
        }

        setClass(...classes) {
            this.classes = classes;
        }

        toggleClass(...names) {
            names.forEach(name => {
                let index = this.classes.indexOf(name);
                if (index >= 0) {
                    this.classes.splice(index, 1);
                } else {
                    this.classes.push(name);
                }
            });
        }

        addClass(...names) {
            names.forEach(name => {
                if (!this.classes.includes(name)) {
                    this.classes.push(name);
                }
            });
        }

        delClass(...names) {
            this.classes = this.classes.filter(name => !names.includes(name));
        }

        appendTo(parent) {
            parent.childs.push(this);
        }

        append(...children) {
            children = children.filter(child => child !== null);
            children = children.map(child => typeof child === 'string' ? this.createTextNode(child) : child);
            this.children.push(...children);
        }
        appendChild(child) {
            if (child === null) return;
            child = typeof child === 'string' ? this.createTextNode(child) : child;
            this.children.push(child);
        }

        insertBefore(child, refChild) {
            let index = this.children.indexOf(refChild);
            if (index >= 0) {
                this.children.splice(index, 0, child);
            }
        }

        value(val) {
            this.content = val;
        }

        getValue() {
            return this.content;
        }

        props(props) {
            Object.assign(this.styles, props);
        }

        set(name, value) {
            this.styles[name] = value;
        }

        get(name) {
            return this.styles[name];
        }

        unset(name) {
            delete this.styles[name];
        }

        bindValue(reactive) {
            this.content = reactive;
        }

        getElementById(id) {
            return this.children.find(child => child.styles.id === id);
        }

        getElementsByTagName(tagname) {
            return this.children.filter(child => child.tagName === tagname);
        }

        getElementsByClassName(classname) {
            return this.children.filter(child => child.styles.class && child.styles.class.split(' ').includes(classname));
        }

        querySelector(query) {
            // This is a simple implementation. In a real world scenario, you would use a library to parse the query.
            let [tagname, classname] = query.split('.');
            return this.children.find(child => child.tagName === tagname && child.styles.class && child.styles.class.split(' ').includes(classname));
        }

        querySelectorAll(query) {
            // This is a simple implementation. In a real world scenario, you would use a library to parse the query.
            let [tagname, classname] = query.split('.');
            return this.children.filter(child => child.tagName === tagname && child.styles.class && child.styles.class.split(' ').includes(classname));
        }

        toString() {
            let childrenHTML = this.children.map(child => child.toString()).join('');
            let selfClosingTags = ['area', 'base', 'br', 'col', 'command', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr'];
            let styles = Object.entries(this._styles).map(([key, value]) => `${key}:${value}`).join('; ');
            let classes = this.classes.join(' ');
            let id = this.id ? `id="${this.id}"` : '';
            let attributes = Object.entries(this._styles).filter(([key]) => key !== 'style' && key !== 'class' && !this._styles.hasOwnProperty(key)).map(([key, value]) => `${key}="${value.replace(/"/g, '&quot;')}"`).join(' ');

            let eventListeners = Object.entries(this.events).map(([event, handler]) => `on${event}="${handler.toString().replace(/"/g, '&quot;')}"`).join(' ');

            let idAttribute = id ? ` ${id}` : '';
            let styleAttribute = styles ? ` style="${styles}"` : '';
            let classAttribute = classes ? ` class="${classes}"` : '';
            let otherAttributes = attributes ? ` ${attributes}` : '';
            let eventListenersAttribute = eventListeners ? ` ${eventListeners}` : '';

            if (this.isTextNode) {
                if (this.isCommentNode) {
                    return `<!--${this.content}-->`;
                } else {
                    return this.content;
                }
            } else if (selfClosingTags.includes(this.tagName)) {
                return `<${this.tagName}${idAttribute}${otherAttributes}${styleAttribute}${classAttribute}${eventListenersAttribute} />`;
            } else {
                return `<${this.tagName}${idAttribute}${otherAttributes}${styleAttribute}${classAttribute}${eventListenersAttribute}>${this.content}${childrenHTML}</${this.tagName}>`;
            }
        }

        renderAsPage() {
            let htmlContent = this.toString();
            if (!htmlContent.includes('<body')) {
                htmlContent = `<body>${htmlContent}</body>`;
            }
            return `<!DOCTYPE html>\n<html>\n${htmlContent}\n</html>`;
        }
    }
