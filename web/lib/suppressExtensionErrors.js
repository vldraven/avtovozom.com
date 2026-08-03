/**
 * MetaMask и др. расширения бросают unhandled rejection на localhost.
 * Next.js Dev Overlay ловит их и перекрывает UI — глушим до регистрации React.
 */
if (typeof window !== "undefined") {
  if (!window.__AVTOVOZOM_EXTENSION_ERROR_GUARD__) {
    window.__AVTOVOZOM_EXTENSION_ERROR_GUARD__ = true;

    const isNoise = (value, filename = "") => {
      try {
        const msg = String(value?.message || value || "");
        const stack = String(value?.stack || "");
        const file = String(filename || "");
        return (
          /MetaMask|Failed to connect to MetaMask/i.test(msg) ||
          /chrome-extension:\/\//i.test(`${msg}${stack}${file}`)
        );
      } catch {
        return false;
      }
    };

    window.addEventListener(
      "error",
      (event) => {
        if (!isNoise(event.error || event.message, event.filename)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true
    );

    window.addEventListener(
      "unhandledrejection",
      (event) => {
        if (!isNoise(event.reason)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true
    );
  }
}
