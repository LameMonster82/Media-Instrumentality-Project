struct Output {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

struct Uniforms {
  overlayEnabled: f32, // 1.0 = show, 0.0 = hide
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> Output {
    let pos = array(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
    );
    let uv = array(
        vec2f(0.0, 0.0),
        vec2f(2.0, 0.0),
        vec2f(0.0, 2.0)
    );

    var out: Output;
    out.position = vec4f(pos[vertexIndex], 0.0, 1.0);
    out.uv = uv[vertexIndex];
    return out;
}

@group(0) @binding(0) var yTex: texture_2d<f32>;
@group(0) @binding(1) var uTex: texture_2d<f32>;
@group(0) @binding(2) var vTex: texture_2d<f32>;
@group(0) @binding(3) var subTexture: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@group(0) @binding(5) var<uniform> uniforms: Uniforms;

@fragment
fn fs_main(in: Output) -> @location(0) vec4f {
    let y = textureSample(yTex, samp, in.uv).r;
    let u = textureSample(uTex, samp, in.uv).r;
    let v = textureSample(vTex, samp, in.uv).r;

    // YUV to RGB (BT.709 matrix, video range 16-235/240)
    let yuv = vec3f(y, u, v) - vec3f(0.0625, 0.5, 0.5);
    let rgb = mat3x3f(
        vec3f(1.0,  0.0,      1.5748),
        vec3f(1.0, -0.1873,  -0.4681),
        vec3f(1.0,  1.8556,   0.0)
    ) * yuv;

    let video = vec4f(rgb, 1.0);
    if(uniforms.overlayEnabled < 0.5) {
        return video;
    }

    let sub = textureSample(subTexture, samp, in.uv);

    return vec4f(sub.rgb + video.rgb * (1.0 - sub.a), 1.0);
}
