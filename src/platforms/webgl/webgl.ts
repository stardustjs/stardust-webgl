import { Specification, Shape, Type, Binding, Platform, PlatformShape, PlatformShapeData } from "stardust-core";
import { FlattenEmits } from "stardust-core";
import { Dictionary, timeTask } from "stardust-core";
import { Generator, GenerateMode, ViewType } from "./generator";
import { RuntimeError } from "stardust-core";
import { Pose } from "stardust-core";
import * as WebGLUtils from "./webglutils";

class WebGLPlatformShapeProgram {
    private _GL: WebGLRenderingContext;
    private _program: WebGLProgram;
    private _uniformLocations: Dictionary<WebGLUniformLocation>;
    private _attribLocations: Dictionary<number>;

    constructor(GL: WebGLRenderingContext, spec: Specification.Shape, asUniform: (name: string) => boolean, viewType: ViewType, mode: GenerateMode) {
        this._GL = GL;
        let generator = new Generator(viewType, mode);
        generator.compileSpecification(spec, asUniform);
        this._program = WebGLUtils.compileProgram(this._GL,
            generator.getCode(),
            generator.getFragmentCode()
        );
        this._uniformLocations = new Dictionary<WebGLUniformLocation>();
        this._attribLocations = new Dictionary<number>();
    }

    public use() {
        this._GL.useProgram(this._program);
    }

    public setUniform(name: string, type: Type, value: number | number[]) {
        let location = this.getUniformLocation(name);
        if(location == null) return;
        let GL = this._GL;
        if(type.primitive == "float") {
            let va = value as number[];
            switch(type.primitiveCount) {
                case 1: GL.uniform1f(location, value as number); break;
                case 2: GL.uniform2f(location, va[0], va[1]); break;
                case 3: GL.uniform3f(location, va[0], va[1], va[2]); break;
                case 4: GL.uniform4f(location, va[0], va[1], va[2], va[3]); break;
            }
        }
        if(type.primitive == "int") {
            let va = value as number[];
            switch(type.primitiveCount) {
                case 1: GL.uniform1i(location, value as number); break;
                case 2: GL.uniform2i(location, va[0], va[1]); break;
                case 3: GL.uniform3i(location, va[0], va[1], va[2]); break;
                case 4: GL.uniform4i(location, va[0], va[1], va[2], va[3]); break;
            }
        }
    }

    public getUniformLocation(name: string): WebGLUniformLocation {
        if(this._uniformLocations.has(name)) {
            return this._uniformLocations.get(name);
        } else {
            let location = this._GL.getUniformLocation(this._program, name);
            this._uniformLocations.set(name, location);
            return location;
        }
    }
    public getAttribLocation(name: string): number {
        if(this._attribLocations.has(name)) {
            return this._attribLocations.get(name);
        } else {
            let location = this._GL.getAttribLocation(this._program, name);
            if(location < 0) location = null;
            this._attribLocations.set(name, location);
            return location;
        }
    }
}

export class WebGLPlatformShapeData extends PlatformShapeData {
    public buffers: Dictionary<WebGLBuffer>;
    public vertexCount: number;
}

export class WebGLPlatformShape extends PlatformShape {
    private _shape: Shape;
    private _platform: WebGLPlatform;
    private _GL: WebGLRenderingContext;
    private _bindings: Dictionary<Binding>;
    private _spec: Specification.Shape;

    private _specFlattened: Specification.Shape;
    private _flattenedVertexIndexVariable: string;
    private _flattenedVertexCount: number;

    private _program: WebGLPlatformShapeProgram;
    private _programPick: WebGLPlatformShapeProgram;
    private _pickIndex: number;

