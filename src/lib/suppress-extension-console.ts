/**
 * Runs before React hydrates. Two jobs:
 *  1. Strip browser-extension attributes (e.g. bis_skin_checked) from the DOM
 *     as they are added, so React never sees a server/client mismatch.
 *  2. Swallow any residual extension hydration / M_ID console noise so the
 *     Next.js dev overlay does not pop for non-app issues.
 *
 * Injected as a raw inline <script> in <head> so it runs synchronously while
 * the document is parsing — before React hydration and before most extensions
 * finish mutating the DOM.
 */
export const SUPPRESS_EXTENSION_CONSOLE = `
(function () {
  if (typeof window === "undefined") return;

  // Attributes injected by browser extensions that cause hydration mismatches.
  var BAD_ATTRS = ["bis_skin_checked", "bis_register", "__processed_"];

  function stripAttrs(root) {
    try {
      for (var i = 0; i < BAD_ATTRS.length; i++) {
        var name = BAD_ATTRS[i];
        if (root.nodeType === 1 && root.hasAttribute && root.hasAttribute(name)) {
          root.removeAttribute(name);
        }
        if (root.querySelectorAll) {
          var nodes = root.querySelectorAll("[" + name + "]");
          for (var j = 0; j < nodes.length; j++) {
            nodes[j].removeAttribute(name);
          }
        }
      }
      // Some extensions add attributes with a dynamic suffix (e.g.
      // __processed_<uuid>). Remove any attribute starting with these prefixes.
      if (root.nodeType === 1 && root.attributes) {
        for (var k = root.attributes.length - 1; k >= 0; k--) {
          var attr = root.attributes[k];
          if (
            attr &&
            (attr.name.indexOf("bis_") === 0 ||
              attr.name.indexOf("__processed") === 0)
          ) {
            root.removeAttribute(attr.name);
          }
        }
      }
    } catch (e) {}
  }

  // Strip whatever is already there, then keep stripping as the extension
  // mutates the DOM. The observer stays active to fight late injections.
  try {
    stripAttrs(document.documentElement);
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === "attributes" && m.target) {
          stripAttrs(m.target);
        } else if (m.addedNodes) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            stripAttrs(m.addedNodes[j]);
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: BAD_ATTRS,
    });
  } catch (e) {}

  // Fallback: swallow console noise for these known extension patterns.
  var patterns = [
    "bis_skin_checked",
    "bis_skin",
    "M_ID",
    "A tree hydrated but some attributes of the server rendered HTML didn't match",
    "Hydration failed because the server rendered HTML",
    "There was an error while hydrating",
  ];
  function noisy(args) {
    try {
      var text = Array.prototype.map
        .call(args, function (a) {
          if (a == null) return "";
          if (typeof a === "string") return a;
          if (a && typeof a.message === "string") return a.message;
          return String(a);
        })
        .join(" ");
      for (var i = 0; i < patterns.length; i++) {
        if (text.indexOf(patterns[i]) !== -1) return true;
      }
    } catch (e) {}
    return false;
  }
  var err = console.error;
  var warn = console.warn;
  console.error = function () {
    if (noisy(arguments)) return;
    return err.apply(console, arguments);
  };
  console.warn = function () {
    if (noisy(arguments)) return;
    return warn.apply(console, arguments);
  };
  window.addEventListener(
    "unhandledrejection",
    function (e) {
      var msg =
        (e.reason && e.reason.message) ||
        String((e.reason && e.reason) || "");
      for (var i = 0; i < patterns.length; i++) {
        if (msg.indexOf(patterns[i]) !== -1) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
      }
    },
    true,
  );
})();
`.trim();
