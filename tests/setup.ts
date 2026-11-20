import "@testing-library/jest-dom/vitest";

if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  };
}

if (typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.showPopover !== "function") {
  const setPopoverState = (element: HTMLElement, open: boolean) => {
    if (element.hasAttribute("data-popover-open") === open) return;
    element.toggleAttribute("data-popover-open", open);
    const event = new Event("toggle") as Event & { newState: string; oldState: string };
    event.newState = open ? "open" : "closed";
    event.oldState = open ? "closed" : "open";
    element.dispatchEvent(event);
  };
  HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement) { setPopoverState(this, true); };
  HTMLElement.prototype.hidePopover = function hidePopover(this: HTMLElement) { setPopoverState(this, false); };
  HTMLElement.prototype.togglePopover = function togglePopover(this: HTMLElement) { setPopoverState(this, !this.hasAttribute("data-popover-open")); return this.hasAttribute("data-popover-open"); };
  const style = document.createElement("style");
  style.textContent = "html [popover][data-popover-open] { display: block !important; }";
  document.head.append(style);
  document.addEventListener("click", (event) => {
    const invoker = event.target instanceof Element ? event.target.closest("[popovertarget]") : null;
    const panel = invoker ? document.getElementById(invoker.getAttribute("popovertarget") ?? "") : null;
    const action = invoker?.getAttribute("popovertargetaction");
    if (action === "hide") panel?.hidePopover();
    else if (action === "show") panel?.showPopover();
    else panel?.togglePopover();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const panel of document.querySelectorAll<HTMLElement>("[popover][data-popover-open]")) panel.hidePopover();
  });
}
