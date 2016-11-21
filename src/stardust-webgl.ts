export let version = "0.0.1";

export { WebGLPlatform, WebGLCanvasPlatform2D, WebGLCanvasPlatform3D } from "./webgl/webgl";

import { registerPlatformConstructor } from "stardust-core";
import { WebGLCanvasPlatform2D, WebGLCanvasPlatform3D } from "./webgl/webgl";

registerPlatformConstructor("webgl-2d", (canvas: HTMLCanvasElement, width: number = 600, height: number = 400) => {
    return new WebGLCanvasPlatform2D(canvas, width, height);
});

registerPlatformConstructor("webgl-3d", (canvas: HTMLCanvasElement, width: number = 600, height: number = 400, fov: number = Math.PI / 2, near: number = 0.1, far: number = 1000) => {
    return new WebGLCanvasPlatform3D(canvas, width, height, fov, near, far);
});