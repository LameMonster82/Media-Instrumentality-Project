/// <reference types="@webgpu/types" />

import videoShader from "./videoTexture.wgsl?raw";

export default class WebGPUCompositor {
    private device: GPUDevice | null = null;
    private context: GPUCanvasContext | null = null;
    private presentationFormat: GPUTextureFormat = "rgba8unorm";

    private sampler: GPUSampler | null = null;

    private videoFrameBingingLayout: GPUBindGroupLayout | null = null;
    private videoPipeline: GPURenderPipeline | null = null;

    private dummyTexture: GPUTexture | null = null;
    private hasSubtitlesUniform: GPUBuffer | null = null;

    async init(canvas: HTMLCanvasElement) {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("WebGPU not supported");

        this.device = await adapter.requestDevice();
        this.context = canvas.getContext("webgpu") as GPUCanvasContext;
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: "opaque",
        });

        this.sampler = this.device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
        });

        this.dummyTexture = this.device.createTexture({
            size: [1, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        this.device.queue.writeTexture(
            { texture: this.dummyTexture },
            new Uint8Array([0, 0, 0, 0]),
            { bytesPerRow: 4 },
            [1, 1]
        );

        this.createVideoFramePipelines();
    }

    private createVideoFramePipelines() {
        if (!this.device) throw Error("No WebGPU device. What are you doing????");

        const shaderModule = this.device.createShaderModule({ code: videoShader });

        this.videoFrameBingingLayout = this.device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                externalTexture: {},
            }, {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: 'float', viewDimension: '2d' },
            }, {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {},
            }, {
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform', minBindingSize: 4 },
            }]
        });

        this.hasSubtitlesUniform = this.device.createBuffer({
            size: 4, // single f32
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.device.queue.writeBuffer(this.hasSubtitlesUniform, 0, new Float32Array([0.0]));

        const pipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.videoFrameBingingLayout],
        });

        this.videoPipeline = this.device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: "vs_main",
            },
            fragment: {
                module: shaderModule,
                entryPoint: "fs_main",
                targets: [{ format: this.presentationFormat }],
            },
            primitive: { topology: "triangle-list" },
        });
    }

    renderVideoFrame(videoFrame: VideoFrame) {
        if (!this.device || !this.videoFrameBingingLayout || !this.context || !this.videoPipeline || !this.sampler) throw Error("No WebGPU device. What are you doing????");

        const externalTexture = this.device.importExternalTexture({ source: videoFrame });
        const bindGroup = this.device.createBindGroup({
            layout: this.videoFrameBingingLayout,
            entries: [
                {
                    binding: 0, resource: externalTexture,
                }, {
                    binding: 1, resource: this.dummyTexture!.createView(),
                }, {
                    binding: 2, resource: this.sampler
                }, {
                    binding: 3, resource: { buffer: this.hasSubtitlesUniform!, }
                }],
        });

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();
        const pass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                loadOp: "clear",
                storeOp: "store",
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });

        pass.setPipeline(this.videoPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();

        this.device.queue.submit([commandEncoder.finish()]);
        videoFrame.close();
    }
}
