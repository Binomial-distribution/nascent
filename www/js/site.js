document.querySelectorAll("[data-year]").forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});

const localHost = location.hostname === "127.0.0.1" || location.hostname === "localhost";
if (localHost) {
  document.querySelectorAll("[data-demo]").forEach((el) => {
    el.setAttribute("href", "demo.html");
  });
}
