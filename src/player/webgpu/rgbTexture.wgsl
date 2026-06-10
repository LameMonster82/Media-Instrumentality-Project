struct Output {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

struct Uniforms {
  overlayEnabled: f32, // 1.0 = show, 0.0 = hide
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> Output {
    // Triangle covering NDC from (-1,-1) to (3,-1) to (-1,3)
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

    // Output the position and pass UV to the fragment shader
    var out: Output;
    out.position = vec4f(pos[vertexIndex], 0.0, 1.0);
    out.uv = uv[vertexIndex];
    return out;
}

@group(0) @binding(0) var rgbTexture: texture_2d<f32>;
@group(0) @binding(1) var subTexture: texture_2d<f32>;
@group(0) @binding(2) var rgbSampler: sampler;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

@fragment
fn fs_main(in: Output) -> @location(0) vec4f {
    let video = textureSample(rgbTexture, rgbSampler, in.uv);
    if (uniforms.overlayEnabled < 0.5) {
        return video;
    }

    let sub = textureSample(subTexture, rgbSampler, in.uv);
    return vec4f(sub.rgb + video.rgb * (1.0 - sub.a), 1.0);;
}