    constructor(platform: WebGLPlatform, GL: WebGLRenderingContext, shape: Shape, spec: Specification.Shape, bindings: Dictionary<Binding>) {
        super();
        this._platform = platform;
        this._GL = GL;
        this._shape = shape;
        this._bindings = bindings;
        this._spec = spec;

        let flattenedInfo = FlattenEmits(spec);
        this._specFlattened = flattenedInfo.specification;
        this._flattenedVertexIndexVariable = flattenedInfo.indexVariable;
        this._flattenedVertexCount = flattenedInfo.count

        this._program = new WebGLPlatformShapeProgram(GL,
            this._specFlattened,
            name => this.isUniform(name),
            this._platform.viewInfo.type,
            GenerateMode.NORMAL
        );

        this._programPick = new WebGLPlatformShapeProgram(GL,
            this._specFlattened,
            name => this.isUniform(name),
            this._platform.viewInfo.type,
            GenerateMode.PICK
        );

        this.initializeUniforms();
    }
    public initializeUniforms() {
        for(let name in this._specFlattened.input) {
            if(this.isUniform(name)) {
                this.updateUniform(name, this._bindings.get(name).specValue);
            }
        }
    }
    public initializeBuffers(): WebGLPlatformShapeData {
        let GL = this._GL;
        let data = new WebGLPlatformShapeData();
        data.buffers = new Dictionary<WebGLBuffer>();;
        for(let name in this._specFlattened.input) {
            if(!this.isUniform(name)) {
                let location = this._program.getAttribLocation(name);
                if(location != null) {
                    data.buffers.set(name, GL.createBuffer());
                }
            }
        }
        if(this._programPick) {
            data.buffers.set("s3_pick_index", GL.createBuffer());
        }
        data.vertexCount = 0;
        return data;
    }
    // Is the input attribute compiled as uniform?
    public isUniform(name: string): boolean {
        // Extra variables we add are always not uniforms.
        if(name == this._flattenedVertexIndexVariable) return false;
        if(this._bindings.get(name) == null) {
            throw new RuntimeError(`attribute ${name} is not specified.`);
        }
        // Look at the binding to determine.
        return !this._bindings.get(name).isFunction;
    }
    public updateUniform(name: string, value: Specification.Value): void {
        let binding = this._bindings.get(name);
        let type = binding.type;
        this._program.use();
        this._program.setUniform(name, type, value);
        if(this._programPick) {
            this._programPick.use();
            this._programPick.setUniform(name, type, value);
        }
    }
    public uploadData(data: any[]): PlatformShapeData {
        let buffers = this.initializeBuffers();

        let n = data.length;
        let GL = this._GL;
        let bindings = this._bindings;
        let rep = this._flattenedVertexCount;

        this._bindings.forEach((binding, name) => {
            let buffer = buffers.buffers.get(name);
            if(buffer == null) return;

            let type = binding.type;
            let array = new Float32Array(type.primitiveCount * n * rep);
            binding.fillBinary(data, rep, array);

            GL.bindBuffer(GL.ARRAY_BUFFER, buffer);
            GL.bufferData(GL.ARRAY_BUFFER, array, GL.STATIC_DRAW);
        });
        // The vertex index attribute.
        let array = new Float32Array(n * rep);
        for(let i = 0; i < n * rep; i++) {
            array[i] = i % rep;
        }
        GL.bindBuffer(GL.ARRAY_BUFFER, buffers.buffers.get(this._flattenedVertexIndexVariable));
        GL.bufferData(GL.ARRAY_BUFFER, array, GL.STATIC_DRAW);
        // The pick index attribute.
        if(this._programPick) {
            let array = new Float32Array(n * rep * 4);
            for(let i = 0; i < n * rep; i++) {
                let index = Math.floor(i / rep);
                array[i * 4 + 0] = (index & 0xff) / 255.0;
                array[i * 4 + 1] = ((index & 0xff00) >> 8) / 255.0;
                array[i * 4 + 2] = ((index & 0xff0000) >> 16) / 255.0;
                array[i * 4 + 3] = ((index & 0xff000000) >> 24) / 255.0;
            }
            GL.bindBuffer(GL.ARRAY_BUFFER, buffers.buffers.get("s3_pick_index"));
            GL.bufferData(GL.ARRAY_BUFFER, array, GL.STATIC_DRAW);
        }
        buffers.vertexCount = n * rep;
        return buffers;
    }

