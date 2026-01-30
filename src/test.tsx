import { h } from "./JSXRuntime/jsx-runtime.js";

let h1Thing: HTMLHeadingElement | undefined;

const App = () => (
    <div id="root">
        <h1 ref={ (e) => { h1Thing = e; } }>Hello from Bun JSX without React!</h1>
        <button disabled={ true } onclick={ () => alert("Clicked!") }>Click Me</button>
    </div>
);

console.log("Before", h1Thing); // undefined
document.body.appendChild(<App />);
console.log("After", h1Thing); // defined
