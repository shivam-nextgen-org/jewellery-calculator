/**
 * Runs before React. Swallows browser-extension hydration / M_ID console noise
 * so Next.js does not open the red error overlay for non-app issues.
 */
export const SUPPRESS_EXTENSION_CONSOLE = `
(function () {
  if (typeof window === "undefined") return;
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