    // Render the graphics.
    public renderBase(buffers: WebGLPlatformShapeData, mode: GenerateMode): void {
        if(buffers.vertexCount > 0) {
            let GL = this._GL;
            let spec = this._specFlattened;
            let bindings = this._bindings;

            let program = this._program;
            if(mode == GenerateMode.PICK) {
                program = this._programPick;
            }

            program.use();

            for(let name in spec.input) {
                let attributeLocation = program.getAttribLocation(name);
                if(attributeLocation == null) continue;
                GL.bindBuffer(GL.ARRAY_BUFFER, buffers.buffers.get(name));
                GL.enableVertexAttribArray(attributeLocation);
                if(name == this._flattenedVertexIndexVariable) {
                    GL.vertexAttribPointer(attributeLocation,
                        1, GL.FLOAT, false, 0, 0
                    );
                } else {
                    let type = bindings.get(name).type;
                    GL.vertexAttribPointer(attributeLocation,
                        type.primitiveCount, type.primitive == "float" ? GL.FLOAT : GL.INT,
                        false, 0, 0
                    );
                }
            }

            if(mode == GenerateMode.PICK) {
                let attributeLocation = program.getAttribLocation("s3_pick_index");
                GL.bindBuffer(GL.ARRAY_BUFFER, buffers.buffers.get("s3_pick_index"));
                GL.enableVertexAttribArray(attributeLocation);
                GL.vertexAttribPointer(attributeLocation,
                    4, GL.FLOAT,
                    false, 0, 0
                );
            }

            // Set view uniforms.
            let viewInfo = this._platform.viewInfo;
            let pose = this._platform.pose;
            switch(viewInfo.type) {
                case ViewType.VIEW_2D: {
                    GL.uniform4f(program.getUniformLocation("s3_view_params"),
                        2.0 / viewInfo.width, -2.0 / viewInfo.height, -1, +1
                    );
                } break;
                case ViewType.VIEW_3D: {
                    GL.uniform4f(program.getUniformLocation("s3_view_params"),
                        1.0 / Math.tan(viewInfo.fovY / 2.0) / viewInfo.aspectRatio,
                        1.0 / Math.tan(viewInfo.fovY / 2.0),
                        (viewInfo.near + viewInfo.far) / (viewInfo.near - viewInfo.far),
                        (2.0 * viewInfo.near * viewInfo.far) / (viewInfo.near - viewInfo.far)
                    );
                    if(pose) {
                        // Rotation and position.
                        GL.uniform4f(program.getUniformLocation("s3_view_rotation"),
                            pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w
                        );
                        GL.uniform3f(program.getUniformLocation("s3_view_position"),
                            pose.position.x, pose.position.y, pose.position.z
                        );
                    } else {
                        GL.uniform4f(program.getUniformLocation("s3_view_rotation"),
                            0, 0, 0, 1
                        );
                        GL.uniform3f(program.getUniformLocation("s3_view_position"),
                            0, 0, 0
                        );
                    }
                } break;
            }

            if(mode == GenerateMode.PICK) {
                GL.uniform1f(program.getUniformLocation("s3_pick_index_alpha"),
                    this._pickIndex / 255.0
                );
            }

            GL.drawArrays(GL.TRIANGLES, 0, buffers.vertexCount);

            for(let name in spec.input) {
                let attributeLocation = program.getAttribLocation(name);
                if(attributeLocation != null) {
                    GL.disableVertexAttribArray(attributeLocation);
                }
            }
            if(mode == GenerateMode.PICK) {
                let attributeLocation = program.getAttribLocation("s3_pick_index");
                GL.disableVertexAttribArray(attributeLocation);
            }
        }
    }

    public setPickIndex(index: number) {
        this._pickIndex = index;
    }

    public render(buffers: PlatformShapeData) {
        if(this._platform.renderMode == GenerateMode.PICK) {
            this.setPickIndex(this._platform.assignPickIndex(this._shape));
        }
        this.renderBase(buffers as WebGLPlatformShapeData, this._platform.renderMode);
    }
}

export interface WebGLViewInfo {
    type: ViewType,
    width?: number;
    height?: number;
    fovY?: number;
    aspectRatio?: number;
    near?: number;
    far?: number;
}

