# jsdom
(Learning reactive dom) A simple DOM manipulation library for JavaScript with reactive support.

Just import `jsdom.js` and try this in console:

```javascript
let react1 = _("react");
let react2 = _(true);
h.body.append(
    h.div(react1),
    h.inputfield('text', react1),
    h.div(react2),
    h.check(react2)
);
```


TODO: Make a virtual dom version.
