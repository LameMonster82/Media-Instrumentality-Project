//import styles from "./LoadingLoop.module.css"

function svgToBase64(svgString: string) {
  // Encode the SVG string
  const encoded = window.btoa(unescape(encodeURIComponent(svgString)));
  // Return as data URL
  return `data:image/svg+xml;base64,${encoded}`;
}

const style = window.getComputedStyle(document.body);
const primary = style.getPropertyValue('--md-sys-color-primary');
const secondary = style.getPropertyValue('--md-sys-color-on-secondary');

const template = document.createElement('template');
const loader = `<svg viewBox="-5 -5 10 10" xmlns="http://www.w3.org/2000/svg">
  <!-- Container rotation -->
  <g>
    <animateTransform
      attributeName="transform"
      type="rotate"
      from="0 0 0"
      to="270 0 0"
      dur="2s"
      repeatCount="indefinite"
    />

    <!-- First Circle -->
    <circle fill="none" stroke="${primary}" stroke-width="0.75"
      stroke-dasharray="30" stroke-dashoffset="28"
      stroke-linecap="round" r="4">
      <animateTransform
        attributeName="transform"
        type="rotate"
        values="0;165;450"
        keyTimes="0;0.5;1"
        dur="2s"
        repeatCount="indefinite"
      />
      <animate
        attributeName="stroke-dashoffset"
        values="28;10;28"
        keyTimes="0;0.5;1"
        dur="2s"
        repeatCount="indefinite"
      />
    </circle>

    <!-- Second Circle -->
    <circle fill="none" stroke="${secondary}" stroke-width="0.75"
      stroke-dasharray="30" stroke-dashoffset="10"
      stroke-linecap="round" r="4">
      <animateTransform
        attributeName="transform"
        type="rotate"
        values="50;474;500"
        keyTimes="0;0.5;1"
        dur="2s"
        repeatCount="indefinite"
      />
      <animate
        attributeName="stroke-dashoffset"
        values="10;28;10"
        keyTimes="0;0.5;1"
        dur="2s"
        repeatCount="indefinite"
      />
    </circle>
  </g>
</svg>`
template.innerHTML += loader;
document.body.appendChild(template)

export const loadingIndicatorBase64 = svgToBase64(loader);
const blob = new Blob([loader], { type: "image/svg+xml" });
export const loadingIndicatorURL = URL.createObjectURL(blob);

export default function loadingIndicator() {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const svg = fragment.querySelector('svg')!;
    svg.style.width = "10rem";
    return svg;
}