export class WebGLPlatform extends Platform {
    private _GL: WebGLRenderingContext;
    private _viewInfo: WebGLViewInfo;
    private _pose: Pose;
    private _renderMode: GenerateMode;

    constructor(GL: WebGLRenderingContext) {
        super();
        this._GL = GL;
        this.set2DView(500, 500);
        this.setPose(new Pose());
        this._renderMode = GenerateMode.NORMAL;

        this._pickFramebuffer = null;
    }

    public get viewInfo(): WebGLViewInfo { return this._viewInfo; };
    public get pose(): Pose { return this._pose; };
    public get renderMode(): GenerateMode { return this._renderMode; }

    private _pickFramebuffer: WebGLFramebuffer;
    private _pickFramebufferTexture: WebGLTexture;
    private _pickFramebufferWidth: number;
    private _pickFramebufferHeight: number;
    private _pickShapes: Shape[];

    public getPickFramebuffer(width: number, height: number): WebGLFramebuffer {
        if(this._pickFramebuffer == null || width != this._pickFramebufferWidth || height != this._pickFramebufferHeight) {
            let GL = this._GL;
            this._pickFramebuffer = GL.createFramebuffer();
            this._pickFramebufferWidth = width;
            this._pickFramebufferHeight = height;
            GL.bindFramebuffer(GL.FRAMEBUFFER, this._pickFramebuffer);
            this._pickFramebufferTexture = GL.createTexture();
            GL.bindTexture(GL.TEXTURE_2D, this._pickFramebufferTexture);
            GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
            GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
            GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, width, height, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);

            GL.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, this._pickFramebufferTexture, 0);
            GL.bindTexture(GL.TEXTURE_2D, null);
            GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        }
        return this._pickFramebuffer;
    }

    public beginPicking(width: number, height: number) {
        this._renderMode = GenerateMode.PICK;
        let GL = this._GL;
        let fb = this.getPickFramebuffer(width, height);
        GL.bindFramebuffer(GL.FRAMEBUFFER, fb);
        GL.clearColor(1, 1, 1, 1);
        GL.clear(GL.COLOR_BUFFER_BIT);
        GL.disable(GL.BLEND);

        this._pickShapes = [];
    }

    public assignPickIndex(shape: Shape): number {
        let idx = this._pickShapes.indexOf(shape);
        if(idx >= 0) {
            return idx;
        } else {
            let num = this._pickShapes.length;
            this._pickShapes.push(shape);
            return num;
        }
    }

    public endPicking() {
        let GL = this._GL;
        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        GL.enable(GL.BLEND);
        this._renderMode = GenerateMode.NORMAL;
    }

    public getPickingPixel(x: number, y: number): [ Shape, number ] {
        if(x < 0 || y < 0 || x >= this._pickFramebufferWidth || y >= this._pickFramebufferHeight) {
            return null;
        }
        let GL = this._GL;
        let fb = this._pickFramebuffer;
        GL.bindFramebuffer(GL.FRAMEBUFFER, fb);
        let data = new Uint8Array(4);
        GL.readPixels(x, this._pickFramebufferHeight - 1 - y, 1, 1, GL.RGBA, GL.UNSIGNED_BYTE, data);
        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        let offset = (data[0]) + (data[1] << 8) + (data[2] << 16);
        if(offset >= 16777215) return null;
        return [ this._pickShapes[data[3]], offset ];
    }

    public set2DView(width: number, height: number) {
        this._viewInfo = {
            type: ViewType.VIEW_2D,
            width: width,
            height: height
        }
    }

    public set3DView(fovY: number, aspectRatio: number, near: number = 0.1, far: number = 1000) {
        this._viewInfo = {
            type: ViewType.VIEW_3D,
            fovY: fovY,
            aspectRatio: aspectRatio,
            near: near,
            far: far
        };
    }

    public setPose(pose: Pose) {
        this._pose = pose;
    }

    public compile(shape: Shape, spec: Specification.Shape, bindings: Dictionary<Binding>): PlatformShape {
        return new WebGLPlatformShape(this, this._GL, shape, spec, bindings);
    }
}