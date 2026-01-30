import { frameToGLEnumFormat } from "./AVTypes.js";

export class WebGLCanvas {

  private gl: WebGL2RenderingContext;
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {desynchronized: true, antialias: false, preserveDrawingBuffer: true});

    if (!gl) throw new Error('WebGL not supported');
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    // Simple vertex & fragment shaders
    const vs = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = (p+1.0)/2.0; gl_Position = vec4(p,0,1); }`;

    const fs = `#version 300 es
precision mediump float; in vec2 uv; out vec4 o;
uniform sampler2D t;
void main(){ o = texture(t, uv); }`;

    // Compile and link
    function compile(type: GLenum, src: string) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      return s;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // Fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // Texture setup
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.uniform1i(gl.getUniformLocation(prog, "t"), 0);
    this.gl = gl;
  }

  public DrawFrame(videoFrame: VideoFrame) {
    const { format, type } = frameToGLEnumFormat(videoFrame.format!, this.gl);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, format, videoFrame.codedWidth, videoFrame.codedHeight, 0, format, type, videoFrame);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    videoFrame.close();
  }

  public UpdateViewport() {
    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
  }
}
